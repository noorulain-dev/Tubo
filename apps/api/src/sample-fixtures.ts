import {
  SyntheticCommercialStateProvider,
  type Account,
  type CommercialState,
  type ContactRecord,
  type CreateDraftInput,
  type CreateTaskInput,
  type CRMReadProvider,
  type CRMWriteProvider,
  type DealRecord,
  type EmailReadProvider,
  type EmailWriteProvider,
  type LLMProvider,
  type LLMRequest,
  type NoteRecord,
  type TaskRecord,
  type TaskSignature,
} from "./core.js";

// ---------------------------------------------------------------------------
// Demo scenario data
// ---------------------------------------------------------------------------

export interface DemoAccount {
  id: string;
  name: string;
  domain: string;
  sampleInteraction: string;
}

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: "demo_missing", name: "Northwind Logistics", domain: "northwind-logistics.com", sampleInteraction: "I'll send the final proposal to Northwind by Friday." },
  { id: "demo_aligned", name: "Cascade Manufacturing", domain: "cascade-mfg.com", sampleInteraction: "I'll send the proposal to Cascade by Friday." },
  { id: "demo_stale", name: "Fjord Analytics", domain: "fjord-analytics.com", sampleInteraction: "Fjord has subscribed and is now paying." },
  { id: "demo_closed_lost", name: "Orchard Systems", domain: "orchardsystems.com", sampleInteraction: "Orchard has gone silent since their trial ended last month." },
  { id: "demo_ambiguous", name: "Brightline Health", domain: "brightline-health.com", sampleInteraction: "I'll have the team send the security docs this week." },
  { id: "demo_unavailable", name: "Kingsbridge", domain: "kingsbridge.com", sampleInteraction: "We want to subscribe next quarter." },
];

interface DemoDeal {
  id: string;
  accountId: string;
  name: string;
  stage: string;
  ownerId: string;
}

function seedDeals(): Map<string, DemoDeal> {
  return new Map([
    ["demo_missing", { id: "deal_missing", accountId: "demo_missing", name: "Northwind Expansion", stage: "Proposal", ownerId: "owner_1" }],
    ["demo_aligned", { id: "deal_aligned", accountId: "demo_aligned", name: "Cascade Rollout", stage: "Negotiation", ownerId: "owner_1" }],
    ["demo_stale", { id: "deal_stale", accountId: "demo_stale", name: "Fjord Trial", stage: "Trial", ownerId: "owner_1" }],
    ["demo_closed_lost", { id: "deal_closed_lost", accountId: "demo_closed_lost", name: "Orchard Trial", stage: "Trial", ownerId: "owner_1" }],
    ["demo_ambiguous", { id: "deal_ambiguous", accountId: "demo_ambiguous", name: "Brightline Renewal", stage: "Renewal", ownerId: "owner_1" }],
    ["demo_unavailable", { id: "deal_unavailable", accountId: "demo_unavailable", name: "Kingsbridge Renewal", stage: "Renewal", ownerId: "owner_1" }],
  ]);
}

const CONTACTS: Record<string, ContactRecord[]> = {
  demo_missing: [{ id: "contact_missing", accountId: "demo_missing", email: "emily.torres@northwind-logistics.com", firstName: "Emily", lastName: "Torres" }],
  demo_aligned: [{ id: "contact_aligned", accountId: "demo_aligned", email: "dana@cascade-mfg.com", firstName: "Dana", lastName: "Whitfield" }],
  demo_ambiguous: [{ id: "contact_ambiguous", accountId: "demo_ambiguous", email: "procurement@brightline-health.com" }],
};

function seedTasks(): TaskRecord[] {
  return [
    { id: "task_aligned", accountId: "demo_aligned", title: "Send proposal", type: "EMAIL", status: "NOT_STARTED", dueDate: "2026-09-11" },
  ];
}

// ---------------------------------------------------------------------------
// Mutable sample state
// ---------------------------------------------------------------------------

