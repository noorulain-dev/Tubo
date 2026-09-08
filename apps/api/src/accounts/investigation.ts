import {
  buildDefaultTools,
  MissingContextError,
  type AgentReadContext,
  type ToolDefinition,
} from "../shared/core.js";
export { saveInvestigation, listInvestigations } from "./investigation-repository.js";
import type { Finding, FindingType } from "./risk-scanner.js";

/**
 * STEP 55 — AI Investigation for scanner findings.
 *
 * A finding is only a hypothesis. A bounded, READ-ONLY agent selectively
 * investigates the relevant systems to CONFIRM, REJECT or qualify it. It has
 * zero mutation capability: the tool registry contains only read tools, so it can
 * never write HubSpot, create a Gmail draft, execute, approve, or change policy.
 *
 * Only an OPERATIONAL trace is produced (tool, reason category, source, status,
 * factual result summary, evidence reference, latency) — never private
 * chain-of-thought, and retrieved data is always treated as data (injection-safe).
 */

export type InvestigationOutcome = "confirmed" | "rejected" | "ambiguous" | "missing_context";

export type TraceStepStatus = "success" | "missing_context" | "error" | "cache";

export interface InvestigationTraceStep {
  tool: string;
  reasonCategory: string;
  source: string | null;
  status: TraceStepStatus;
  /** Short deterministic factual summary (not chain-of-thought). */
  factualResult: string;
  evidenceReference: string | null;
  latencyMs: number;
}

export interface InvestigationResult {
  findingId: string;
  outcome: InvestigationOutcome;
  trace: InvestigationTraceStep[];
  budget: { used: number; max: number };
  startedAt: string;
  finishedAt: string;
}

export interface InvestigationRequest {
  tool: string;
  reasonCategory: string;
  args: Record<string, unknown>;
}

export interface InvestigatorOptions {
  maxToolCalls?: number;
  timeoutMs?: number;
  now?: () => number;
  tools?: ToolDefinition[];
}

/**
 * Selectively map a finding type to the read-only tools (and reason categories)
 * required to verify it. No retrieval of everything by default.
 */
export function planForFinding(finding: Finding, accountId: string): InvestigationRequest[] {
  switch (finding.type) {
    case "missing_operational_task":
      return [
        { tool: "get_open_tasks", reasonCategory: "task_deduplication", args: { accountId } },
        { tool: "check_existing_action", reasonCategory: "execution_gap_check", args: { accountId, signature: { title: finding.title } } },
      ];
    case "duplicate_action":
      return [
        { tool: "check_existing_action", reasonCategory: "task_deduplication", args: { accountId, signature: {} } },
        { tool: "get_open_tasks", reasonCategory: "execution_gap_check", args: { accountId } },
      ];
    case "commercial_crm_mismatch":
    case "contradictory_state":
      return [
        { tool: "get_commercial_state", reasonCategory: "commercial_state_validation", args: { accountId } },
        { tool: "get_open_deal", reasonCategory: "crm_state_validation", args: { accountId } },
        { tool: "get_open_deal", reasonCategory: "execution_gap_check", args: { accountId } }, // duplicate → suppressed by cache
      ];
    case "unanswered_customer_question":
      return [{ tool: "get_email_thread", reasonCategory: "email_context_validation", args: { threadId: finding.sourceReferences[0] ?? "" } }];
    case "overdue_internal_commitment":
    case "customer_waiting_on_us":
      return [
        { tool: "get_open_tasks", reasonCategory: "commitment_verification", args: { accountId } },
        { tool: "get_open_deal", reasonCategory: "crm_state_validation", args: { accountId } },
      ];
    case "stale_crm_state":
    case "trial_expiring_with_open_blocker":
      return [{ tool: "get_open_deal", reasonCategory: "crm_state_validation", args: { accountId } }];
    case "missing_next_step":
      return [
        { tool: "get_open_tasks", reasonCategory: "execution_gap_check", args: { accountId } },
        { tool: "get_open_deal", reasonCategory: "crm_state_validation", args: { accountId } },
      ];
    case "missing_required_context":
      return []; // the required source is unavailable; no safe read to perform
    default:
      return [];
  }
}

function summarize(tool: string, result: unknown): string {
  if (result == null) return "no data";
  if (tool === "get_open_tasks") return `${(result as unknown[]).length} open task(s)`;
  if (tool === "get_contacts") return `${(result as unknown[]).length} contact(s)`;
  if (tool === "get_recent_notes") return `${(result as unknown[]).length} note(s)`;
  if (tool === "check_existing_action") return result ? "existing task found" : "no existing task";
  if (tool === "get_open_deal") return result ? "open deal found" : "no open deal";
  if (tool === "get_commercial_state") return `status=${(result as { status?: string }).status ?? "unknown"}`;
  if (tool === "get_email_thread") return result ? "thread found" : "no thread";
  if (tool === "resolve_account") return `${(result as unknown[]).length} account(s)`;
  return "ok";
}

function referenceOf(tool: string, result: unknown): string | null {
  if (!result) return null;
  const r = result as Record<string, unknown>;
  return (r.id as string) ?? (r.externalRef as string) ?? (r.threadId as string) ?? null;
}

const PAYING = new Set(["active", "paying", "paid"]);
const NON_CONVERTED = new Set(["trial", "closed lost", "closedlost"]);

interface RunFlags {
  budgetExhausted: boolean;
  timedOut: boolean;
  missing: boolean;
  errored: boolean;
}

