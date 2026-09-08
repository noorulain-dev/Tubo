import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  buildState,
  type AccountEvent,
  type AccountEventType,
} from "./state-builder.js";
import { scanAccount, type Finding } from "./risk-scanner.js";
import { Investigator, type InvestigationOutcome } from "./investigation.js";
import { evaluateAction, type AgentReadContext } from "./core.js";

/**
 * Supplemental multi-event operating-state evaluation (8 scenarios).
 *
 * Each scenario is a sequence of authored AccountEvents folded through the REAL
 * Account Intelligence state builder, then the REAL risk scanner, and (where
 * applicable) the REAL read-only AI Investigator and deterministic policy.
 * Expected outputs (os-expected.json) are loaded once for post-hoc comparison and
 * are never passed to any model prompt (there is no model prompt here — the
 * multi-event state machine and scanner are deterministic).
 */

const REFERENCE_NOW = "2026-09-10T00:00:00Z";
const EVALS_DIR = resolve(process.cwd(), "../../evals");

interface OsCase {
  id: string;
  name: string;
  events: { eventType: AccountEventType; occurredAt: string; source: string; payload: Record<string, unknown> }[];
  fixtures?: { tasks?: { id: string; title: string; status: string }[] };
}

interface OsExpected {
  id: string;
  name: string;
  commitment_status: string | null;
  question_status: string | null;
  blockers: string[];
  findings: string[];
  severity: string | null;
  investigation_outcome: string | null;
  proposed_action: string | null;
  review_requirement: boolean;
  must_not_execute: string[];
}

const cases = (JSON.parse(readFileSync(resolve(EVALS_DIR, "os-cases.json"), "utf-8")).cases as OsCase[]);
const expectedList = (JSON.parse(readFileSync(resolve(EVALS_DIR, "os-expected.json"), "utf-8")).expected as OsExpected[]);

function toEvents(c: OsCase): AccountEvent[] {
  return c.events.map((e, i) => ({
    eventId: `${c.id}_${i}`,
    userId: "u1",
    accountId: "acct",
    eventType: e.eventType,
    occurredAt: e.occurredAt,
    source: e.source,
    sourceReference: null,
    payload: e.payload,
    provenance: "os-eval",
  }));
}

function buildReadContext(c: OsCase): AgentReadContext {
  const tasks = (c.fixtures?.tasks ?? []).map((t) => ({
    id: t.id,
    contactId: null,
    dealId: null,
    ownerId: null,
    title: t.title,
    type: "TODO",
    status: t.status,
    dueDate: null,
  }));
  const crm = {
    resolveAccount: async () => [],
    getContacts: async () => [],
    getOpenDeal: async () => null,
    getDeal: async () => null,
    getRecentNotes: async () => [],
    getOpenTasks: async () => tasks,
    checkExistingAction: async (_a: string, sig: { title?: string }) => tasks.find((t) => t.title.trim().toLowerCase() === (sig.title ?? "").trim().toLowerCase()) ?? null,
  };
  const email = { getThread: async () => null, getMessage: async () => null, hasOutboundCommunication: async () => false, getDrafts: async () => [] };
  const commercial = { getCommercialState: async () => ({ accountId: "acct", trial: null, subscription: null, commercialException: null, provenance: "os-eval" }), getCustomerActivity: async () => null, getCommercialException: async () => null };
  return { crm, email, commercial } as unknown as AgentReadContext;
}

/** Deterministic recommendation derived from scanner finding types (never from LLM). */
function recommendAction(findingTypes: string[]): { type: string; payload: Record<string, unknown> } | null {
  if (findingTypes.includes("commercial_crm_mismatch")) return { type: "update_stage", payload: { stage: "negotiation" } };
  if (findingTypes.includes("overdue_internal_commitment")) return { type: "create_task", payload: { title: "Follow up on overdue commitment" } };
  if (findingTypes.includes("unanswered_customer_question")) return { type: "create_draft", payload: { subject: "Re: your question" } };
  if (findingTypes.includes("missing_operational_task")) return { type: "create_task", payload: { title: "Create missing task" } };
  return null;
}

function runCase(c: OsCase, exp: OsExpected) {
  const snapshot = buildState(toEvents(c), { now: REFERENCE_NOW });

  const commitmentStatus = snapshot.commitments[0]?.status ?? null;
  const questionStatus = snapshot.questions[0]?.status ?? null;
  const blockers = snapshot.blockers ?? [];

  const findings = scanAccount({ userId: "u1", accountId: "acct", snapshot, now: REFERENCE_NOW }).filter((f) => f.status === "open");
  const findingTypes = [...new Set(findings.map((f) => f.type))];
  const highestSeverity = findings.length === 0 ? null : findings.reduce((m, f) => (sevRank(f.severity) > sevRank(m.severity) ? f : m)).severity;

  let investigationOutcome: InvestigationOutcome | null = null;
  if (findingTypes.includes("missing_operational_task") && c.fixtures) {
    const investigator = new Investigator(buildReadContext(c));
    // Investigate the first missing_operational_task finding.
    const f = findings.find((x) => x.type === "missing_operational_task");
    if (f) {
      // synchronous wrapper around Promise (run top-level async below)
      return investigator.investigate(f, "acct").then((res) => {
        return finishCase(c, exp, { snapshot, commitmentStatus, questionStatus, blockers, findingTypes, highestSeverity, findings, investigationOutcome: res.outcome });
      });
    }
  }
  return Promise.resolve(finishCase(c, exp, { snapshot, commitmentStatus, questionStatus, blockers, findingTypes, highestSeverity, findings, investigationOutcome }));
}

