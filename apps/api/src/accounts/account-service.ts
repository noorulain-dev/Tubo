import { appendAccountEvent } from "./account-intelligence.js";
import type { ProposalView, RunView } from "../shared/types.js";

/**
 * Account-facing use-case for the manual interaction path. Keeps event-recording
 * and payload projection out of the HTTP layer: a route only calls RunService to
 * process, then this service to persist the Account Intelligence event.
 */
export async function recordManualInteraction(
  userId: string,
  accountId: string | null | undefined,
  run: RunView,
): Promise<void> {
  await appendAccountEvent({
    userId,
    accountId: accountId ?? null,
    eventType: "manual_interaction_processed",
    source: "manual",
    sourceReference: run.id,
    payload: {
      runId: run.id,
      status: run.status,
      proposals: run.proposals.map((p) => p.action.type),
      semantic: run.semantic,
      gaps: run.gaps.map((g) => ({ type: g.type, what: g.what, title: g.title, description: g.description })),
    },
    provenance: "manual",
    idempotencyKey: `interaction:${userId}:${run.id}`,
  });
}

/** Record an executed proposal as an Account Intelligence event (post-execution). */
export async function recordExternalExecution(userId: string, view: ProposalView): Promise<void> {
  await appendAccountEvent({
    userId,
    accountId: view.action.target ?? null,
    eventType: "external_action_executed",
    source: "executor",
    sourceReference: view.id,
    payload: { actionType: view.action.type, status: view.execution?.status },
    provenance: "executor",
    idempotencyKey: `exec:${userId}:${view.id}`,
  });
}