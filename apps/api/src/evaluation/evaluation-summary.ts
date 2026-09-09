// Normalized, read-only evaluation summary built from the COMMITTED evaluation
// artifacts in /evals. This never re-runs an evaluation; it only reads frozen
// result files that were produced by the eval runners and checked into the repo.
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

export interface LayerA {
  commitmentPrecision: number | null;
  commitmentRecall: number | null;
  ownerAccuracy: number | null;
  dateAccuracy: number | null;
  evidenceValidity: number | null;
}

export interface LayerB {
  requiredRetrievalRecall: number | null;
  avgToolCalls: number | null;
  totalToolCalls: number | null;
  unnecessaryToolCalls: number | null;
  duplicateToolCalls: number | null;
  toolFailures: number | null;
}

export interface LayerC {
  classificationAccuracy: number | null;
  mustNotExecuteViolations: number | null;
  incorrectExternalExecution: number | null;
}

export interface SafetyMetrics {
  totalRecommended: number | null;
  totalPolicyBlocked: number | null;
  totalExecuted: number | null;
  externalExecutions: number | null;
  injectionEscalations: number | null;
}

export interface ArchitectureArm {
  correct: number | null;
  gapCorrect: number | null;
  requiredRetrievalRecall: number | null;
  avgToolCalls: number | null;
  totalToolCalls: number | null;
  unnecessaryToolCalls: number | null;
  missingContextCases: number | null;
}

export interface EvaluationSummary {
  generatedAt: string | null;
  model: string | null;
  reasoningEffort: string | null;
  gate: string | null;
  official: {
    casesTotal: number | null;
    casesPassed: number | null;
    casesFailed: number | null;
    layerA: LayerA;
    layerB: LayerB;
    layerC: LayerC;
    safety: SafetyMetrics;
  };
  stability: { model: string | null; runs: number[]; mean: number | null; min: number | null; max: number | null; flips: string[] };
  supplemental: { casesTotal: number | null; casesPassed: number | null; casesFailed: number | null; passRate: number | null };
  architecture: { bounded: ArchitectureArm; retrieveAll: ArchitectureArm } | null;
  failureProgression: { label: string; casesPassed: number | null; casesTotal: number | null; generatedAt: string | null; note: string | null }[];
  remainingFailures: { id: string | null; name: string | null; category: string | null; expected: string | null; actual: string | null }[];
  sources: string[];
}

type Json = Record<string, unknown>;

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}
function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}
function obj(v: unknown): Json {
  return v && typeof v === "object" ? (v as Json) : {};
}

/** Walk upwards from the API package until a directory containing /evals is found. */
function findEvalsDir(): string | null {
  const override = process.env["EVALS_DIR"];
  if (override && existsSync(override)) return override;
  let dir = resolve(process.cwd());
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, "evals");
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

async function readJson(dir: string, file: string): Promise<Json | null> {
  try {
    const raw = await readFile(join(dir, file), "utf8");
    return JSON.parse(raw) as Json;
  } catch {
    return null;
  }
}

function layerA(v: unknown): LayerA {
  const o = obj(v);
  return {
    commitmentPrecision: num(o["commitment_precision"]),
    commitmentRecall: num(o["commitment_recall"]),
    ownerAccuracy: num(o["owner_accuracy"]),
    dateAccuracy: num(o["date_accuracy"]),
    evidenceValidity: num(o["evidence_validity"]),
  };
}
function layerB(v: unknown): LayerB {
  const o = obj(v);
  return {
    requiredRetrievalRecall: num(o["required_retrieval_recall"]),
    avgToolCalls: num(o["avg_tool_calls"]),
    totalToolCalls: num(o["total_tool_calls"]),
    unnecessaryToolCalls: num(o["unnecessary_tool_calls"]),
    duplicateToolCalls: num(o["duplicate_tool_calls"]),
    toolFailures: num(o["tool_failures"]),
  };
}
function layerC(v: unknown): LayerC {
  const o = obj(v);
  return {
    classificationAccuracy: num(o["classification_accuracy"]),
    mustNotExecuteViolations: num(o["must_not_execute_violations"]),
    incorrectExternalExecution: num(o["incorrect_external_execution"]),
  };
}
function safety(v: unknown): SafetyMetrics {
  const o = obj(v);
  return {
    totalRecommended: num(o["total_recommended"]),
    totalPolicyBlocked: num(o["total_policy_blocked"]),
    totalExecuted: num(o["total_executed"]),
    externalExecutions: num(o["external_executions"]),
    injectionEscalations: num(o["injection_escalations"]),
  };
}
function arm(v: unknown): ArchitectureArm {
  const o = obj(v);
  return {
    correct: num(o["correct"]),
    gapCorrect: num(o["gap_correct"]),
    requiredRetrievalRecall: num(o["required_retrieval_recall"]),
    avgToolCalls: num(o["avg_tool_calls"]),
    totalToolCalls: num(o["total_tool_calls"]),
    unnecessaryToolCalls: num(o["unnecessary_tool_calls"]),
    missingContextCases: num(o["missing_context_cases"]),
  };
}

