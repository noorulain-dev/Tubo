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
} from "../shared/core.js";
import {
  accountIdOf,
  buildInteractionText,
  buildReadContext,
  toOperationalContext,
  type EvalCase,
  type EvalExpected,
} from "./eval-shared.js";

/**
 * SYSTEM V0 — the official final-system evaluation.
 *
 * Exercises the REAL Revenue Execution OS intelligence stack:
 *   Interaction → SemanticInterpreter(production LLM) → SemanticState
 *   → bounded ReasoningAgent → fixture-backed tool registry → source retrieval
 *   → reconciliation → execution-gap detection → deterministic policy.
 *
 * External providers are deterministic, frozen fixtures derived from each case
 * (no network, no real data, no mutation). The executor is NEVER invoked. If the
 * real LLM key is missing/invalid/unavailable, this evaluation FAILS — it never
 * silently falls back to a keyword/fake model.
 *
 * `evals/expected.json` is loaded once and used ONLY for post-hoc comparison;
 * it is never passed to the interpreter, the agent, any tool, or any prompt.
 */

const EVALS_DIR = resolve(process.cwd(), "../../evals");
const cases: EvalCase[] = JSON.parse(readFileSync(resolve(EVALS_DIR, "cases.json"), "utf-8")).cases;
const expectedList: EvalExpected[] = JSON.parse(readFileSync(resolve(EVALS_DIR, "expected.json"), "utf-8")).expected;

interface ToolMetric {
  tool: string;
  reasonCategory: string;
  source: string | null;
  ok: boolean;
  fromCache: boolean;
  latencyMs: number;
}

interface CaseResult {
  id: string;
  name: string;
  pass: boolean;
  expected: Record<string, unknown>;
  actual: Record<string, unknown>;
  layer: string;
  category: string;
  metrics: Record<string, number | string>;
  tools: ToolMetric[];
  safety: { recommended: number; policy_blocked: number; executed: number };
}

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

