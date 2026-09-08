import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import {
  OpenAILLMProvider,
  ReasoningAgent,
  SemanticInterpreter,
  detectExecutionGaps,
  isPlaceholderToken,
  loadConfig,
  reconcile,
  reconcileOperationalState,
  type OperationalContext,
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
 * STEP 70 — controlled architecture comparison.
 *
 * A. semantic interpretation -> retrieve ALL -> reconcile
 * B. semantic interpretation -> bounded agent selectively retrieves -> reconcile
 *
 * One shared real SemanticInterpreter LLM call per case; only the retrieval
 * strategy differs. Not gamed in either direction.
 */

const EVALS_DIR = resolve(process.cwd(), "../../evals");
const cases = (JSON.parse(readFileSync(resolve(EVALS_DIR, "cases.json"), "utf-8")).cases as EvalCase[]);
const expectedList = (JSON.parse(readFileSync(resolve(EVALS_DIR, "expected.json"), "utf-8")).expected as EvalExpected[]);

const SOURCE_FOR_TOOL: Record<string, string> = {
  get_contacts: "hubspot", get_open_deal: "hubspot", get_recent_notes: "hubspot", resolve_account: "hubspot",
  get_open_tasks: "tasks", check_existing_action: "tasks",
  get_commercial_state: "commercial", get_customer_activity: "commercial", get_commercial_exception: "commercial",
  get_email_thread: "gmail",
};

const EMPTY_SEMANTIC = { interactionId: "x", decisions: [], confirmedCommitments: [], candidateCommitments: [], conditionalCommitments: [], taskCandidates: [], commercialSignals: [], entityReferences: [], temporalExpressions: [], blockers: [], evidence: [] };

interface StrategyResult {
  toolCalls: number;
  sources: string[];
  classifications: string[];
  gapTypes: string[];
  missingContext: boolean;
}

async function runCase(c: EvalCase, exp: EvalExpected, interpreter: SemanticInterpreter) {
  const text = buildInteractionText(c);
  const accountId = accountIdOf(c);
  const interpret = await interpreter.interpret({ text, kind: "note", truncated: c.transcript.truncated, interactionId: `cmp_${c.id}` });
  const semantic = interpret.state;
  const required = (exp.required_retrieval.sources ?? []).filter((s) => s !== "transcript");

  async function evaluate(strategy: "bounded" | "all"): Promise<StrategyResult> {
    const ctx = buildReadContext(c);
    const toolNames: string[] = [];
    let op: OperationalContext;
    let missingContext = false;

    if (strategy === "all") {
      const contacts = await ctx.crm.getContacts(accountId); toolNames.push("get_contacts");
      const openDeal = await ctx.crm.getOpenDeal(accountId); toolNames.push("get_open_deal");
      const recentNotes = await ctx.crm.getRecentNotes(accountId); toolNames.push("get_recent_notes");
      const openTasks = await ctx.crm.getOpenTasks(accountId); toolNames.push("get_open_tasks");
      await ctx.crm.checkExistingAction(accountId, {}).catch(() => undefined); toolNames.push("check_existing_action");
      let commercialState: OperationalContext["commercialState"] = null;
      try { commercialState = await ctx.commercial.getCommercialState(accountId); } catch { missingContext = true; }
      toolNames.push("get_commercial_state");
      await ctx.commercial.getCustomerActivity(accountId).catch(() => undefined); toolNames.push("get_customer_activity");
      await ctx.commercial.getCommercialException(accountId).catch(() => undefined); toolNames.push("get_commercial_exception");
      op = { contacts, openDeal, recentNotes, openTasks, commercialState, emailThread: null };
    } else {
      if (!semantic) {
        op = { contacts: [], openDeal: null, recentNotes: [], openTasks: [], commercialState: null, emailThread: null };
      } else {
        const agent = new ReasoningAgent(ctx);
        const outcome = await agent.run({ state: semantic, accountId, metadata: {} });
        toolNames.push(...outcome.toolCalls.map((tc) => tc.toolName));
        op = toOperationalContext(outcome.toolCalls);
        missingContext = outcome.toolCalls.some((tc) => !tc.ok);
      }
    }

    const findings = [...reconcile({ state: semantic ?? EMPTY_SEMANTIC, context: op }), ...reconcileOperationalState(op)];
    const gaps = detectExecutionGaps(findings);
    const sources = [...new Set(toolNames.map((t) => SOURCE_FOR_TOOL[t]).filter((s): s is string => !!s))];
    return {
      toolCalls: toolNames.length,
      sources,
      classifications: [...new Set(findings.map((f) => f.classification))],
      gapTypes: gaps.map((g) => g.type),
      missingContext,
    };
  }

  const b = await evaluate("bounded");
  const a = await evaluate("all");

  const metrics = (r: StrategyResult) => ({
    correct: r.classifications.includes(exp.reconciliation_classification),
    gap_correct: r.gapTypes.includes(exp.reconciliation_classification),
    required_retrieval_recall: required.length === 0 ? 1 : required.filter((s) => r.sources.includes(s)).length / required.length,
    unnecessary_tool_calls: r.sources.filter((s) => !required.includes(s)).length,
    tool_calls: r.toolCalls,
    missing_context: r.missingContext,
  });

  return {
    id: c.id, name: c.name, required,
    semantic_llm_latency_ms: interpret.observability.latencyMs,
    prompt_tokens: interpret.observability.inputTokens,
    completion_tokens: interpret.observability.outputTokens,
    bounded: { ...metrics(b), classifications: b.classifications, sources: b.sources },
    retrieve_all: { ...metrics(a), classifications: a.classifications, sources: a.sources },
  };
}

function round(n: number, d = 3): number {
  return Math.round(n * 10 ** d) / 10 ** d;
}

async function main(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) loadDotenv({ path: p });
  const config = loadConfig();
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  if (isPlaceholderToken(apiKey)) {
    process.stderr.write("✗ architecture comparison requires a real LLM key.\n");
    process.exit(2);
  }
  const provider = config.openaiApiKey && !isPlaceholderToken(config.openaiApiKey) ? "openai" : "deepseek";
  const model = provider === "openai" ? config.openaiModel ?? "gpt-4o" : config.deepseekModel ?? "deepseek-chat";
  const baseUrl = provider === "openai" ? config.openaiBaseUrl ?? "https://api.openai.com/v1" : config.deepseekBaseUrl ?? "https://api.openai.com/v1";
  const interpreter = new SemanticInterpreter(new OpenAILLMProvider({ apiKey: apiKey!, model, baseUrl, reasoningEffort: config.openaiReasoningEffort }));

  const results: Awaited<ReturnType<typeof runCase>>[] = [];
  for (const c of cases) {
    const exp = expectedList.find((e) => e.id === c.id);
    if (!exp) continue;
    results.push(await runCase(c, exp, interpreter));
  }

  const n = results.length;
  const agg = (key: "bounded" | "retrieve_all") => ({
    correct: results.filter((r) => r[key].correct).length,
    gap_correct: results.filter((r) => r[key].gap_correct).length,
    required_retrieval_recall: round(results.reduce((s, r) => s + r[key].required_retrieval_recall, 0) / n),
    unnecessary_tool_calls: results.reduce((s, r) => s + r[key].unnecessary_tool_calls, 0),
    avg_tool_calls: round(results.reduce((s, r) => s + r[key].tool_calls, 0) / n),
    total_tool_calls: results.reduce((s, r) => s + r[key].tool_calls, 0),
    missing_context_cases: results.filter((r) => r[key].missing_context).length,
  });

  const operational = {
    total_llm_latency_ms: results.reduce((s, r) => s + r.semantic_llm_latency_ms, 0),
    avg_llm_latency_ms: round(results.reduce((s, r) => s + r.semantic_llm_latency_ms, 0) / n),
    total_prompt_tokens: results.reduce((s, r) => s + r.prompt_tokens, 0),
    total_completion_tokens: results.reduce((s, r) => s + r.completion_tokens, 0),
  };

  const out = {
    meta: { runner: "architecture-comparison", generatedAt: new Date().toISOString(), provider, model, note: "Same real SemanticInterpreter for both arms; only retrieval differs." },
    aggregate: { bounded: agg("bounded"), retrieve_all: agg("retrieve_all") },
    operational,
    cases: results,
  };
  writeFileSync(resolve(EVALS_DIR, "architecture-comparison-final.json"), JSON.stringify(out, null, 2));

  const b = agg("bounded");
  const a = agg("retrieve_all");
  const md = [
    "# Architecture comparison — bounded agent vs retrieve-all",
    "",
    `Generated ${new Date().toISOString()} · same real ${provider}/${model} semantic interpreter for both arms.`,
    "",
    "| Metric | Bounded agent | Retrieve-all |",
    "|---|---|---|",
    `| Final correctness | ${b.correct}/${n} | ${a.correct}/${n} |`,
    `| Execution-gap correctness | ${b.gap_correct}/${n} | ${a.gap_correct}/${n} |`,
    `| Required-context retrieval recall | ${b.required_retrieval_recall} | ${a.required_retrieval_recall} |`,
    `| Unnecessary tool calls (total) | ${b.unnecessary_tool_calls} | ${a.unnecessary_tool_calls} |`,
    `| Avg tool calls / run | ${b.avg_tool_calls} | ${a.avg_tool_calls} |`,
    `| Total tool calls | ${b.total_tool_calls} | ${a.total_tool_calls} |`,
    `| Missing-context cases | ${b.missing_context_cases} | ${a.missing_context_cases} |`,
    "",
    `**Operational (shared, one LLM call per case):** ${operational.total_llm_latency_ms} ms total LLM latency (${operational.avg_llm_latency_ms} ms avg), ${operational.total_prompt_tokens} prompt / ${operational.total_completion_tokens} completion tokens.`,
  ];
  writeFileSync(resolve(process.cwd(), "../../docs/architecture-comparison-final.md"), md.join("\n"));

  // eslint-disable-next-line no-console
  console.log(`Comparison complete. bounded=${b.correct}/${n}, retrieve-all=${a.correct}/${n}; avg tools ${b.avg_tool_calls} vs ${a.avg_tool_calls}.`);
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(out.aggregate, null, 2));
}

void main();