function classifyOutcome(type: FindingType, flags: RunFlags, results: Map<string, unknown>): InvestigationOutcome {
  if (flags.budgetExhausted || flags.timedOut) return "ambiguous";
  if (flags.missing) return "missing_context";
  if (flags.errored) return "ambiguous";

  switch (type) {
    case "missing_operational_task": {
      const tasks = results.get("get_open_tasks");
      if (!Array.isArray(tasks)) return "ambiguous";
      return tasks.length === 0 ? "confirmed" : "rejected";
    }
    case "duplicate_action": {
      const existing = results.get("check_existing_action");
      return existing == null ? "rejected" : "confirmed";
    }
    case "commercial_crm_mismatch": {
      const commercial = results.get("get_commercial_state") as { status?: string } | undefined;
      const deal = results.get("get_open_deal") as { stage?: string } | undefined;
      if (!commercial || !deal) return "ambiguous";
      const paying = PAYING.has((commercial.status ?? "").toLowerCase());
      const nonConverted = NON_CONVERTED.has((deal.stage ?? "").toLowerCase());
      if (paying && nonConverted) return "confirmed";
      return "rejected";
    }
    case "contradictory_state": {
      const commercial = results.get("get_commercial_state") as { status?: string } | undefined;
      const deal = results.get("get_open_deal") as { stage?: string } | undefined;
      if (!commercial || !deal) return "ambiguous";
      const paying = PAYING.has((commercial.status ?? "").toLowerCase());
      const nonConverted = NON_CONVERTED.has((deal.stage ?? "").toLowerCase());
      return paying && nonConverted ? "confirmed" : "ambiguous";
    }
    case "unanswered_customer_question": {
      const thread = results.get("get_email_thread");
      return thread == null ? "missing_context" : "ambiguous";
    }
    default:
      return "ambiguous";
  }
}

/**
 * Bounded, read-only finding investigator. Reuses the default read-only tool
 * registry and enforces a tool-call budget, timeout, and per-run cache so that
 * duplicate equivalent tool calls are suppressed.
 */
export class Investigator {
  private readonly tools: Map<string, ToolDefinition>;
  private readonly maxToolCalls: number;
  private readonly timeoutMs: number;
  private readonly now: () => number;

  constructor(private readonly ctx: AgentReadContext, opts: InvestigatorOptions = {}) {
    const list = opts.tools ?? buildDefaultTools();
    this.tools = new Map(list.map((t) => [t.name, t]));
    this.maxToolCalls = opts.maxToolCalls ?? 6;
    this.timeoutMs = opts.timeoutMs ?? 20_000;
    this.now = opts.now ?? (() => Date.now());
  }

  async investigate(finding: Finding, accountId: string): Promise<InvestigationResult> {
    const started = this.now();
    const requests = planForFinding(finding, accountId);
    const cache = new Map<string, unknown>();
    const results = new Map<string, unknown>();
    const trace: InvestigationTraceStep[] = [];
    const flags: RunFlags = { budgetExhausted: false, timedOut: false, missing: false, errored: false };

    for (const req of requests) {
      if (this.now() - started > this.timeoutMs) {
        flags.timedOut = true;
        break;
      }
      if (trace.length >= this.maxToolCalls) {
        flags.budgetExhausted = true;
        break;
      }

      const tool = this.tools.get(req.tool);
      if (!tool) {
        trace.push({ tool: req.tool, reasonCategory: req.reasonCategory, source: null, status: "error", factualResult: "unknown tool", evidenceReference: null, latencyMs: 0 });
        flags.errored = true;
        continue;
      }

      const parsed = tool.argsSchema.safeParse(req.args);
      if (!parsed.success) {
        trace.push({ tool: req.tool, reasonCategory: req.reasonCategory, source: tool.source ?? null, status: "error", factualResult: "invalid arguments", evidenceReference: null, latencyMs: 0 });
        flags.errored = true;
        continue;
      }

      const cacheKey = `${req.tool}:${JSON.stringify(parsed.data)}`;
      if (cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        trace.push({ tool: req.tool, reasonCategory: req.reasonCategory, source: tool.source ?? null, status: "cache", factualResult: summarize(req.tool, cached), evidenceReference: referenceOf(req.tool, cached), latencyMs: 0 });
        continue;
      }

      const callStart = this.now();
      try {
        const result = await tool.handler(parsed.data, this.ctx);
        if (tool.resultSchema) tool.resultSchema.parse(result);
        cache.set(cacheKey, result);
        results.set(req.tool, result);
        trace.push({
          tool: req.tool,
          reasonCategory: req.reasonCategory,
          source: tool.source ?? null,
          status: "success",
          factualResult: summarize(req.tool, result),
          evidenceReference: referenceOf(req.tool, result),
          latencyMs: this.now() - callStart,
        });
      } catch (err) {
        const isMissing = err instanceof MissingContextError;
        if (isMissing) flags.missing = true;
        else flags.errored = true;
        trace.push({
          tool: req.tool,
          reasonCategory: req.reasonCategory,
          source: tool.source ?? null,
          status: isMissing ? "missing_context" : "error",
          factualResult: isMissing ? "source unavailable" : "tool error",
          evidenceReference: null,
          latencyMs: this.now() - callStart,
        });
      }
    }

    return {
      findingId: finding.findingId,
      outcome: classifyOutcome(finding.type, flags, results),
      trace,
      budget: { used: trace.length, max: this.maxToolCalls },
      startedAt: new Date(started).toISOString(),
      finishedAt: new Date(this.now()).toISOString(),
    };
  }
}

