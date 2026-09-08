import type { AgentReadContext, PolicyContext, ProposedAction } from "../shared/core.js";
import { buildExecutionPlan, savePlan, type ExecutionPlan } from "./execution-plans.js";

/**
 * Execution-plan use-case: resolves the authoritative policy context from the
 * read context, builds the plan, and persists it. Keeps provider orchestration
 * and persistence out of the HTTP route.
 */

export interface CreatePlanInput {
  accountId: string;
  findingIds: string[];
  objective: string;
  summary?: string;
  evidence?: string[];
  actions: { action: ProposedAction; dependsOn?: string[] }[];
}

export async function createExecutionPlan(
  userId: string,
  input: CreatePlanInput,
  readContext: AgentReadContext,
): Promise<ExecutionPlan> {
  const policyContext: PolicyContext = {
    commercialState: await readContext.commercial.getCommercialState(input.accountId).catch(() => null),
    openDeal: await readContext.crm.getOpenDeal(input.accountId).catch(() => null),
  };

  const plan = buildExecutionPlan({
    accountId: input.accountId,
    findingIds: input.findingIds,
    objective: input.objective,
    summary: input.summary,
    evidence: input.evidence,
    actions: input.actions.map((a) => ({ action: a.action, dependsOn: a.dependsOn })),
    policyContext,
  });

  await savePlan(userId, plan);
  return plan;
}