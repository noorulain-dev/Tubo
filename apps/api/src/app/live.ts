import { OpenAILLMProvider, SemanticInterpreter, isPlaceholderToken, type AppConfig, type LLMProvider } from "../shared/core.js";
import { LiveProviderResolver } from "../integrations/provider-resolver.js";
import { RunService } from "../runs/pipeline.js";
import { PostgresRunStore } from "../runs/store-pg.js";

export interface LiveWiring {
  service: RunService;
  warnings: string[];
}

/**
 * Live (integration) mode. The LLM is platform-level (operator env); the
 * per-user integrations (HubSpot, Gmail) are resolved from the authenticated
 * user's `connections` rows at run time by LiveProviderResolver — never from
 * operator env, never from another user's connection.
 */
export function createLiveApp(config: AppConfig): LiveWiring {
  const warnings: string[] = [];

  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  const model = config.openaiModel ?? config.deepseekModel ?? "gpt-4o";
  const baseUrl = config.openaiBaseUrl ?? config.deepseekBaseUrl ?? "https://api.openai.com/v1";
  if (!apiKey) {
    throw new Error("Live Mode requires an LLM API key (OPENAI_API_KEY or DEEPSEEK_API_KEY).");
  }
  const llm: LLMProvider = new OpenAILLMProvider({ apiKey, model, baseUrl, reasoningEffort: config.openaiReasoningEffort });
  const interpreter = new SemanticInterpreter(llm);

  const gmailOAuth =
    config.gmailClientId && config.gmailClientSecret && !isPlaceholderToken(config.gmailClientId)
      ? { clientId: config.gmailClientId, clientSecret: config.gmailClientSecret }
      : undefined;
  if (!gmailOAuth) {
    warnings.push("Gmail OAuth client is not configured — users cannot authorize Gmail.");
  }

  const resolver = new LiveProviderResolver(gmailOAuth);
  const store = new PostgresRunStore();
  const service = new RunService({ interpreter, resolver, store, mode: "integration" });

  return { service, warnings };
}
