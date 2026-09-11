import { AuditService, NoopAuditSink } from "../audit-service.js";
import {
  PolicyBlockError,
  ProviderError,
  RateLimitError,
  TimeoutError,
} from "../errors.js";
import {
  type Approval,
  type ExecutionResult,
  type ProposedAction,
} from "../policy.js";
import { evaluateAction, type PolicyContext } from "../policy/engine.js";
import type {
  CreateDraftInput,
  CreateTaskInput,
  CRMWriteProvider,
  EmailWriteProvider,
} from "../providers.js";
import { EVENTS } from "../events.js";

const ALLOWED_UPDATE_FIELDS = new Set(["nextstep"]);

export interface ExecutionRecord {
  executionId: string;
  proposalSignature: string;
  result: ExecutionResult;
}

export interface ExecutionStore {
  getByExecutionId(id: string): Promise<ExecutionRecord | undefined>;
  getBySignature(signature: string): Promise<ExecutionRecord | undefined>;
  put(record: ExecutionRecord): Promise<void>;
}

export class InMemoryExecutionStore implements ExecutionStore {
  private readonly byExecution = new Map<string, ExecutionRecord>();
  private readonly bySignature = new Map<string, ExecutionRecord>();
  async getByExecutionId(id: string): Promise<ExecutionRecord | undefined> {
    return this.byExecution.get(id);
  }
  async getBySignature(signature: string): Promise<ExecutionRecord | undefined> {
    return this.bySignature.get(signature);
  }
  async put(record: ExecutionRecord): Promise<void> {
    this.byExecution.set(record.executionId, record);
    this.bySignature.set(record.proposalSignature, record);
  }
}

export interface ExecutionRequest {
  proposal: ProposedAction;
  /** Context used to REVALIDATE policy immediately before execution. */
  policyContext: PolicyContext;
  approval?: Approval;
  runId: string;
  interactionFingerprint: string;
  proposalSignature: string;
  executionId?: string;
}

