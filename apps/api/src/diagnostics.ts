import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  OpenAILLMProvider,
  ReasoningAgent,
  SemanticInterpreter,
  isPlaceholderToken,
  loadConfig,
  reconcile,
  reconcileOperationalState,
} from "./core.js";
import {
  accountIdOf,
  buildInteractionText,
  buildReadContext,
  toOperationalContext,
  type EvalCase,
  type EvalExpected,
} from "./eval-shared.js";

const EVALS_DIR = resolve(process.cwd(), "../../evals");
const DIAG_DIR = resolve(EVALS_DIR, "diagnostics");
const cases = (JSON.parse(readFileSync(resolve(EVALS_DIR, "cases.json"), "utf-8")).cases as EvalCase[]);
const expectedList = (JSON.parse(readFileSync(resolve(EVALS_DIR, "expected.json"), "utf-8")).expected as EvalExpected[]);

const SOURCE_FOR_TOOL: Record<string, string> = {
  get_contacts: "hubspot", get_open_deal: "hubspot", get_recent_notes: "hubspot", resolve_account: "hubspot",
  get_open_tasks: "tasks", check_existing_action: "tasks",
  get_commercial_state: "commercial", get_customer_activity: "commercial", get_commercial_exception: "commercial",
  get_email_thread: "gmail",
  get_outbound_communication: "gmail",
};

type Attribution =
  | "SEMANTIC_MODEL" | "SEMANTIC_PROMPT" | "SEMANTIC_SCHEMA" | "AGENT_RETRIEVAL"
  | "PROVIDER_FIXTURE" | "RECONCILIATION_LOGIC" | "GAP_LOGIC" | "POLICY_LOGIC"
  | "EVALUATOR_LOGIC" | "GROUND_TRUTH_QUESTION";

