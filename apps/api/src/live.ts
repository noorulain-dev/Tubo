import {
  AuditService,
  Executor,
  GmailClient,
  GmailProvider,
  HubSpotCRMProvider,
  HubSpotHttpClient,
  MemoryAuditSink,
  OpenAILLMProvider,
  SemanticInterpreter,
  StripeCommercialStateProvider,
  isPlaceholderToken,
  type AgentReadContext,
  type AppConfig,
  type CommercialStateReadProvider,
  type LLMProvider,
} from "./core.js";
import { exchangeGmailRefreshToken } from "./gmail-oauth.js";
import { RunService } from "./pipeline.js";
import { createCrmRead, createCrmWrite, createEmailRead, createEmailWrite, createSampleCommercial, getSampleState } from "./sample-fixtures.js";

export interface LiveWiring {
  service: RunService;
  warnings: string[];
}

/**
 * Live (integration) mode: real OpenAI-compatible LLM + real HubSpot + real
 * Gmail, with a synthetic commercial provider (no real commercial adapter
 * exists yet). Each integration degrades gracefully to Sample Mode fixtures and
 * records a warning when its credentials are missing/placeholder.
 */
export async function createLiveApp(config: AppConfig): Promise<LiveWiring> {
  const warnings: string[] = [];
  const audit = new AuditService(new MemoryAuditSink());

  // LLM
  const apiKey = config.openaiApiKey ?? config.deepseekApiKey;
  const model = config.openaiModel ?? config.deepseekModel ?? "gpt-4o";
  const baseUrl = config.openaiBaseUrl ?? config.deepseekBaseUrl ?? "https://api.openai.com/v1";
  if (!apiKey) {
    throw new Error("Live Mode requires an LLM API key (OPENAI_API_KEY or DEEPSEEK_API_KEY).");
  }
  const llm: LLMProvider = new OpenAILLMProvider({ apiKey, model, baseUrl });

  // HubSpot (read + write)
  let hubspot: HubSpotCRMProvider | undefined;
  if (!isPlaceholderToken(config.hubspotAccessToken)) {
    hubspot = new HubSpotCRMProvider(
      new HubSpotHttpClient({ accessToken: config.hubspotAccessToken!, baseUrl: config.hubspotBaseUrl, audit }),
      { audit },
    );
  } else {
    warnings.push("HUBSPOT_ACCESS_TOKEN missing/placeholder — HubSpot falls back to Sample Mode fixtures.");
  }

  // Gmail (read + write)
  let gmail: GmailProvider | undefined;
  if (config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken) {
    try {
      const accessToken = await exchangeGmailRefreshToken({
        clientId: config.gmailClientId,
        clientSecret: config.gmailClientSecret,
        refreshToken: config.gmailRefreshToken,
      });
      gmail = new GmailProvider(new GmailClient({ accessToken, audit }), { audit });
    } catch (e) {
      warnings.push(`Gmail OAuth token exchange failed — Gmail falls back to Sample Mode: ${(e as Error).message}`);
    }
  } else {
    warnings.push("Gmail OAuth credentials missing — Gmail falls back to Sample Mode fixtures.");
  }

  const state = getSampleState();
  const commercial: CommercialStateReadProvider =
    config.stripeSecretKey && !isPlaceholderToken(config.stripeSecretKey)
      ? new StripeCommercialStateProvider({ secretKey: config.stripeSecretKey, baseUrl: config.stripeBaseUrl })
      : createSampleCommercial();
  if (!(config.stripeSecretKey && !isPlaceholderToken(config.stripeSecretKey))) {
    warnings.push("STRIPE_SECRET_KEY missing — commercial state falls back to Sample Mode fixtures.");
  }

  const readContext: AgentReadContext = {
    crm: hubspot ?? createCrmRead(state),
    email: gmail ?? createEmailRead(state),
    commercial,
  };

  const interpreter = new SemanticInterpreter(llm);
  const executor = new Executor(
    hubspot ?? createCrmWrite(state),
    gmail ?? createEmailWrite(state),
    { audit },
  );
  const service = new RunService({ interpreter, readContext, executor, audit, mode: "integration" });

  return { service, warnings };
}