export class SampleState {
  readonly mode = "sample" as const;
  companies: Account[];
  deals: Map<string, DemoDeal>;
  tasks: TaskRecord[];
  notes: string[];
  drafts: CreateDraftInput[];
  stageChanges: string[];

  constructor() {
    this.companies = DEMO_ACCOUNTS.map((a) => ({ id: a.id, name: a.name, domain: a.domain, source: "hubspot" as const }));
    this.deals = seedDeals();
    this.tasks = seedTasks();
    this.notes = [];
    this.drafts = [];
    this.stageChanges = [];
  }

  reset(): void {
    this.companies = DEMO_ACCOUNTS.map((a) => ({ id: a.id, name: a.name, domain: a.domain, source: "hubspot" as const }));
    this.deals = seedDeals();
    this.tasks = seedTasks();
    this.notes = [];
    this.drafts = [];
    this.stageChanges = [];
  }
}

// ---------------------------------------------------------------------------
// Commercial fixtures
// ---------------------------------------------------------------------------

function trialState(accountId: string): CommercialState {
  return { accountId, trial: { status: "active", startedAt: "2026-08-15T00:00:00Z", endedAt: "2026-09-15T00:00:00Z" }, subscription: null, commercialException: null, provenance: "sample-fixture" };
}
function activeSubState(accountId: string): CommercialState {
  return { accountId, trial: { status: "ended", startedAt: "2026-07-01T00:00:00Z", endedAt: "2026-08-01T00:00:00Z" }, subscription: { status: "active", plan: "pro", startedAt: "2026-08-01T00:00:00Z" }, commercialException: null, provenance: "sample-fixture" };
}
function expiredTrialState(accountId: string): CommercialState {
  return { accountId, trial: { status: "ended", startedAt: "2026-06-01T00:00:00Z", endedAt: "2026-07-01T00:00:00Z", graceEndsAt: "2026-07-15T00:00:00Z" }, subscription: null, commercialException: null, provenance: "sample-fixture" };
}

export function createSampleCommercial() {
  return new SyntheticCommercialStateProvider({
    fixtures: [
      trialState("demo_missing"),
      trialState("demo_aligned"),
      activeSubState("demo_stale"),
      expiredTrialState("demo_closed_lost"),
      trialState("demo_ambiguous"),
    ],
    unavailable: { demo_unavailable: "simulated commercial provider outage" },
  });
}

// ---------------------------------------------------------------------------
// Deterministic fixture LLM (stands in for the real semantic extractor)
// ---------------------------------------------------------------------------

export function createFixtureLLM(): LLMProvider {
  return {
    generate: async (req: LLMRequest) => {
      const user = req.messages.find((m) => m.role === "user")?.content ?? "";
      const lower = user.toLowerCase();
      const commitments: Record<string, unknown>[] = [];
      const signals: Record<string, unknown>[] = [];

      if (/send.*proposal/.test(lower)) {
        commitments.push({
          action: "send proposal",
          owner: "Sarah Chen",
          evidence: [{ source: "conversation", start: 0, end: 0, text: "proposal" }],
          resolution: "resolved",
        });
      }
      if (/\bteam\b/.test(lower)) {
        commitments.push({
          action: "send security docs",
          owner: null,
          evidence: [{ source: "conversation", start: 0, end: 0, text: "team" }],
          resolution: "ambiguous",
        });
      }
      if (/(has|have) subscribed|is now paying|are now paying/.test(lower)) {
        signals.push({
          kind: "claims_subscribed",
          text: "claims subscribed",
          evidence: [{ source: "conversation", start: 0, end: 0, text: "subscribed" }],
          resolution: "resolved",
        });
      } else if (/trial ended|gone silent/.test(lower)) {
        signals.push({
          kind: "trial_ended",
          text: "trial ended",
          evidence: [{ source: "conversation", start: 0, end: 0, text: "trial ended" }],
          resolution: "resolved",
        });
      } else if (/want to subscribe|intend to upgrade/.test(lower)) {
        signals.push({
          kind: "intent_to_subscribe",
          text: "intent to subscribe",
          evidence: [{ source: "conversation", start: 0, end: 0, text: "subscribe" }],
          resolution: "resolved",
        });
      }

      const state: Record<string, unknown> = {};
      if (commitments.length) state.confirmedCommitments = commitments;
      if (signals.length) state.commercialSignals = signals;

      return { content: JSON.stringify(state), promptTokens: 5, completionTokens: 5, totalTokens: 10, model: "sample-fixture", latencyMs: 0 };
    },
  };
}