function sevRank(s: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[s] ?? 0;
}

function finishCase(
  c: OsCase,
  exp: OsExpected,
  r: { snapshot: ReturnType<typeof buildState>; commitmentStatus: string | null; questionStatus: string | null; blockers: string[]; findingTypes: string[]; highestSeverity: string | null; findings: Finding[]; investigationOutcome: InvestigationOutcome | null },
) {
  // A rejected AI Investigation removes its finding from proposal consideration.
  const effectiveFindings = r.investigationOutcome === "rejected" ? r.findingTypes.filter((t) => t !== "missing_operational_task") : r.findingTypes;
  const recommended = recommendAction(effectiveFindings);
  const proposedAction = recommended?.type ?? null;
  const reviewRequirement = recommended ? evaluateAction({ type: recommended.type, payload: recommended.payload }, { commercialState: null, openDeal: null }).requiresApproval : false;

  let mustNotViolations = 0;
  if (recommended) {
    const payloadText = JSON.stringify(recommended.payload).toLowerCase();
    for (const m of exp.must_not_execute) {
      const low = m.toLowerCase();
      if (low.includes("closed won") && recommended.type === "update_stage" && payloadText.includes("closedwon")) mustNotViolations++;
      if (low.includes("send") && recommended.type === "create_draft" && payloadText.includes('"send":true')) mustNotViolations++;
    }
  }

  const findingsOk = exp.findings.every((t) => r.findingTypes.includes(t));
  const severityOk = exp.severity === null ? true : r.highestSeverity === exp.severity;

  const checks = {
    commitment_status: exp.commitment_status === r.commitmentStatus,
    question_status: exp.question_status === r.questionStatus,
    blockers: JSON.stringify(exp.blockers) === JSON.stringify(r.blockers),
    findings: findingsOk,
    severity: severityOk,
    investigation_outcome: exp.investigation_outcome === null ? r.investigationOutcome === null : exp.investigation_outcome === r.investigationOutcome,
    proposed_action: exp.proposed_action === proposedAction,
    review_requirement: exp.review_requirement === reviewRequirement,
    must_not_execute: mustNotViolations === 0,
  };

  const pass = Object.values(checks).every(Boolean);
  const failedChecks = Object.entries(checks).filter(([, v]) => !v).map(([k]) => k);

  return {
    id: c.id,
    name: c.name,
    pass,
    failedChecks,
    expected: {
      commitment_status: exp.commitment_status,
      question_status: exp.question_status,
      blockers: exp.blockers,
      findings: exp.findings,
      severity: exp.severity,
      investigation_outcome: exp.investigation_outcome,
      proposed_action: exp.proposed_action,
      review_requirement: exp.review_requirement,
    },
    actual: {
      commitment_status: r.commitmentStatus,
      question_status: r.questionStatus,
      blockers: r.blockers,
      findings: r.findingTypes,
      severity: r.highestSeverity,
      investigation_outcome: r.investigationOutcome,
      proposed_action: proposedAction,
      review_requirement: reviewRequirement,
      snapshot_version: r.snapshot.version,
    },
  };
}

function round(n: number, d = 2): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

async function main(): Promise<void> {
  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  for (const c of cases) {
    const exp = expectedList.find((e) => e.id === c.id);
    if (!exp) continue;
    results.push(await runCase(c, exp));
  }

  const passed = results.filter((r) => r.pass).length;
  const out = {
    meta: { runner: "os-v0", generatedAt: new Date().toISOString(), reference_now: REFERENCE_NOW, note: "Deterministic multi-event state-machine evaluation (state builder + risk scanner + read-only investigator + policy). No model prompt involved; expected outputs are never exposed." },
    aggregate: { cases_total: results.length, cases_passed: passed, cases_failed: results.length - passed, pass_rate: round(passed / results.length) },
    failures: results.filter((r) => !r.pass).map((r) => ({ id: r.id, name: r.name, failed_checks: r.failedChecks })),
    cases: results,
  };
  writeFileSync(resolve(EVALS_DIR, "os-v0-results.json"), JSON.stringify(out, null, 2));

  const md: string[] = [
    "# Revenue Execution OS — os-v0 (multi-event) Evaluation Results",
    "",
    `Generated ${new Date().toISOString()} · deterministic state machine, no LLM.`,
    "",
    `**Cases: ${passed}/${results.length} passed**`,
    "",
    "## Failure list",
    "",
    "| Case | Failed checks |",
    "|---|---|",
  ];
  for (const r of out.failures) md.push(`| ${r.id} ${r.name} | ${r.failed_checks.join(", ")} |`);
  md.push("");
  md.push("## Per-case results");
  md.push("");
  md.push("| Case | Pass | Commitment | Question | Blockers | Findings | Severity | Investigation | Proposed |");
  md.push("|---|---|---|---|---|---|---|---|---|");
  for (const r of results) {
    md.push(`| ${r.id} ${r.name} | ${r.pass ? "✅" : "❌"} | ${r.actual.commitment_status ?? "—"} | ${r.actual.question_status ?? "—"} | ${JSON.stringify(r.actual.blockers)} | ${r.actual.findings.join(", ") || "—"} | ${r.actual.severity ?? "—"} | ${r.actual.investigation_outcome ?? "—"} | ${r.actual.proposed_action ?? "—"} |`);
  }
  writeFileSync(resolve(EVALS_DIR, "os-v0-summary.md"), md.join("\n"));

  // eslint-disable-next-line no-console
  console.log(`OS V0 complete: ${passed}/${results.length} passed. Wrote os-v0-results.json, os-v0-summary.md.`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out.aggregate, null, 2));
}

void main();