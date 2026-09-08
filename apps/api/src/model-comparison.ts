import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  OpenAILLMProvider,
  ReasoningAgent,
  SemanticInterpreter,
  detectExecutionGaps,
  evaluateAction,
  isPlaceholderToken,
  loadConfig,
  reconcile,
  reconcileOperationalState,
  type PolicyContext,
} from "./core.js";
import {
  accountIdOf,
  buildInteractionText,
  buildReadContext,
  toOperationalContext,
  type EvalCase,
  type EvalExpected,
} from "./eval-shared.js";

/**
 * PRE-DEPLOY V4 — model benchmark + stability.
 *
 * PART 8/9: benchmark gpt-6-astra vs gpt-5.6-sol vs gpt-5.6-terra on the SAME
 * prompt/schema/fixtures (Responses API, effort "medium").
 *
 * PART 10: run the best-scoring candidate 3× and report mean/min/max + flips
 * (no cherry-picking).
 *
 * Writes evals/model-comparison-v4.json and evals/model-stability-v4.json.
 */

const EVALS_DIR = resolve(process.cwd(), "../../evals");
const cases = (JSON.parse(readFileSync(resolve(EVALS_DIR, "cases.json"), "utf-8")).cases as EvalCase[]);
const expectedList = (JSON.parse(readFileSync(resolve(EVALS_DIR, "expected.json"), "utf-8")).expected as EvalExpected[]);

const SOURCE_FOR_TOOL: Record<string, string> = {
  resolve_account: "hubspot",
  get_account_context: "hubspot",
  get_contacts: "hubspot",
  get_open_deal: "hubspot",
  get_recent_notes: "hubspot",
  get_open_tasks: "tasks",
  check_existing_action: "tasks",
  get_email_thread: "gmail",
  get_outbound_communication: "gmail",
  get_commercial_state: "commercial",
  get_customer_activity: "commercial",
  get_commercial_exception: "commercial",
};

const PARTICIPANT_ROLES = ["internal", "customer", "unknown", "system"] as const;

function participantsOf(c: EvalCase) {
  return (c.transcript.turns ?? []).map((t) => ({
    role: (PARTICIPANT_ROLES.includes(t.role as (typeof PARTICIPANT_ROLES)[number]) ? t.role : "unknown") as (typeof PARTICIPANT_ROLES)[number],
    name: t.speaker,
    email: null,
    identity: "resolved" as const,
  }));
}

function round(n: number, d = 3): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

interface CaseResult {
  id: string;
  pass: boolean;
  expectedClassification: string;
  actualClassifications: string[];
  commitmentPrecision: number;
  commitmentRecall: number;
  ownerAccuracy: number;
  dateAccuracy: number;
  requiredRetrievalRecall: number;
  toolCalls: number;
  unnecessaryToolCalls: number;
  classificationMatch: number;
  mustNotViolations: number;
  llmLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
}