function runCase(c: EvalCase, exp: EvalExpected, llm: OpenAILLMProvider): Promise<CaseResult> {
  const started = Date.now();
  const text = buildInteractionText(c);
  const accountId = accountIdOf(c);

  const interpreter = new SemanticInterpreter(llm);
  const participants = (c.transcript.turns ?? []).map((t) => ({
    role: (["internal", "customer", "unknown", "system"].includes(t.role) ? t.role : "unknown") as "internal" | "customer" | "unknown" | "system",
    name: t.speaker,
    email: null,
    identity: "resolved" as const,
  }));

  return interpreter
    .interpret({ text, kind: "note", truncated: c.transcript.truncated, participants, interactionId: `sys_${c.id}` })
    .then(async (interpret) => {
      const semantic = interpret.state;
      const semanticOk = interpret.ok;
      const evidenceValid = interpret.observability.evidenceValid;

      let classifications: string[] = [];
      let proposals: string[] = [];
      let gapTypes: string[] = [];
      let policyActions: string[] = [];
      let tools: ToolMetric[] = [];
      let policyBlocked = 0;
      let incorrectExternalExecution = 0;

      if (semantic) {
        const agent = new ReasoningAgent(buildReadContext(c));
        const outcome = await agent.run({ state: semantic, accountId, metadata: {} });
        tools = outcome.toolCalls.map((tc) => ({
          tool: tc.toolName,
          reasonCategory: tc.reasonCategory ?? "",
          source: SOURCE_FOR_TOOL[tc.toolName] ?? tc.source ?? null,
          ok: tc.ok,
          fromCache: tc.fromCache ?? false,
          latencyMs: tc.latencyMs ?? 0,
        }));

        const op = toOperationalContext(outcome.toolCalls);
        const findings = [...reconcile({ state: semantic, context: op }), ...reconcileOperationalState(op)];
        const gaps = detectExecutionGaps(findings);

        classifications = [...new Set(findings.map((f) => f.classification))];
        proposals = findings.filter((f) => f.proposedAction).map((f) => f.proposedAction!.type);
        gapTypes = gaps.map((g) => g.type);

        const policyContext: PolicyContext = { commercialState: op.commercialState, openDeal: op.openDeal };
        for (const f of findings) {
          if (!f.proposedAction) continue;
          const ev = evaluateAction({ type: f.proposedAction.type, payload: f.proposedAction.payload as Record<string, unknown> | undefined }, policyContext);
          policyActions.push(ev.action);
          if (ev.action === "blocked") policyBlocked++;
          const consequential = ["update_stage", "create_draft", "update_field"].includes(f.proposedAction.type);
          if (consequential && (ev.action === "safe_to_prepare" || ev.action === "informational")) incorrectExternalExecution++;
        }
      }

      // ---- Layer A (semantic) ----
      const commitmentCount = semantic?.confirmedCommitments.length ?? 0;
      const hasResolvedOwner = (semantic?.confirmedCommitments ?? []).some((cm) => cm.owner != null);
      const hasResolvedDate = (semantic?.confirmedCommitments ?? []).some((cm) => cm.deadline?.value != null);

      const expCommitment = exp.semantic_interpretation.has_confirmed_commitment;
      const commitmentRecall = expCommitment ? (commitmentCount > 0 ? 1 : 0) : 1;
      const commitmentPrecision = commitmentCount > 0 ? (expCommitment ? 1 : 0) : 1;
      const ownerAccuracy = (exp.owner_date_resolution.owner_status === "resolved") === hasResolvedOwner ? 1 : 0;
      const dateAccuracy = (exp.owner_date_resolution.date_status === "resolved") === hasResolvedDate ? 1 : 0;

      // ---- Layer B (retrieval) ----
      const required = exp.required_retrieval.sources.filter((s) => s !== "transcript");
      const retrieved = new Set(tools.filter((t) => t.ok).map((t) => t.source).filter((s): s is string => !!s));
      const requiredRetrieved = required.filter((s) => retrieved.has(s));
      const requiredRecall = required.length === 0 ? 1 : requiredRetrieved.length / required.length;
      const unnecessaryCalls = tools.filter((t) => t.source && !required.includes(t.source) && t.source !== "commercial").length;
      const duplicateCalls = tools.filter((t) => t.fromCache).length;
      const toolFailures = tools.filter((t) => !t.ok).length;

      // ---- Layer C (classification/policy) ----
      const classificationMatch = classifications.includes(exp.reconciliation_classification);

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
        expected: { classification: exp.reconciliation_classification, commitment: expCommitment, owner_status: exp.owner_date_resolution.owner_status },
        actual: { classifications, gaps: gapTypes, proposals, policy_actions: policyActions, commitments: commitmentCount },
        layer,
        category,
        metrics: {
          commitment_precision: commitmentPrecision,
          commitment_recall: commitmentRecall,
          owner_accuracy: ownerAccuracy,
          date_accuracy: dateAccuracy,
          evidence_validity: evidenceValid ? 1 : 0,
          required_retrieval_recall: round(requiredRecall),
          tool_calls: tools.length,
          unnecessary_tool_calls: unnecessaryCalls,
          duplicate_tool_calls: duplicateCalls,
          tool_failures: toolFailures,
          classification_match: classificationMatch ? 1 : 0,
          must_not_execute_violations: mustNotViolations,
          incorrect_external_execution: incorrectExternalExecution,
          semantic_llm_latency_ms: interpret.observability.latencyMs,
          total_latency_ms: latencyMs,
          prompt_tokens: interpret.observability.inputTokens,
          completion_tokens: interpret.observability.outputTokens,
          cost_usd: interpret.observability.costUsd ?? 0,
        },
        tools,
        safety: { recommended: proposals.length, policy_blocked: policyBlocked, executed: 0 },
      };
    });
}

function round(n: number, d = 3): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

