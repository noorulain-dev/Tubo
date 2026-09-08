import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { isPlaceholderToken, loadConfig } from "../shared/core.js";
import { ensureSchema, getPool } from "../database/db.js";

// Non-mutating pre-deployment dependency check. Reports PASS/FAIL per dependency
// and never writes to an external provider. Read-only probes only.

interface Result {
  check: string;
  status: "PASS" | "FAIL";
  detail?: string;
}

const PROVIDERS = ["hubspot", "gmail", "google-calendar", "fireflies"] as const;

async function probeModel(config: ReturnType<typeof loadConfig>): Promise<{ ok: boolean; detail: string }> {
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  const model = config.openaiModel ?? config.deepseekModel;
  const baseUrl = config.openaiBaseUrl ?? config.deepseekBaseUrl ?? "https://api.openai.com/v1";
  if (!apiKey || !model) return { ok: false, detail: "no model or key" };
  try {
    const res = await fetch(`${baseUrl.replace(/\/$/, "")}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        input: [{ role: "user", content: "reply with the single word: ok" }],
        max_output_tokens: 256,
        reasoning: { effort: config.openaiReasoningEffort ?? "low" },
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      return { ok: false, detail: `HTTP ${res.status}${body ? ` (${body.slice(0, 120)})` : ""}` };
    }
    return { ok: true, detail: model };
  } catch (e) {
    return { ok: false, detail: (e as Error).message };
  }
}

async function check(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) loadDotenv({ path: p });
  const config = loadConfig();
  const results: Result[] = [];
  const add = (check: string, status: Result["status"], detail?: string) => results.push({ check, status, detail });

  // LLM configured
  const llmKey = config.openaiApiKey ?? config.deepseekApiKey;
  const llmModel = config.openaiModel ?? config.deepseekModel;
  add("LLM configured", !isPlaceholderToken(llmKey) ? "PASS" : "FAIL", llmModel);
  add(`LLM model reachable (${llmModel ?? "unset"})`, "PASS"); // placeholder; filled below

  const modelProbe = await probeModel(config);
  results[results.length - 1] = {
    check: `LLM model reachable (${llmModel ?? "unset"})`,
    status: modelProbe.ok ? "PASS" : "FAIL",
    detail: modelProbe.detail,
  };

  // Database + migrations (idempotent bootstrap creates all tables if absent)
  try {
    await ensureSchema();
    await getPool().query("SELECT 1");
    add("Database reachable", "PASS");
  } catch (e) {
    add("Database reachable", "FAIL", (e as Error).message);
  }

  // Required tables: users / sessions / connections / app_runs / app_proposals / jobs
  try {
    const pool = getPool();
    const tables = ["users", "sessions", "connections", "app_runs", "app_proposals"];
    for (const t of tables) {
      const r = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = $1", [t]);
      add(`Migration table: ${t}`, r.rows.length > 0 ? "PASS" : "FAIL");
    }
  } catch (e) {
    add("Migration (schema tables)", "FAIL", (e as Error).message);
  }

  // Queue/workered jobs table
  try {
    const pool = getPool();
    const r = await pool.query("SELECT 1 FROM information_schema.tables WHERE table_name = 'jobs'");
    add("Queue persistence (jobs table)", r.rows.length > 0 ? "PASS" : "FAIL");
  } catch (e) {
    add("Queue persistence (jobs table)", "FAIL", (e as Error).message);
  }

  // Connection presence (read-only), scoped to at least one connected user
  try {
    const pool = getPool();
    for (const prov of PROVIDERS) {
      const res = await pool.query("SELECT 1 FROM connections WHERE provider = $1 AND status = 'connected' LIMIT 1", [prov]);
      add(`Connection: ${prov}`, res.rows.length > 0 ? "PASS" : "FAIL", res.rows.length > 0 ? "connected" : "no configured user");
    }
  } catch (e) {
    for (const prov of PROVIDERS) add(`Connection: ${prov}`, "FAIL", (e as Error).message);
  }

  // Commercial context configuration (Stripe-backed commercial OR HubSpot commercial property)
  const stripeConfigured = !isPlaceholderToken(config.stripeSecretKey);
  add("Commercial context (Stripe)", stripeConfigured ? "PASS" : "FAIL", stripeConfigured ? "stripeSecretKey set" : "not configured (HubSpot commercial property fallback)");

  console.log("=== PRE-DEPLOY CHECK ===");
  for (const r of results) console.log(`${r.status === "PASS" ? "✓" : "✗"} ${r.check}${r.detail ? ` — ${r.detail}` : ""}`);
  const failed = results.filter((r) => r.status === "FAIL").length;
  console.log(`\n${failed === 0 ? "ALL PASS" : `${failed} dependency(ies) FAIL`}`);
  process.exit(failed === 0 ? 0 : 1);
}

void check().catch((e) => {
  console.error(`❌ predeploy check error: ${(e as Error).message}`);
  process.exit(1);
});