export interface RetryOptions {
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export interface ExecutorOptions {
  audit?: AuditService;
  store?: ExecutionStore;
  retry?: Partial<RetryOptions>;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface BatchOutcome {
  status: "success" | "partial" | "failed";
  results: ExecutionResult[];
}

function isTransient(err: unknown): boolean {
  return (
    err instanceof RateLimitError ||
    err instanceof TimeoutError ||
    (err instanceof ProviderError && err.retryable)
  );
}

/**
 * Deterministic executor. There is deliberately no generic execute(tool, args)
 * API and no send-email operation. It accepts only validated proposals that
 * pass policy revalidation (and explicit approval where required), and it
 * idempotently writes through the CRM/Email write providers.
 */
export class Executor {
  private readonly audit: AuditService;
  private readonly store: ExecutionStore;
  private readonly retry: RetryOptions;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly crm: CRMWriteProvider,
    private readonly email: EmailWriteProvider,
    opts: ExecutorOptions = {},
  ) {
    this.audit = opts.audit ?? new AuditService(new NoopAuditSink());
    this.store = opts.store ?? new InMemoryExecutionStore();
    this.retry = { maxRetries: 2, baseDelayMs: 50, maxDelayMs: 500, ...opts.retry };
    this.now = opts.now ?? (() => Date.now());
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    const executionId = req.executionId ?? req.proposalSignature;
    this.audit.emit({
      eventType: EVENTS.EXECUTION_STARTED,
      payload: { executionId, actionType: req.proposal.type, runId: req.runId, interactionFingerprint: req.interactionFingerprint },
    });

    // 1. Revalidate policy immediately before execution.
    const policy = evaluateAction(
      { type: req.proposal.type, payload: req.proposal.payload as Record<string, unknown> | undefined },
      req.policyContext,
    );
    this.audit.emit({ eventType: EVENTS.POLICY_EVALUATED, payload: { executionId, ruleId: policy.ruleId, action: policy.action } });

    if (policy.action === "blocked") {
      throw new PolicyBlockError(`blocked proposal cannot execute (${policy.reasonCode})`);
    }
    if (policy.action === "approval_required" && req.approval?.decision !== "approve") {
      throw new PolicyBlockError("approval required for this action");
    }

    // 2. Idempotency: prevent duplicate execution.
    const byId = await this.store.getByExecutionId(executionId);
    if (byId) {
      this.audit.emit({ eventType: EVENTS.DUPLICATE_EXECUTION_PREVENTED, payload: { executionId, reason: "execution_id" } });
      return byId.result;
    }
    const bySig = await this.store.getBySignature(req.proposalSignature);
    if (bySig) {
      this.audit.emit({ eventType: EVENTS.DUPLICATE_EXECUTION_PREVENTED, payload: { executionId, reason: "proposal_signature" } });
      return bySig.result;
    }

    // 3. Execute with bounded retry for transient failures only.
    try {
      const externalRef = await this.withRetry(() => this.dispatch(req.proposal, req.proposalSignature));
      const result: ExecutionResult = {
        proposalId: req.proposal.id,
        status: "success",
        idempotencyKey: req.proposalSignature,
        externalRef,
        executedAt: new Date(this.now()).toISOString(),
      };
      await this.store.put({ executionId, proposalSignature: req.proposalSignature, result });
      this.emitWriteOutcome(req.proposal.type, true, executionId);
      return result;
    } catch (err) {
      if (err instanceof PolicyBlockError) throw err;
      const result: ExecutionResult = {
        proposalId: req.proposal.id,
        status: "failed",
        idempotencyKey: req.proposalSignature,
        error: err instanceof Error ? err.message : String(err),
        executedAt: new Date(this.now()).toISOString(),
      };
      // Failed results are NOT stored so a safe retry is possible without
      // being mistaken for a duplicate.
      this.emitWriteOutcome(req.proposal.type, false, executionId);
      return result;
    }
  }

  async executeBatch(reqs: ExecutionRequest[]): Promise<BatchOutcome> {
    const results: ExecutionResult[] = [];
    for (const req of reqs) {
      try {
        results.push(await this.execute(req));
      } catch (err) {
        results.push({
          proposalId: req.proposal.id,
          status: "skipped",
          idempotencyKey: req.proposalSignature,
          error: err instanceof Error ? err.message : String(err),
          executedAt: new Date(this.now()).toISOString(),
        });
      }
    }
    const succeeded = results.filter((r) => r.status === "success").length;
    const status: BatchOutcome["status"] =
      succeeded === results.length ? "success" : succeeded > 0 ? "partial" : "failed";
    this.audit.emit({ eventType: EVENTS.RUN_COMPLETED, payload: { status, total: results.length, succeeded } });
    return { status, results };
  }

  private async dispatch(proposal: ProposedAction, idempotencyKey: string): Promise<string> {
    const payload = (proposal.payload ?? {}) as Record<string, unknown>;
    switch (proposal.type) {
      case "create_task": {
        const input: CreateTaskInput = {
          accountId: proposal.target,
          title: String(payload.title ?? ""),
          type: String(payload.type ?? "TODO"),
          dueDate: (payload.dueDate as string | null) ?? null,
          ownerId: (payload.ownerId as string | null) ?? null,
          contactId: (payload.contactId as string | null) ?? null,
          dealId: (payload.dealId as string | null) ?? null,
        };
        return (await this.crm.createTask(input, idempotencyKey)).externalRef;
      }
      case "create_note": {
        return (await this.crm.createNote(proposal.target, String(payload.body ?? ""), idempotencyKey)).externalRef;
      }
      case "update_field": {
        const field = String(payload.field ?? "");
        if (!ALLOWED_UPDATE_FIELDS.has(field)) {
          throw new PolicyBlockError(`field not allowlisted: ${field}`);
        }
        return (await this.crm.updateField(proposal.target, String(payload.objectType ?? "deals"), field, payload.value)).externalRef;
      }
      case "update_stage": {
        return (await this.crm.updateStage(proposal.target, String(payload.stage ?? ""))).externalRef;
      }
      case "create_draft": {
        const input: CreateDraftInput = {
          to: (payload.to as string[]) ?? [],
          subject: String(payload.subject ?? ""),
          body: String(payload.body ?? ""),
          threadId: payload.threadId as string | undefined,
        };
        return (await this.email.createDraft(input, idempotencyKey)).externalRef;
      }
      default:
        throw new PolicyBlockError(`unsupported action: ${proposal.type}`);
    }
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        if (isTransient(err) && attempt < this.retry.maxRetries) {
          await this.sleep(Math.min(this.retry.baseDelayMs * 2 ** attempt, this.retry.maxDelayMs));
          continue;
        }
        throw err;
      }
    }
  }

  private emitWriteOutcome(type: string, success: boolean, executionId: string): void {
    const isDraft = type === "create_draft";
    this.audit.emit({
      eventType: isDraft
        ? success
          ? EVENTS.GMAIL_DRAFT_SUCCESS
          : EVENTS.GMAIL_DRAFT_FAILURE
        : success
          ? EVENTS.CRM_WRITE_SUCCESS
          : EVENTS.CRM_WRITE_FAILURE,
      payload: { executionId, actionType: type },
    });
  }
}