async function main(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    loadDotenv({ path: p });
  }
  const config = loadConfig();
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  if (isPlaceholderToken(apiKey)) {
    // Fail loudly — never silently fall back to a keyword/fake model.
    process.stderr.write("✗ SYSTEM EVALUATION FAILED: no real LLM API key configured (OPENAI_API_KEY or DEEPSEEK_API_KEY).\n");
    process.exit(2);
  }
  const provider = config.openaiApiKey && !isPlaceholderToken(config.openaiApiKey) ? "openai" : "deepseek";
  const model = provider === "openai" ? config.openaiModel ?? "gpt-4o" : config.deepseekModel ?? "deepseek-chat";
  const baseUrl = provider === "openai" ? config.openaiBaseUrl ?? "https://api.openai.com/v1" : config.deepseekBaseUrl ?? "https://api.openai.com/v1";
  const llm = new OpenAILLMProvider({ apiKey: apiKey!, model, baseUrl, reasoningEffort: config.openaiReasoningEffort });

  const results: CaseResult[] = [];
  for (const c of cases) {
    const exp = expectedList.find((e) => e.id === c.id);
    if (!exp) continue;
    results.push(await runCase(c, exp, llm));
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
      date_accuracy: avg((r) => Number(r.metrics.date_accuracy)),
      evidence_validity: avg((r) => Number(r.metrics.evidence_validity)),
    },
    layer_b: {
      required_retrieval_recall: avg((r) => Number(r.metrics.required_retrieval_recall)),
      avg_tool_calls: avg((r) => Number(r.metrics.tool_calls)),
      total_tool_calls: sum((r) => Number(r.metrics.tool_calls)),
      unnecessary_tool_calls: sum((r) => Number(r.metrics.unnecessary_tool_calls)),
      duplicate_tool_calls: sum((r) => Number(r.metrics.duplicate_tool_calls)),
      tool_failures: sum((r) => Number(r.metrics.tool_failures)),
    },
    layer_c: {
      classification_accuracy: avg((r) => Number(r.metrics.classification_match)),
      must_not_execute_violations: sum((r) => Number(r.metrics.must_not_execute_violations)),
      incorrect_external_execution: sum((r) => Number(r.metrics.incorrect_external_execution)),
    },
    safety: {
      total_recommended: sum((r) => r.safety.recommended),
      total_policy_blocked: sum((r) => r.safety.policy_blocked),
      total_executed: sum((r) => r.safety.executed),
    },
    operational: {
      semantic_llm_total_latency_ms: sum((r) => Number(r.metrics.semantic_llm_latency_ms)),
      semantic_llm_avg_latency_ms: avg((r) => Number(r.metrics.semantic_llm_latency_ms)),
      total_run_latency_ms: sum((r) => Number(r.metrics.total_latency_ms)),
      total_prompt_tokens: sum((r) => Number(r.metrics.prompt_tokens)),
      total_completion_tokens: sum((r) => Number(r.metrics.completion_tokens)),
      estimated_cost_usd: round(sum((r) => Number(r.metrics.cost_usd)), 4),
    },
  };

  const failures = results.filter((r) => !r.pass).map((r) => ({ id: r.id, name: r.name, layer: r.layer, category: r.category, expected: r.expected.classification, actual: (r.actual.classifications as string[]).join(", ") || "—" }));

  const out = {
    meta: {
      runner: "system-v0",
      generatedAt: new Date().toISOString(),
      semantic_provider: provider,
      semantic_model: model,
      agent_provider: provider,
      agent_model: model,
      note: "REAL production SemanticInterpreter + OpenAI-compatible LLM, bounded deterministic agent, frozen fixture providers, no executor, no fallback to a keyword model.",
    },
    aggregate,
    failures,
    cases: results,
  };
  writeFileSync(resolve(EVALS_DIR, "system-v0-results.json"), JSON.stringify(out, null, 2));

  const md: string[] = [
    "# Revenue Execution OS — system-v0 Evaluation Results",
    "",
    `Generated ${new Date().toISOString()} · REAL ${provider}/${model} semantic+agent, deterministic fixture providers.`,
    "",
    `**Cases: ${aggregate.cases_passed}/${aggregate.cases_total} passed**`,
    "",
    "## Aggregate metrics",
    "",
    "| Layer | Metric | Value |",
    "|---|---|---|",
    `| A | Commitment precision / recall | ${aggregate.layer_a.commitment_precision} / ${aggregate.layer_a.commitment_recall} |`,
    `| A | Owner accuracy | ${aggregate.layer_a.owner_accuracy} |`,
    `| A | Date accuracy | ${aggregate.layer_a.date_accuracy} |`,
    `| A | Evidence validity | ${aggregate.layer_a.evidence_validity} |`,
    `| B | Required-retrieval recall | ${aggregate.layer_b.required_retrieval_recall} |`,
    `| B | Avg / total tool calls | ${aggregate.layer_b.avg_tool_calls} / ${aggregate.layer_b.total_tool_calls} |`,
    `| B | Unnecessary / duplicate / failed calls | ${aggregate.layer_b.unnecessary_tool_calls} / ${aggregate.layer_b.duplicate_tool_calls} / ${aggregate.layer_b.tool_failures} |`,
    `| C | Classification accuracy | ${aggregate.layer_c.classification_accuracy} |`,
    `| C | Must-not-execute violations | ${aggregate.layer_c.must_not_execute_violations} |`,
    `| C | Incorrect external execution | ${aggregate.layer_c.incorrect_external_execution} |`,
    `| Safety | recommended / policy-blocked / executed | ${aggregate.safety.total_recommended} / ${aggregate.safety.total_policy_blocked} / ${aggregate.safety.total_executed} |`,
    `| Ops | LLM avg latency (ms) | ${aggregate.operational.semantic_llm_avg_latency_ms} |`,
    `| Ops | Prompt / completion tokens | ${aggregate.operational.total_prompt_tokens} / ${aggregate.operational.total_completion_tokens} |`,
    `| Ops | Estimated cost (USD) | ${aggregate.operational.estimated_cost_usd} |`,
    "",
    "## Failure list",
    "",
    "| Case | Expected | Actual | Layer |",
    "|---|---|---|---|",
  ];
  for (const f of failures) md.push(`| ${f.id} ${f.name} | ${f.expected} | ${f.actual} | ${f.layer} |`);
  md.push("");
  md.push("## Per-case results");
  md.push("");
  md.push("| Case | Pass | Expected | Actual | Tool calls |");
  md.push("|---|---|---|---|---|");
  for (const r of results) {
    md.push(`| ${r.id} ${r.name} | ${r.pass ? "✅" : "❌"} | ${r.expected.classification} | ${(r.actual.classifications as string[]).join(", ") || "—"} | ${r.metrics.tool_calls} |`);
  }
  writeFileSync(resolve(EVALS_DIR, "system-v0-summary.md"), md.join("\n"));

  const csvHeader = "case_id,name,pass,expected_classification,actual_classifications,commitment_precision,commitment_recall,owner_accuracy,date_accuracy,required_retrieval_recall,tool_calls,classification_match,llm_latency_ms,prompt_tokens,completion_tokens";
  const csvLines = [csvHeader];
  for (const r of results) {
    csvLines.push([r.id, `"${r.name}"`, r.pass, r.expected.classification, `"${(r.actual.classifications as string[]).join("|")}"`, r.metrics.commitment_precision, r.metrics.commitment_recall, r.metrics.owner_accuracy, r.metrics.date_accuracy, r.metrics.required_retrieval_recall, r.metrics.tool_calls, r.metrics.classification_match, r.metrics.semantic_llm_latency_ms, r.metrics.prompt_tokens, r.metrics.completion_tokens].join(","));
  }
  writeFileSync(resolve(EVALS_DIR, "system-v0-results.csv"), csvLines.join("\n"));

  // eslint-disable-next-line no-console
  console.log(`SYSTEM V0 complete: ${aggregate.cases_passed}/${aggregate.cases_total} passed (${provider}/${model}).`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(aggregate, null, 2));
}

void main();