async function runCase(c: EvalCase, exp: EvalExpected, llm: OpenAILLMProvider): Promise<CaseResult> {
  const started = Date.now();
  const text = buildInteractionText(c);
  const accountId = accountIdOf(c);
  const participants = participantsOf(c);

  const interpreter = new SemanticInterpreter(llm);
  const interpret = await interpreter.interpret({ text, kind: "note", truncated: c.transcript.truncated, participants, interactionId: `cmp_${c.id}` });
  const semantic = interpret.state;
  const semanticOk = interpret.ok;
  const evidenceValid = interpret.observability.evidenceValid;

  let classifications: string[] = [];
  let proposals: string[] = [];
  let tools: { tool: string; source: string | null; ok: boolean; fromCache: boolean }[] = [];
  let mustNotViolations = 0;

  if (semantic) {
    const agent = new ReasoningAgent(buildReadContext(c));
    const outcome = await agent.run({ state: semantic, accountId, metadata: {} });
    tools = outcome.toolCalls.map((tc) => ({
      tool: tc.toolName,
      source: SOURCE_FOR_TOOL[tc.toolName] ?? tc.source ?? null,
      ok: tc.ok,
      fromCache: tc.fromCache ?? false,
    }));

    const op = toOperationalContext(outcome.toolCalls);
    const findings = [...reconcile({ state: semantic, context: op }), ...reconcileOperationalState(op)];
    void detectExecutionGaps(findings);

    classifications = [...new Set(findings.map((f) => f.classification))];
    proposals = findings.filter((f) => f.proposedAction).map((f) => f.proposedAction!.type);

    const policyContext: PolicyContext = { commercialState: op.commercialState, openDeal: op.openDeal };
    for (const f of findings) {
      if (!f.proposedAction) continue;
      void evaluateAction({ type: f.proposedAction.type, payload: f.proposedAction.payload as Record<string, unknown> | undefined }, policyContext);
    }
  }

  const commitmentCount = semantic?.confirmedCommitments.length ?? 0;
  const hasResolvedOwner = (semantic?.confirmedCommitments ?? []).some((cm) => cm.owner != null);
  const hasResolvedDate = (semantic?.confirmedCommitments ?? []).some((cm) => cm.deadline?.value != null);
  const expCommitment = exp.semantic_interpretation.has_confirmed_commitment;
  const commitmentRecall = expCommitment ? (commitmentCount > 0 ? 1 : 0) : 1;
  const commitmentPrecision = commitmentCount > 0 ? (expCommitment ? 1 : 0) : 1;
  const ownerAccuracy = (exp.owner_date_resolution.owner_status === "resolved") === hasResolvedOwner ? 1 : 0;
  const dateAccuracy = (exp.owner_date_resolution.date_status === "resolved") === hasResolvedDate ? 1 : 0;

  const required = (exp.required_retrieval.sources ?? []).filter((s) => s !== "transcript");
  const retrieved = new Set(tools.filter((t) => t.ok).map((t) => t.source).filter((s): s is string => !!s));
  const requiredRecall = required.length === 0 ? 1 : required.filter((s) => retrieved.has(s)).length / required.length;
  const unnecessary = tools.filter((t) => t.source && !required.includes(t.source) && t.source !== "commercial").length;

  const classificationMatch = classifications.includes(exp.reconciliation_classification) ? 1 : 0;
  for (const m of exp.must_not_execute) {
    const low = m.toLowerCase();
    if (low.includes("closed won") && proposals.includes("update_stage")) mustNotViolations++;
    if (low.includes("send") && proposals.includes("create_draft")) mustNotViolations++;
  }
  const pass = classificationMatch === 1 && mustNotViolations === 0;

  return {
    id: c.id,
    pass,
    expectedClassification: exp.reconciliation_classification,
    actualClassifications: classifications,
    commitmentPrecision,
    commitmentRecall,
    ownerAccuracy,
    dateAccuracy,
    requiredRetrievalRecall: round(requiredRecall),
    toolCalls: tools.length,
    unnecessaryToolCalls: unnecessary,
    classificationMatch,
    mustNotViolations,
    llmLatencyMs: interpret.observability.latencyMs,
    promptTokens: interpret.observability.inputTokens,
    completionTokens: interpret.observability.outputTokens,
  };
}

function aggregate(results: CaseResult[]) {
  const n = results.length;
  const avg = (fn: (r: CaseResult) => number) => round(results.reduce((s, r) => s + fn(r), 0) / n);
  const sum = (fn: (r: CaseResult) => number) => results.reduce((s, r) => s + fn(r), 0);
  return {
    cases_total: n,
    cases_passed: results.filter((r) => r.pass).length,
    cases_failed: results.filter((r) => !r.pass).length,
    layer_a: {
      commitment_precision: avg((r) => r.commitmentPrecision),
      commitment_recall: avg((r) => r.commitmentRecall),
      owner_accuracy: avg((r) => r.ownerAccuracy),
      date_accuracy: avg((r) => r.dateAccuracy),
    },
    layer_b: {
      required_retrieval_recall: avg((r) => r.requiredRetrievalRecall),
      avg_tool_calls: avg((r) => r.toolCalls),
      total_tool_calls: sum((r) => r.toolCalls),
      unnecessary_tool_calls: sum((r) => r.unnecessaryToolCalls),
    },
    layer_c: {
      classification_accuracy: avg((r) => r.classificationMatch),
      must_not_execute_violations: sum((r) => r.mustNotViolations),
    },
    operational: {
      semantic_llm_total_latency_ms: sum((r) => r.llmLatencyMs),
      semantic_llm_avg_latency_ms: avg((r) => r.llmLatencyMs),
      total_prompt_tokens: sum((r) => r.promptTokens),
      total_completion_tokens: sum((r) => r.completionTokens),
    },
  };
}

