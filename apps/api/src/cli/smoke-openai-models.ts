import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { isPlaceholderToken, loadConfig } from "../shared/core.js";

// Direct model availability probe using the SAME config + OpenAI-compatible
// Chat Completions endpoint as the app. Sanitized output (no key printed).

const MODELS = ["gpt-4o", "gpt-5.6-terra", "gpt-5.6-sol", "gpt-6-astra"];

type Verdict =
  | "MODEL_AVAILABLE"
  | "MODEL_NOT_AVAILABLE_TO_PROJECT"
  | "INVALID_MODEL"
  | "CLIENT_INCOMPATIBLE"
  | "ENDPOINT_INCOMPATIBLE"
  | "AUTH_FAILURE"
  | "RATE_LIMITED"
  | "UNKNOWN";

async function probe(baseUrl: string, apiKey: string, model: string): Promise<Verdict> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1 }),
    });
    if (res.ok) return "MODEL_AVAILABLE";
    const body = await res.text().catch(() => "");
    const b = body.toLowerCase();
    if (res.status === 401 || res.status === 403) return "AUTH_FAILURE";
    if (res.status === 404) {
      // 404 on /chat/completions can mean the model path is wrong; /models gives clearer output.
      if (b.includes("model_not_found")) return "INVALID_MODEL";
      if (b.includes("not available") || b.includes("access")) return "MODEL_NOT_AVAILABLE_TO_PROJECT";
      return "INVALID_MODEL";
    }
    if (res.status === 429) return "RATE_LIMITED";
    if (b.includes("model") && b.includes("does not exist")) return "INVALID_MODEL";
    if (b.includes("not available") || b.includes("unsupported")) return "MODEL_NOT_AVAILABLE_TO_PROJECT";
    if (res.status === 404) return "ENDPOINT_INCOMPATIBLE";
    return "UNKNOWN";
  } catch (e) {
    return "CLIENT_INCOMPATIBLE";
  }
}

async function probeResponses(baseUrl: string, apiKey: string, model: string, effort = "medium"): Promise<Verdict> {
  try {
    const res = await fetch(`${baseUrl}/responses`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: "ping", reasoning: { effort } }),
    });
    if (res.ok) return "MODEL_AVAILABLE";
    const body = (await res.text().catch(() => "")).toLowerCase();
    if (res.status === 401 || res.status === 403) return "AUTH_FAILURE";
    if (body.includes("model_not_found") || body.includes("does not exist")) return "INVALID_MODEL";
    if (body.includes("not available") || body.includes("access")) return "MODEL_NOT_AVAILABLE_TO_PROJECT";
    return res.status === 404 ? "ENDPOINT_INCOMPATIBLE" : "UNKNOWN";
  } catch {
    return "CLIENT_INCOMPATIBLE";
  }
}

async function main(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) loadDotenv({ path: p });
  const config = loadConfig();
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  const baseUrl = (config.openaiBaseUrl ?? config.deepseekBaseUrl ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const provider = config.openaiApiKey && !isPlaceholderToken(config.openaiApiKey) ? "openai" : "deepseek";

  console.log(`provider=${provider} baseUrl=${baseUrl.replace(/\/chat\/completions$/, "").replace(/\/responses$/, "")} configuredModel=${config.openaiModel}`);
  if (isPlaceholderToken(apiKey)) {
    console.log("AUTH_FAILURE (no/placeholder key configured)");
    process.exit(2);
  }

  for (const m of MODELS) {
    const v = await probe(baseUrl, apiKey!, m);
    console.log(`chat-completions  ${m}: ${v}`);
  }
  console.log("--- responses API ---");
  for (const m of [config.openaiModel ?? "gpt-6-astra", "gpt-5.6-sol", "gpt-5.6-terra"].filter((x, i, a) => a.indexOf(x) === i)) {
    const v = await probeResponses(baseUrl, apiKey!, m);
    console.log(`responses  ${m}: ${v}`);
  }
}

void main();