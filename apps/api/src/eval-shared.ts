import type {
  AgentReadContext,
  AgentToolCall,
  CommercialState,
  CommercialStateReadProvider,
  ContactRecord,
  CRMReadProvider,
  DealRecord,
  EmailReadProvider,
  OperationalContext,
  TaskRecord,
} from "./core.js";

/**
 * Shared deterministic fixtures for the official evaluation. These turn each
 * frozen `evals/cases.json` case into side-effect-free in-memory providers so the
 * REAL intelligence stack (SemanticInterpreter + bounded agent + reconciliation +
 * policy) runs against frozen data — no network, no real CRM/Gmail, no mutation.
 */

export interface EvalCase {
  id: string;
  name: string;
  summary?: string;
  transcript: { source: string; turns: { speaker: string; role: string; text: string }[]; truncated?: boolean };
  hubspot?: {
    owners?: { id: string; name: string; email: string }[];
    contacts?: { id: string; email?: string; first_name?: string; last_name?: string; company_id?: string; lifecycle_stage?: string }[];
    companies?: { id: string; name: string; domain?: string }[];
    deals?: { id: string; name: string; stage: string; amount?: number | null; owner_id?: string; contact_id?: string; close_date?: string | null }[];
  };
  tasks?: { tasks: { id: string; title: string; type: string; status: string; due_date?: string | null; owner_id?: string | null; contact_id?: string | null; deal_id?: string | null }[] };
  commercial?: {
    available: boolean;
    reason?: string;
    subscriptions: { id: string; company_id: string; plan?: string; status: string; trial_start?: string | null; trial_end?: string | null; grace_period_end?: string | null; active_since?: string | null; exception?: unknown }[];
  };
}

export interface EvalExpected {
  id: string;
  name: string;
  semantic_interpretation: { has_confirmed_commitment: boolean; commitments: unknown[] };
  owner_date_resolution: { owner_status: string; date_status: string };
  required_retrieval: { sources: string[] };
  reconciliation_classification: string;
  proposed_actions: unknown[];
  review_requirements: { requires_human_review: boolean };
  must_not_execute: string[];
}

export function buildInteractionText(c: EvalCase): string {
  return c.transcript.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

export function accountIdOf(c: EvalCase): string {
  return c.hubspot?.companies?.[0]?.id ?? c.hubspot?.contacts?.[0]?.company_id ?? "unknown";
}

type HubContact = NonNullable<NonNullable<EvalCase["hubspot"]>["contacts"]>[number];
type HubDeal = NonNullable<NonNullable<EvalCase["hubspot"]>["deals"]>[number];
type HubTask = NonNullable<EvalCase["tasks"]>["tasks"][number];
type Sub = NonNullable<EvalCase["commercial"]>["subscriptions"][number];

function mapContact(c: HubContact): ContactRecord {
  return { id: c.id, accountId: c.company_id, email: c.email ?? null, firstName: c.first_name ?? null, lastName: c.last_name ?? null, lifecycleStage: c.lifecycle_stage ?? null };
}
function mapDeal(d: HubDeal): DealRecord {
  return { id: d.id, name: d.name, stage: d.stage, amount: d.amount ?? null, ownerId: d.owner_id ?? null, closeDate: d.close_date ?? null, nextStep: null };
}
function mapTask(t: HubTask): TaskRecord {
  return { id: t.id, contactId: t.contact_id ?? null, dealId: t.deal_id ?? null, ownerId: t.owner_id ?? null, title: t.title, type: t.type, status: t.status, dueDate: t.due_date ?? null };
}
function mapSubscription(sub: Sub): CommercialState {
  const isActive = sub.status === "active";
  const trialActive = sub.status === "trial";
  const trialStatus: "active" | "ended" | "not_started" = trialActive ? "active" : sub.trial_end ? "ended" : "not_started";
  return {
    accountId: sub.company_id,
    trial: { status: trialStatus, startedAt: sub.trial_start ?? null, endedAt: sub.trial_end ?? null, graceEndsAt: sub.grace_period_end ?? null },
    subscription: isActive ? { status: "active", plan: sub.plan ?? null, startedAt: sub.active_since ?? null } : null,
    commercialException: (sub.exception as CommercialState["commercialException"]) ?? null,
    provenance: "eval-fixture",
  };
}

export function buildReadContext(c: EvalCase): AgentReadContext {
  const contacts = (c.hubspot?.contacts ?? []).map(mapContact);
  const deals = (c.hubspot?.deals ?? []).map(mapDeal);
  const tasks = (c.tasks?.tasks ?? []).map(mapTask);
  const subs = c.commercial?.subscriptions ?? [];
  const findSub = (accountId: string) => subs.find((s) => s.company_id === accountId);

  const crm: CRMReadProvider = {
    resolveAccount: async (q) => (c.hubspot?.companies ?? []).filter((co) => co.name.toLowerCase().includes(q.toLowerCase())).map((co) => ({ id: co.id, name: co.name, domain: co.domain ?? null, source: "hubspot" as const })),
    getContacts: async () => contacts,
    getOpenDeal: async () => deals.find((d) => !["closedwon", "closedlost"].includes(d.stage.toLowerCase())) ?? null,
    getDeal: async (id) => deals.find((d) => d.id === id) ?? null,
    getRecentNotes: async () => [],
    getOpenTasks: async () => tasks,
    checkExistingAction: async (_a, sig) => tasks.find((t) => t.title.trim().toLowerCase() === (sig.title ?? "").trim().toLowerCase()) ?? null,
  };

  const email: EmailReadProvider = { getThread: async () => null, getMessage: async () => null, hasOutboundCommunication: async () => false, getDrafts: async () => [] };

  const commercial: CommercialStateReadProvider = {
    getCommercialState: async (accountId) => {
      if (c.commercial && c.commercial.available === false) throw new Error("commercial unavailable");
      const sub = findSub(accountId);
      if (!sub) throw new Error("no commercial state");
      return mapSubscription(sub);
    },
    getTrialState: async (accountId) => (findSub(accountId) ? mapSubscription(findSub(accountId)!).trial : null),
    getSubscriptionState: async (accountId) => (findSub(accountId) ? mapSubscription(findSub(accountId)!).subscription : null),
    getCustomerActivity: async () => null,
    getCommercialException: async (accountId) => (findSub(accountId) ? mapSubscription(findSub(accountId)!).commercialException : null),
  };

  return { crm, email, commercial };
}

export function toOperationalContext(toolCalls: AgentToolCall[]): OperationalContext {
  const ctx: OperationalContext = { contacts: [], openDeal: null, recentNotes: [], openTasks: [], commercialState: null, emailThread: null };
  for (const tc of toolCalls) {
    if (!tc.ok) continue;
    switch (tc.toolName) {
      case "get_contacts": ctx.contacts = tc.result as ContactRecord[]; break;
      case "get_open_deal": ctx.openDeal = tc.result as DealRecord | null; break;
      case "get_open_tasks": ctx.openTasks = tc.result as TaskRecord[]; break;
      case "get_commercial_state": ctx.commercialState = tc.result as CommercialState | null; break;
    }
  }
  return ctx;
}