// ---------------------------------------------------------------------------
// Providers backed by SampleState
// ---------------------------------------------------------------------------

function normalizeTitle(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

export function createCrmRead(state: SampleState): CRMReadProvider {
  return {
    resolveAccount: async (query) => {
      const q = query.toLowerCase();
      return state.companies.filter((c) => c.name.toLowerCase().includes(q) || c.domain?.toLowerCase().includes(q));
    },
    getContacts: async (accountId) => CONTACTS[accountId] ?? [],
    getOpenDeal: async (accountId) => {
      const deal = state.deals.get(accountId);
      if (!deal) return null;
      const closed = ["closedwon", "closedlost"].includes(deal.stage.toLowerCase());
      return closed ? null : { id: deal.id, accountId, name: deal.name, stage: deal.stage, ownerId: deal.ownerId, amount: null, closeDate: null, nextStep: null };
    },
    getDeal: async (dealId) => {
      for (const d of state.deals.values()) if (d.id === dealId) return { id: d.id, accountId: d.accountId, name: d.name, stage: d.stage, ownerId: d.ownerId, amount: null, closeDate: null, nextStep: null };
      return null;
    },
    getRecentNotes: async () => [] as NoteRecord[],
    getOpenTasks: async (accountId) => state.tasks.filter((t) => t.accountId === accountId),
    checkExistingAction: async (accountId, signature: TaskSignature) => {
      const title = signature.title ? normalizeTitle(signature.title) : undefined;
      return state.tasks.find((t) => t.accountId === accountId && (!title || normalizeTitle(t.title) === title)) ?? null;
    },
  };
}

export function createCrmWrite(state: SampleState): CRMWriteProvider {
  return {
    createNote: async (_accountId, body) => {
      state.notes.push(body);
      return { externalRef: `note_${state.notes.length}` };
    },
    createTask: async (input: CreateTaskInput) => {
      state.tasks.push({ id: `task_${state.tasks.length + 1}`, accountId: input.accountId, title: input.title, type: input.type, status: "NOT_STARTED", dueDate: input.dueDate ?? null, ownerId: input.ownerId ?? null });
      return { externalRef: `task_${state.tasks.length}` };
    },
    updateField: async () => ({ externalRef: "field_1" }),
    updateStage: async (dealId, stage) => {
      for (const d of state.deals.values()) {
        if (d.id === dealId) {
          state.stageChanges.push(`${d.accountId}: ${d.stage} -> ${stage}`);
          d.stage = stage;
        }
      }
      return { externalRef: dealId };
    },
  };
}

export function createEmailRead(state: SampleState): EmailReadProvider {
  return {
    getThread: async () => null,
    getMessage: async () => null,
    hasOutboundCommunication: async () => false,
    getDrafts: async () => state.drafts.map((d, i) => ({ id: `draft_${i}`, from: "me@company.com", to: d.to, subject: d.subject, body: d.body, sentAt: "", state: "draft" as const })),
  };
}

export function createEmailWrite(state: SampleState): EmailWriteProvider {
  return {
    createDraft: async (input: CreateDraftInput) => {
      state.drafts.push(input);
      return { externalRef: `draft_${state.drafts.length}` };
    },
  };
}

let activeState: SampleState | null = null;

export function getSampleState(): SampleState {
  if (!activeState) activeState = new SampleState();
  return activeState;
}

export function resetSampleData(): void {
  getSampleState().reset();
}