async function main(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) loadDotenv({ path: p });
  const config = loadConfig();
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  if (isPlaceholderToken(apiKey)) { process.stderr.write("✗ real LLM key required.\n"); process.exit(2); }
  const provider = config.openaiApiKey && !isPlaceholderToken(config.openaiApiKey) ? "openai" : "deepseek";
  const model = provider === "openai" ? config.openaiModel ?? "gpt-4o" : config.deepseekModel ?? "deepseek-chat";
  const baseUrl = provider === "openai" ? config.openaiBaseUrl ?? "https://api.openai.com/v1" : config.deepseekBaseUrl ?? "https://api.openai.com/v1";
  const interpreter = new SemanticInterpreter(new OpenAILLMProvider({ apiKey: apiKey!, model, baseUrl, reasoningEffort: config.openaiReasoningEffort }));

  mkdirSync(DIAG_DIR, { recursive: true });
  const attribCount: Record<string, number> = {};
  const rows: { id: string; attribution: Attribution; expected: string; actual: string }[] = [];

  for (const c of cases) {
    const exp = expectedList.find((e) => e.id === c.id);
    if (!exp) continue;
    const accountId = accountIdOf(c);
    const text = buildInteractionText(c);
    const interpret = await interpreter.interpret({ text, kind: "note", truncated: c.transcript.truncated, interactionId: `diag_${c.id}` });
    const s = interpret.state;

    const commitments = s?.confirmedCommitments ?? [];
    const hasResolvedOwner = commitments.some((cm) => cm.owner != null);
    const hasResolvedDate = commitments.some((cm) => cm.deadline?.value != null);
    const signalKinds = (s?.commercialSignals ?? []).map((sg) => sg.kind);

    let toolCalls: { tool: string; reason: string; ok: boolean }[] = [];
    let classifications: string[] = [];
    let requiredRetrieved: string[] = [];
    if (s) {
      const agent = new ReasoningAgent(buildReadContext(c));
      const outcome = await agent.run({ state: s, accountId, metadata: {} });
      toolCalls = outcome.toolCalls.map((tc) => ({ tool: tc.toolName, reason: tc.reasonCategory ?? "", ok: tc.ok }));
      const op = toOperationalContext(outcome.toolCalls);
      const findings = [...reconcile({ state: s, context: op }), ...reconcileOperationalState(op)];
      classifications = [...new Set(findings.map((f) => f.classification))];
      requiredRetrieved = [...new Set(toolCalls.filter((t) => t.ok).map((t) => SOURCE_FOR_TOOL[t.tool]).filter((x): x is string => !!x))];
    }

    const required = (exp.required_retrieval.sources ?? []).filter((x) => x !== "transcript");
    const missingRequired = required.filter((x) => !requiredRetrieved.includes(x));

    // Attribution (general, no case ids).
    let attribution: Attribution;
    const expCommitment = exp.semantic_interpretation.has_confirmed_commitment;
    if ((commitments.length > 0) !== expCommitment) {
      attribution = "SEMANTIC_MODEL"; // presence of a commitment diverged
    } else if (commitments.length > 0) {
      const ownerMismatch = (exp.owner_date_resolution.owner_status === "resolved") !== hasResolvedOwner;
      const dateMismatch = (exp.owner_date_resolution.date_status === "resolved") !== hasResolvedDate;
      if (ownerMismatch || dateMismatch) attribution = "SEMANTIC_MODEL";
      else if (!classifications.includes(exp.reconciliation_classification)) attribution = "RECONCILIATION_LOGIC";
      else attribution = "RECONCILIATION_LOGIC";
    } else if (!classifications.includes(exp.reconciliation_classification)) {
      // No commitment, no gap should be ALIGNED/NO ACTION. If we returned MISSING, it's reconciliation.
      attribution = classifications.includes("missing") ? "RECONCILIATION_LOGIC" : (missingRequired.length > 0 ? "AGENT_RETRIEVAL" : "SEMANTIC_MODEL");
    } else {
      attribution = "GROUND_TRUTH_QUESTION";
    }

    attribCount[attribution] = (attribCount[attribution] ?? 0) + 1;
    rows.push({ id: c.id, attribution, expected: exp.reconciliation_classification, actual: classifications.join(",") || "—" });

    writeFileSync(resolve(DIAG_DIR, `${c.id}.json`), JSON.stringify({
      id: c.id, name: c.name,
      input: { interaction_text: text, account_id: accountId },
      expected: {
        has_confirmed_commitment: exp.semantic_interpretation.has_confirmed_commitment,
        owner_status: exp.owner_date_resolution.owner_status,
        date_status: exp.owner_date_resolution.date_status,
        required_retrieval: required,
        reconciliation_classification: exp.reconciliation_classification,
      },
      actual_semantic: {
        commitment_count: commitments.length,
        has_resolved_owner: hasResolvedOwner,
        has_resolved_date: hasResolvedDate,
        commitments: commitments.map((cm) => ({ action: cm.action, owner: cm.owner, resolution: cm.resolution, deadline_value: cm.deadline?.value ?? null })),
        signal_kinds: signalKinds,
        semantic_ok: interpret.ok,
        semantic_errors: interpret.errors,
      },
      agent: {
        tools_selected: toolCalls,
        required_retrieved: requiredRetrieved,
        missing_required: missingRequired,
      },
      reconciliation: { classifications },
      first_divergence: attribution,
    }, null, 2));
  }

  const md = ["# Intelligence failure attribution (gpt-4o)", "", "| Case | Expected | Actual | Primary cause |", "|---|---|---|---|"];
  for (const r of rows) md.push(`| ${r.id} | ${r.expected} | ${r.actual} | ${r.attribution} |`);
  md.push("");
  md.push("## Counts by category");
  md.push("");
  md.push("| Category | Cases |");
  md.push("|---|---|");
  for (const [k, v] of Object.entries(attribCount).sort((a, b) => b[1] - a[1])) md.push(`| ${k} | ${v} |`);
  writeFileSync(resolve(EVALS_DIR, "intelligence-root-causes.md"), md.join("\n"));

  // eslint-disable-next-line no-console
  console.log(`Diagnostics complete. attribution: ${JSON.stringify(attribCount)}`);
}

void main();