function makeProvider(model: string, apiKey: string, baseUrl: string, reasoningEffort: string | undefined): OpenAILLMProvider {
  return new OpenAILLMProvider({ apiKey, model, baseUrl, reasoningEffort: reasoningEffort as "low" | "medium" | "high" | undefined });
}

async function runModel(model: string, apiKey: string, baseUrl: string, reasoningEffort: string | undefined): Promise<{ results: CaseResult[]; aggregate: ReturnType<typeof aggregate> }> {
  const llm = makeProvider(model, apiKey, baseUrl, reasoningEffort);
  const results: CaseResult[] = [];
  for (const c of cases) {
    const exp = expectedList.find((e) => e.id === c.id);
    if (!exp) continue;
    results.push(await runCase(c, exp, llm));
  }
  return { results, aggregate: aggregate(results) };
}

async function main(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) loadDotenv({ path: p });
  const config = loadConfig();
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  if (isPlaceholderToken(apiKey)) {
    process.stderr.write("✗ MODEL COMPARISON FAILED: no real LLM key.\n");
    process.exit(2);
  }
  const provider = config.openaiApiKey && !isPlaceholderToken(config.openaiApiKey) ? "openai" : "deepseek";
  const baseUrl = provider === "openai" ? config.openaiBaseUrl ?? "https://api.openai.com/v1" : config.deepseekBaseUrl ?? "https://api.openai.com/v1";

  const models = ["gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"];

  const comparison: Record<string, unknown> = {};
  for (const model of models) {
    process.stderr.write(`\n[benchmark] ${model} …\n`);
    const { results, aggregate: agg } = await runModel(model, apiKey!, baseUrl, config.openaiReasoningEffort);
    comparison[model] = {
      aggregate: agg,
      failures: results.filter((r) => !r.pass).map((r) => ({ id: r.id, expected: r.expectedClassification, actual: r.actualClassifications.join(", ") || "—" })),
    };
  }

  writeFileSync(resolve(EVALS_DIR, "model-comparison-v4.json"), JSON.stringify({
    meta: { generatedAt: new Date().toISOString(), provider, reasoningEffort: config.openaiReasoningEffort ?? "medium", models },
    models: comparison,
  }, null, 2));

  // PART 10: stability — best model (most passed, tie-break by classification accuracy), 3 runs.
  const entries = Object.entries(comparison).map(([model, v]) => ({ model, agg: (v as { aggregate: ReturnType<typeof aggregate> }).aggregate }));
  entries.sort((a, b) => (b.agg.cases_passed - a.agg.cases_passed) || (b.agg.layer_c.classification_accuracy - a.agg.layer_c.classification_accuracy));
  const bestModel = entries[0]?.model ?? models[0];

  process.stderr.write(`\n[stability] best model ${bestModel} (3×) …\n`);
  const stabilityRuns: { passed: number; failures: string[] }[] = [];
  const perCasePass: Record<string, boolean[]> = {};
  for (let i = 0; i < 3; i++) {
    const { results } = await runModel(bestModel, apiKey!, baseUrl, config.openaiReasoningEffort);
    const failed = results.filter((r) => !r.pass).map((r) => r.id);
    stabilityRuns.push({ passed: results.filter((r) => r.pass).length, failures: failed });
    for (const r of results) (perCasePass[r.id] ??= []).push(r.pass);
  }

  const flips = Object.entries(perCasePass)
    .filter(([, v]) => v.includes(true) && v.includes(false))
    .map(([id, v]) => ({ id, runs: v.map((x) => (x ? "pass" : "fail")) }));

  const passedList = stabilityRuns.map((s) => s.passed);
  const stability = {
    model: bestModel,
    runs: passedList,
    mean: round(passedList.reduce((a, b) => a + b, 0) / passedList.length),
    min: Math.min(...passedList),
    max: Math.max(...passedList),
    flips,
  };

  writeFileSync(resolve(EVALS_DIR, "model-stability-v4.json"), JSON.stringify({
    meta: { generatedAt: new Date().toISOString(), model: bestModel, runs: 3 },
    stability,
  }, null, 2));

  // eslint-disable-next-line no-console
  console.log(JSON.stringify({ bestModel, stability, comparison: Object.fromEntries(entries.map((e) => [e.model, e.agg.cases_passed])) }, null, 2));
}

void main();