/**
 * Build the normalized evaluation summary. Returns null when no committed
 * artifacts can be found — callers must surface that as "unavailable" rather
 * than substituting placeholder numbers.
 */
export async function loadEvaluationSummary(): Promise<EvaluationSummary | null> {
  const dir = findEvalsDir();
  if (!dir) return null;

  const predeploy = await readJson(dir, "predeploy-v4-results.json");
  const systemV0 = await readJson(dir, "system-v0-results.json");
  const architecture = (await readJson(dir, "architecture-comparison-final.json")) ?? (await readJson(dir, "architecture-comparison.json"));
  if (!predeploy && !systemV0) return null;

  const sources: string[] = [];
  if (predeploy) sources.push("evals/predeploy-v4-results.json");
  if (systemV0) sources.push("evals/system-v0-results.json");
  if (architecture) sources.push("evals/architecture-comparison-final.json");

  const official = obj(predeploy?.["official"] ?? obj(systemV0?.["aggregate"]));
  const stabilityRaw = obj(predeploy?.["stability"]);
  const supplementalRaw = obj(predeploy?.["supplemental_os"]);
  const archAgg = obj(architecture?.["aggregate"]);

  const failureProgression: EvaluationSummary["failureProgression"] = [];
  if (systemV0) {
    const agg = obj(systemV0["aggregate"]);
    failureProgression.push({
      label: "System v0 (first full-system run)",
      casesPassed: num(agg["cases_passed"]),
      casesTotal: num(agg["cases_total"]),
      generatedAt: str(obj(systemV0["meta"])["generatedAt"]),
      note: str(obj(systemV0["meta"])["note"]),
    });
  }
  if (predeploy) {
    failureProgression.push({
      label: "Pre-deploy v4 (frozen gate)",
      casesPassed: num(official["cases_passed"]),
      casesTotal: num(official["cases_total"]),
      generatedAt: str(predeploy["generatedAt"]),
      note: null,
    });
  }

  const remainingRaw = Array.isArray(predeploy?.["remaining_failures"])
    ? (predeploy!["remaining_failures"] as unknown[])
    : Array.isArray(systemV0?.["failures"]) && !predeploy
      ? (systemV0!["failures"] as unknown[])
      : [];

  return {
    generatedAt: str(predeploy?.["generatedAt"]) ?? str(obj(systemV0?.["meta"])["generatedAt"]),
    model: str(predeploy?.["selected_model"]) ?? str(obj(systemV0?.["meta"])["semantic_model"]),
    reasoningEffort: str(predeploy?.["reasoning_effort"]),
    gate: str(predeploy?.["gate"]),
    official: {
      casesTotal: num(official["cases_total"]),
      casesPassed: num(official["cases_passed"]),
      casesFailed: num(official["cases_failed"]),
      layerA: layerA(official["layer_a"]),
      layerB: layerB(official["layer_b"]),
      layerC: layerC(official["layer_c"]),
      safety: safety(official["safety"]),
    },
    stability: {
      model: str(stabilityRaw["model"]),
      runs: Array.isArray(stabilityRaw["runs"]) ? (stabilityRaw["runs"] as unknown[]).filter((r): r is number => typeof r === "number") : [],
      mean: num(stabilityRaw["mean"]),
      min: num(stabilityRaw["min"]),
      max: num(stabilityRaw["max"]),
      flips: Array.isArray(stabilityRaw["flips"]) ? (stabilityRaw["flips"] as unknown[]).map((f) => String(f)) : [],
    },
    supplemental: {
      casesTotal: num(supplementalRaw["cases_total"]),
      casesPassed: num(supplementalRaw["cases_passed"]),
      casesFailed: num(supplementalRaw["cases_failed"]),
      passRate: num(supplementalRaw["pass_rate"]),
    },
    architecture: architecture ? { bounded: arm(archAgg["bounded"]), retrieveAll: arm(archAgg["retrieve_all"]) } : null,
    failureProgression,
    remainingFailures: remainingRaw.map((f) => {
      const o = obj(f);
      return {
        id: str(o["id"]),
        name: str(o["name"]),
        category: str(o["category"]),
        expected: str(o["expected"]),
        actual: str(o["actual"]),
      };
    }),
    sources,
  };
}
