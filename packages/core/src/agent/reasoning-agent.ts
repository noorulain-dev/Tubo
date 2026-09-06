import { AuditService, NoopAuditSink } from "../audit-service.js";
import { MissingContextError } from "../errors.js";
import type { AgentReadContext } from "../providers.js";
import type { SemanticState } from "../semantic.js";
import type { AgentToolCall } from "../agent.js";
import { buildDefaultTools, type ToolDefinition } from "./tools.js";
import { DeterministicToolPlanner, type AgentMetadata, type ToolPlanner } from "./planner.js";

export type AgentStatus = "completed" | "missing_context" | "budget_exhausted" | "failed";

export interface AgentOutcome {
  status: AgentStatus;
  toolCalls: AgentToolCall[];
  missingContext: string[];
  cacheHits: number;
  latencyMs: number;
}

export interface ReasoningAgentOptions {
  tools?: ToolDefinition[];
  planner?: ToolPlanner;
  maxToolCalls?: number;
  maxIterations?: number;
  timeoutMs?: number;
  audit?: AuditService;
  now?: () => number;
}

export interface ReasoningAgentInput {
  state: SemanticState;
  accountId: string;
  metadata?: AgentMetadata;
}

/**
 * Bounded, read-only revenue reasoning agent. It asks a planner which operational
 * context to retrieve, then executes ONLY read-only tools with strict bounds
 * (tool-call budget, reasoning iterations, timeout), duplicate-call prevention,
 * and a per-run cache. It has zero mutation capability.
 */
export class ReasoningAgent {
  private readonly tools: Map<string, ToolDefinition>;
  private readonly planner: ToolPlanner;
  private readonly maxToolCalls: number;
  private readonly maxIterations: number;
  private readonly timeoutMs: number;
  private readonly audit: AuditService;
  private readonly now: () => number;

  constructor(private readonly ctx: AgentReadContext, opts: ReasoningAgentOptions = {}) {
    const toolList = opts.tools ?? buildDefaultTools();
    this.tools = new Map(toolList.map((t) => [t.name, t]));
    this.planner = opts.planner ?? new DeterministicToolPlanner();
    this.maxToolCalls = opts.maxToolCalls ?? 12;
    this.maxIterations = opts.maxIterations ?? 5;
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.audit = opts.audit ?? new AuditService(new NoopAuditSink());
    this.now = opts.now ?? (() => Date.now());
  }

  async run(input: ReasoningAgentInput): Promise<AgentOutcome> {
    const startedAt = this.now();
    this.audit.emit({ eventType: "agent_started", payload: { accountId: input.accountId } });

    const cache = new Map<string, unknown>();
    const toolCalls: AgentToolCall[] = [];
    const missingContext: string[] = [];
    let cacheHits = 0;
    let hadFailure = false;
    let budgetExhausted = false;

    outer: for (let iter = 0; iter < this.maxIterations; iter++) {
      if (this.now() - startedAt > this.timeoutMs) {
        hadFailure = true;
        break;
      }

      const requests = await this.planner.plan({
        state: input.state,
        accountId: input.accountId,
        metadata: input.metadata ?? {},
        previousToolCalls: toolCalls,
      });

      if (requests.length === 0) break;

      for (const req of requests) {
        if (toolCalls.length >= this.maxToolCalls) {
          budgetExhausted = true;
          this.audit.emit({ eventType: "agent_budget_exhausted", payload: { maxToolCalls: this.maxToolCalls } });
          break outer;
        }

        const tool = this.tools.get(req.tool);
        if (!tool) {
          this.audit.emit({ eventType: "agent_tool_failed", payload: { tool: req.tool, reason: "unknown tool" } });
          hadFailure = true;
          continue;
        }

        const argsResult = tool.argsSchema.safeParse(req.args);
        if (!argsResult.success) {
          this.audit.emit({ eventType: "agent_tool_failed", payload: { tool: req.tool, reason: "invalid arguments" } });
          toolCalls.push({
            toolName: req.tool,
            reasonCategory: req.reasonCategory,
            args: req.args,
            ok: false,
            source: tool.source,
            authority: tool.authority,
          });
          hadFailure = true;
          continue;
        }

        const cacheKey = `${req.tool}:${JSON.stringify(argsResult.data)}`;
        if (cache.has(cacheKey)) {
          cacheHits++;
          toolCalls.push({
            toolName: req.tool,
            reasonCategory: req.reasonCategory,
            args: argsResult.data,
            result: cache.get(cacheKey),
            ok: true,
            source: tool.source,
            authority: tool.authority,
            fromCache: true,
          });
          continue;
        }

        this.audit.emit({ eventType: "agent_tool_requested", payload: { tool: req.tool, reasonCategory: req.reasonCategory } });
        const callStart = this.now();
        try {
          const result = await tool.handler(argsResult.data, this.ctx);
          if (tool.resultSchema) {
            tool.resultSchema.parse(result);
          }
          cache.set(cacheKey, result);
          toolCalls.push({
            toolName: req.tool,
            reasonCategory: req.reasonCategory,
            args: argsResult.data,
            result,
            ok: true,
            source: tool.source,
            authority: tool.authority,
            latencyMs: this.now() - callStart,
          });
          this.audit.emit({ eventType: "agent_tool_completed", payload: { tool: req.tool, latencyMs: this.now() - callStart } });
        } catch (err) {
          const isMissing = err instanceof MissingContextError;
          toolCalls.push({
            toolName: req.tool,
            reasonCategory: req.reasonCategory,
            args: argsResult.data,
            ok: false,
            source: tool.source,
            authority: tool.authority,
            latencyMs: this.now() - callStart,
          });
          if (isMissing) {
            missingContext.push(`${req.tool}: ${(err as Error).message}`);
          } else {
            hadFailure = true;
          }
          this.audit.emit({ eventType: "agent_tool_failed", payload: { tool: req.tool, reason: isMissing ? "missing_context" : "error" } });
        }
      }
    }

    let status: AgentStatus = "completed";
    if (budgetExhausted) status = "budget_exhausted";
    else if (missingContext.length > 0) status = "missing_context";
    else if (hadFailure) status = "failed";

    this.audit.emit({ eventType: "agent_completed", payload: { status, toolCallCount: toolCalls.length, cacheHits } });

    return {
      status,
      toolCalls,
      missingContext,
      cacheHits,
      latencyMs: this.now() - startedAt,
    };
  }
}

export type { AgentMetadata, ToolPlanner, ToolRequest } from "./planner.js";
export type { ToolDefinition } from "./tools.js";
