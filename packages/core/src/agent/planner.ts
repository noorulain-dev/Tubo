import type { SemanticState } from "../semantic.js";
import type { AgentToolCall } from "../agent.js";

export const REASON_CATEGORIES = [
  "identity_resolution",
  "crm_state_validation",
  "task_deduplication",
  "email_validation",
  "commercial_state_validation",
  "commitment_validation",
  "execution_gap_check",
] as const;
export type ReasonCategory = (typeof REASON_CATEGORIES)[number];

export interface ToolRequest {
  tool: string;
  reasonCategory: ReasonCategory;
  args: Record<string, unknown>;
}

export interface AgentMetadata {
  threadId?: string;
}

export interface PlannerContext {
  state: SemanticState;
  accountId: string;
  metadata: AgentMetadata;
  previousToolCalls: AgentToolCall[];
}

export interface ToolPlanner {
  plan(ctx: PlannerContext): ToolRequest[] | Promise<ToolRequest[]>;
}

/**
 * Deterministic, selective tool planner. It decides which operational context is
 * required from the semantic state — it never retrieves everything by default.
 */
export class DeterministicToolPlanner implements ToolPlanner {
  plan(ctx: PlannerContext): ToolRequest[] {
    const s = ctx.state;
    const reqs: ToolRequest[] = [];
    const accountId = ctx.accountId;

    const hasUnresolvedPerson = s.entityReferences.some(
      (e) => e.kind === "person" && e.resolution !== "resolved",
    );

    // PART 7 baseline: the authoritative reconciliation sources (deal stage + open
    // tasks) are always retrieved. This is a bounded 2-read baseline, not
    // retrieve-all — contacts/notes/email are still only retrieved on signal.
    reqs.push({ tool: "get_open_deal", reasonCategory: "crm_state_validation", args: { accountId } });
    reqs.push({ tool: "get_open_tasks", reasonCategory: "task_deduplication", args: { accountId } });

    if (s.taskCandidates.length > 0) {
      reqs.push({
        tool: "check_existing_action",
        reasonCategory: "execution_gap_check",
        args: { accountId, signature: { title: s.taskCandidates[0]?.action } },
      });
    }
    if (hasUnresolvedPerson) {
      reqs.push({ tool: "get_contacts", reasonCategory: "identity_resolution", args: { accountId } });
    }
    if (s.commercialSignals.length > 0) {
      reqs.push({ tool: "get_commercial_state", reasonCategory: "commercial_state_validation", args: { accountId } });
    }
    // PART 6: a fact claim ("signed/paid/sent/delivered") must be verified against
    // the authoritative sent-communication source (gmail), not just commercial/CRM.
    if (s.commercialSignals.some((sig) => sig.kind === "claims_subscribed")) {
      reqs.push({ tool: "get_outbound_communication", reasonCategory: "email_validation", args: { accountId } });
    }
    if (ctx.metadata.threadId) {
      reqs.push({ tool: "get_email_thread", reasonCategory: "email_validation", args: { threadId: ctx.metadata.threadId } });
    }

    const seen = new Set(
      ctx.previousToolCalls.map((tc) => `${tc.toolName}:${JSON.stringify(tc.args)}`),
    );
    return reqs.filter((r) => !seen.has(`${r.tool}:${JSON.stringify(r.args)}`));
  }
}
