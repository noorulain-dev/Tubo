import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  ReasoningAgent,
  SemanticInterpreter,
  detectExecutionGaps,
  reconcile,
  reconcileOperationalState,
  type AgentReadContext,
  type AgentToolCall,
  type CommercialState,
  type CommercialStateReadProvider,
  type ContactRecord,
  type CRMReadProvider,
  type DealRecord,
  type EmailReadProvider,
  type LLMProvider,
  type LLMRequest,
  type OperationalContext,
  type TaskRecord,
} from "./core.js";

interface EvalCase {
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

interface EvalExpected {
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

const EVALS_DIR = resolve(process.cwd(), "../../evals");
const cases: EvalCase[] = JSON.parse(readFileSync(resolve(EVALS_DIR, "cases.json"), "utf-8")).cases;
const expectedList: EvalExpected[] = JSON.parse(readFileSync(resolve(EVALS_DIR, "expected.json"), "utf-8")).expected;

function buildInteractionText(c: EvalCase): string {
  return c.transcript.turns.map((t) => `${t.speaker}: ${t.text}`).join("\n");
}

function createEvalLLM(turns: EvalCase["transcript"]["turns"]): LLMProvider {
  return {
    generate: async (req: LLMRequest) => {
      const text = req.messages.find((m) => m.role === "user")?.content ?? "";
      const lower = text.toLowerCase();
      const state: Record<string, unknown> = {};
      const confirmed: Record<string, unknown>[] = [];
      const conditional: Record<string, unknown>[] = [];
      const signals: Record<string, unknown>[] = [];

      for (const turn of turns) {
        const t = turn.text;
        if (/\bif\b/i.test(t) && /\bI'll|we'll|will\b/i.test(t)) {
          const cond = (/\bif\b\s+([^,.]+)/i.exec(t)?.[1] ?? "").trim();
          const action = (/(?:I'll|we'll)\s+(.+?)(?:\.|$)/i.exec(t)?.[1] ?? "").trim();
          conditional.push({
            action: action || t,
            condition: cond ? `if ${cond}` : "unspecified",
            owner: turn.role === "internal" && !/team|someone/i.test(t) ? turn.speaker : null,
            evidence: [{ source: "conversation", start: 0, end: 0, text: (/\b(if|sign|provision|approve)\b/i.exec(t)?.[0] ?? t.slice(0, 12)) }],
            resolution: "ambiguous",
          });
        } else if (/\bI'll|we'll\b/i.test(t) && !/want to|intend|probably|maybe|thinking about/i.test(t)) {
          const action = (/(?:I'll|we'll)\s+(.+?)(?:\bby\b|\.|$)/i.exec(t)?.[1] ?? "").trim();
          const owner = turn.role === "internal" && !/team|someone/i.test(t) ? turn.speaker : null;
          const deadlineMatch = /\bby\s+(\w+(?:\s+\w+)?)/i.exec(t);
          confirmed.push({
            action: action || t.slice(0, 40),
            owner,
            deadline: deadlineMatch ? { text: deadlineMatch[1], value: null, resolution: "ambiguous" } : null,
            evidence: [{ source: "conversation", start: 0, end: 0, text: (/\b(send|proposal|provision|sign|finalize|follow|upgrade|questionnaire|docs|data|credentials)\b/i.exec(t)?.[0] ?? t.slice(0, 12)) }],
            resolution: owner ? "resolved" : "ambiguous",
          });
        }
      }

      if (/\b(has|have) subscribed|is (now )?paying|we (signed|are live|have signed)/i.test(lower)) {
        signals.push({ kind: "claims_subscribed", text: "claims subscribed", evidence: [{ source: "conversation", start: 0, end: 0, text: (/\b(subscribed|signed|paying)\b/i.exec(lower)?.[0] ?? "subscribed") }], resolution: "resolved" });
      } else if (/\bwant to subscribe|intend to upgrade|moving forward with the upgrade/i.test(lower)) {
        signals.push({ kind: "intent_to_subscribe", text: "intent to subscribe", evidence: [{ source: "conversation", start: 0, end: 0, text: (/\b(subscribe|upgrade)\b/i.exec(lower)?.[0] ?? "subscribe") }], resolution: "resolved" });
      } else if (/\btrial ended|gone silent|expired/i.test(lower)) {
        signals.push({ kind: "trial_ended", text: "trial ended", evidence: [{ source: "conversation", start: 0, end: 0, text: (/\b(trial ended|gone silent)\b/i.exec(lower)?.[0] ?? "trial") }], resolution: "resolved" });
      }

      if (confirmed.length) state.confirmedCommitments = confirmed;
      if (conditional.length) state.conditionalCommitments = conditional;
      if (signals.length) state.commercialSignals = signals;

      return {
        content: JSON.stringify(state),
        promptTokens: Math.ceil(text.length / 4),
        completionTokens: JSON.stringify(state).length / 4,
        totalTokens: 0,
        model: "eval-deterministic",
        latencyMs: 0,
      };
    },
  };
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

function buildReadContext(c: EvalCase): AgentReadContext {
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

function toOperationalContext(toolCalls: AgentToolCall[]): OperationalContext {
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

function accountIdOf(c: EvalCase): string {
  return c.hubspot?.companies?.[0]?.id ?? c.hubspot?.contacts?.[0]?.company_id ?? "unknown";
}

const EMPTY_SEMANTIC = { interactionId: "x", decisions: [], confirmedCommitments: [], candidateCommitments: [], conditionalCommitments: [], taskCandidates: [], commercialSignals: [], entityReferences: [], temporalExpressions: [], blockers: [], evidence: [] };

interface CaseResult {
  id: string;
  name: string;
  pass: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  layer: string;
  category: string;
  metrics: Record<string, number | string>;
  audit: string[];
}

async function runCase(c: EvalCase, exp: EvalExpected): Promise<CaseResult> {
  const started = Date.now();
  const text = buildInteractionText(c);
  const accountId = accountIdOf(c);

  const interpreter = new SemanticInterpreter(createEvalLLM(c.transcript.turns));
  const interpret = await interpreter.interpret({ text, kind: "note", truncated: c.transcript.truncated, interactionId: `eval_${c.id}` });

  const semantic = interpret.state;
  const evidenceValid = interpret.observability.evidenceValid;
  const semanticOk = interpret.ok;

  let classifications: string[] = [];
  let proposals: string[] = [];
  let toolNames: string[] = [];
  let gapTypes: string[] = [];
  const audit = ["interaction_received", `semantic_extraction_completed (valid=${semanticOk})`];

  if (semantic) {
    const agent = new ReasoningAgent(buildReadContext(c));
    const outcome = await agent.run({ state: semantic, accountId, metadata: {} });
    toolNames = outcome.toolCalls.map((t) => t.toolName);
    audit.push(`agent: ${outcome.toolCalls.length} tool calls`);

    const op = toOperationalContext(outcome.toolCalls);
    const findings = [...reconcile({ state: semantic, context: op }), ...reconcileOperationalState(op)];
    const gaps = detectExecutionGaps(findings);

    classifications = [...new Set(findings.map((f) => f.classification))];
    proposals = findings.filter((f) => f.proposedAction).map((f) => f.proposedAction!.type);
    gapTypes = gaps.map((g) => g.type);
    audit.push(`reconciliation: ${classifications.join(",") || "none"}`);
  }

  const commitmentCount = semantic?.confirmedCommitments.length ?? 0;
  const conditionalCount = semantic?.conditionalCommitments.length ?? 0;
  const signalCount = semantic?.commercialSignals.length ?? 0;
  const hasResolvedOwner = (semantic?.confirmedCommitments ?? []).some((cm) => cm.owner != null);

  const expCommitment = exp.semantic_interpretation.has_confirmed_commitment;
  const classificationMatch = classifications.includes(exp.reconciliation_classification);
  const commitmentRecall = expCommitment ? (commitmentCount > 0 ? 1 : 0) : 1;
  const commitmentPrecision = commitmentCount > 0 ? (expCommitment ? 1 : 0) : 1;
  const ownerAccuracy = (exp.owner_date_resolution.owner_status === "resolved") === hasResolvedOwner ? 1 : 0;
  const evidenceValidity = evidenceValid ? 1 : 0;

  let mustNotViolations = 0;
  for (const m of exp.must_not_execute) {
    const low = m.toLowerCase();
    if (low.includes("closed won") && proposals.includes("update_stage")) mustNotViolations++;
    if (low.includes("send") && proposals.includes("create_draft")) mustNotViolations++;
  }

  const pass = classificationMatch && mustNotViolations === 0;
  const layer = !semanticOk ? "A (semantics)" : !classificationMatch ? "C (reconciliation/policy)" : "—";
  const category = !semanticOk ? "semantic_failure" : !classificationMatch ? "classification_mismatch" : "pass";

  const latencyMs = Date.now() - started;

  return {
    id: c.id,
    name: c.name,
    pass,
    expected: {
      classification: exp.reconciliation_classification,
      commitment: expCommitment,
      owner_status: exp.owner_date_resolution.owner_status,
      review: exp.review_requirements.requires_human_review,
    },
    actual: {
      classifications,
      gaps: gapTypes,
      commitments: commitmentCount,
      conditional: conditionalCount,
      signals: signalCount,
      proposals,
      toolCalls: toolNames,
    },
    layer,
    category,
    metrics: {
      commitment_precision: commitmentPrecision,
      commitment_recall: commitmentRecall,
      owner_accuracy: ownerAccuracy,
      evidence_validity: evidenceValidity,
      classification_match: classificationMatch ? 1 : 0,
      must_not_execute_violations: mustNotViolations,
      tool_calls: toolNames.length,
      latency_ms: latencyMs,
      prompt_tokens: interpret.observability.inputTokens,
      completion_tokens: interpret.observability.outputTokens,
    },
    audit,
  };
}

function round(n: number, d = 2): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

async function main() {
  const results: CaseResult[] = [];
  for (const c of cases) {
    const exp = expectedList.find((e) => e.id === c.id);
    if (!exp) continue;
    results.push(await runCase(c, exp));
  }

  const n = results.length;
  const avg = (fn: (r: CaseResult) => number) => round(results.reduce((s, r) => s + fn(r), 0) / n);
  const sum = (fn: (r: CaseResult) => number) => results.reduce((s, r) => s + fn(r), 0);

  const aggregate = {
    cases_total: n,
    cases_passed: results.filter((r) => r.pass).length,
    cases_failed: results.filter((r) => !r.pass).length,
    layer_a: {
      commitment_precision: avg((r) => Number(r.metrics.commitment_precision)),
      commitment_recall: avg((r) => Number(r.metrics.commitment_recall)),
      owner_accuracy: avg((r) => Number(r.metrics.owner_accuracy)),
      evidence_validity: avg((r) => Number(r.metrics.evidence_validity)),
    },
    layer_b: {
      avg_tool_calls: avg((r) => Number(r.metrics.tool_calls)),
      total_tool_calls: sum((r) => Number(r.metrics.tool_calls)),
    },
    layer_c: {
      classification_accuracy: avg((r) => Number(r.metrics.classification_match)),
      must_not_execute_violations: sum((r) => Number(r.metrics.must_not_execute_violations)),
    },
    operational: {
      total_latency_ms: sum((r) => Number(r.metrics.latency_ms)),
      avg_latency_ms: avg((r) => Number(r.metrics.latency_ms)),
      total_prompt_tokens: sum((r) => Number(r.metrics.prompt_tokens)),
      total_completion_tokens: sum((r) => Number(r.metrics.completion_tokens)),
    },
  };

  const out = { meta: { runner: "v0", generatedAt: new Date().toISOString(), note: "Deterministic comparison; semantic layer uses a keyword stand-in LLM (no production LLM wired)." }, aggregate, cases: results };
  writeFileSync(resolve(EVALS_DIR, "v0-results.json"), JSON.stringify(out, null, 2));

  // CSV
  const header = ["case_id", "name", "pass", "expected_classification", "actual_classifications", "layer", "category", "commitment_precision", "commitment_recall", "owner_accuracy", "classification_match", "tool_calls", "latency_ms"];
  const csvLines = [header.join(",")];
  for (const r of results) {
    csvLines.push([r.id, `"${r.name}"`, r.pass, r.expected.classification, `"${(r.actual.classifications as string[]).join("|")}"`, r.layer, r.category, r.metrics.commitment_precision, r.metrics.commitment_recall, r.metrics.owner_accuracy, r.metrics.classification_match, r.metrics.tool_calls, r.metrics.latency_ms].join(","));
  }
  writeFileSync(resolve(EVALS_DIR, "v0-summary.csv"), csvLines.join("\n"));

  // Markdown
  const md: string[] = [
    "# Revenue Execution OS — v0 Evaluation Results",
    "",
    `Generated ${new Date().toISOString()} · deterministic comparison (no LLM judge).`,
    "",
    `**Cases: ${aggregate.cases_passed}/${aggregate.cases_total} passed**`,
    "",
    "## Aggregate metrics",
    "",
    "| Layer | Metric | Value |",
    "|---|---|---|",
    `| A | Commitment precision | ${aggregate.layer_a.commitment_precision} |`,
    `| A | Commitment recall | ${aggregate.layer_a.commitment_recall} |`,
    `| A | Owner accuracy | ${aggregate.layer_a.owner_accuracy} |`,
    `| A | Evidence validity | ${aggregate.layer_a.evidence_validity} |`,
    `| B | Avg tool calls/run | ${aggregate.layer_b.avg_tool_calls} |`,
    `| C | Classification accuracy | ${aggregate.layer_c.classification_accuracy} |`,
    `| C | Must-not-execute violations | ${aggregate.layer_c.must_not_execute_violations} |`,
    `| Ops | Avg latency (ms) | ${aggregate.operational.avg_latency_ms} |`,
    "",
    "## Per-case results",
    "",
    "| Case | Pass | Expected | Actual | Layer | Category |",
    "|---|---|---|---|---|---|",
  ];
  for (const r of results) {
    md.push(`| ${r.id} ${r.name} | ${r.pass ? "✅" : "❌"} | ${r.expected.classification} | ${(r.actual.classifications as string[]).join(", ") || "—"} | ${r.layer} | ${r.category} |`);
  }
  writeFileSync(resolve(EVALS_DIR, "v0-results.md"), md.join("\n"));

  // eslint-disable-next-line no-console
  console.log(`Evaluation complete: ${aggregate.cases_passed}/${aggregate.cases_total} passed. Wrote v0-results.json, v0-results.md, v0-summary.csv.`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(aggregate, null, 2));
}

void main();
