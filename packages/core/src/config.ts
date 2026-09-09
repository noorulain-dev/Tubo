import { z } from "zod";

/**
 * Validated environment configuration. This is the ONLY module that reads raw
 * `process.env`; all other application code consumes the typed `AppConfig`.
 */
const ConfigSchema = z.object({
  nodeEnv: z.enum(["development", "test", "production"]).default("development"),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  auditLevel: z.enum(["info", "warn", "error"]).default("info"),
  databaseUrl: z.string().min(1).optional(),
  maxToolCalls: z.coerce.number().int().positive().default(12),

  // LLM providers (OpenAI-compatible)
  openaiApiKey: z.string().min(1).optional(),
  openaiModel: z.string().min(1).optional(),
  openaiBaseUrl: z.string().url().optional(),
  openaiReasoningEffort: z.enum(["low", "medium", "high"]).optional(),
  deepseekApiKey: z.string().min(1).optional(),
  deepseekModel: z.string().min(1).default("deepseek-chat"),
  deepseekBaseUrl: z.string().url().optional(),

  // Integrations
  hubspotAccessToken: z.string().min(1).optional(),
  hubspotBaseUrl: z.string().url().optional(),
  stripeSecretKey: z.string().min(1).optional(),
  stripeBaseUrl: z.string().url().optional(),
  gmailClientId: z.string().min(1).optional(),
  gmailClientSecret: z.string().min(1).optional(),
  gmailRefreshToken: z.string().min(1).optional(),
  gmailRedirectUri: z.string().url().optional(),

  // Server
  authToken: z.string().min(1).optional(),
  port: z.coerce.number().int().positive().default(3000),
  mode: z.enum(["sample", "live"]).default("sample"),

  // Ops / infra
  calendarWebhookUrl: z.string().url().optional(),
  integrationEncryptionKey: z.string().min(1).optional(),
  resendApiKey: z.string().min(1).optional(),
  emailFrom: z.string().optional(),
  appBaseUrl: z.string().optional(),
});
export type AppConfig = z.infer<typeof ConfigSchema>;

export function loadConfig(
  env: Record<string, string | undefined> = process.env,
): AppConfig {
  const parsed = ConfigSchema.safeParse({
    nodeEnv: env.NODE_ENV,
    logLevel: env.LOG_LEVEL,
    auditLevel: env.AUDIT_LEVEL,
    databaseUrl: env.DATABASE_URL,
    maxToolCalls: env.MAX_TOOL_CALLS,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    openaiBaseUrl: env.OPENAI_BASE_URL,
    openaiReasoningEffort: env.OPENAI_REASONING_EFFORT,
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL,
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
    hubspotAccessToken: env.HUBSPOT_ACCESS_TOKEN,
    hubspotBaseUrl: env.HUBSPOT_BASE_URL,
    stripeSecretKey: env.STRIPE_SECRET_KEY,
    stripeBaseUrl: env.STRIPE_BASE_URL,
    gmailClientId: env.GMAIL_CLIENT_ID,
    gmailClientSecret: env.GMAIL_CLIENT_SECRET,
    gmailRefreshToken: env.GMAIL_REFRESH_TOKEN,
    gmailRedirectUri: env.GMAIL_REDIRECT_URI,
    authToken: env.AUTH_TOKEN,
    port: env.PORT,
    mode: env.MODE,
    calendarWebhookUrl: env.CALENDAR_WEBHOOK_URL,
    integrationEncryptionKey: env.INTEGRATION_ENCRYPTION_KEY,
    resendApiKey: env.RESEND_API_KEY,
    emailFrom: env.EMAIL_FROM,
    appBaseUrl: env.APP_BASE_URL,
  });

  if (!parsed.success) {
    throw new Error(
      `Invalid environment configuration: ${parsed.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
  }

  return parsed.data;
}

/** Typed, feature-scoped view of the flat validated config. Never exposes
 * server secrets to the frontend (only server code imports this module). */
export interface ConfigSections {
  database: { url: string | undefined };
  auth: { token: string | undefined; encryptionKey: string | undefined };
  openai: { apiKey: string | undefined; model: string | undefined; baseUrl: string | undefined; reasoningEffort: AppConfig["openaiReasoningEffort"] };
  google: { clientId: string | undefined; clientSecret: string | undefined; refreshToken: string | undefined; redirectUri: string | undefined };
  hubspot: { accessToken: string | undefined; baseUrl: string | undefined };
  fireflies: { apiKey: string | undefined };
  email: { apiKey: string | undefined; from: string | undefined; baseUrl: string | undefined };
  app: { port: number; mode: AppConfig["mode"]; nodeEnv: AppConfig["nodeEnv"]; logLevel: AppConfig["logLevel"] };
}

export function configSections(config: AppConfig): ConfigSections {
  return {
    database: { url: config.databaseUrl },
    auth: { token: config.authToken, encryptionKey: config.integrationEncryptionKey },
    openai: { apiKey: config.openaiApiKey, model: config.openaiModel, baseUrl: config.openaiBaseUrl, reasoningEffort: config.openaiReasoningEffort },
    google: { clientId: config.gmailClientId, clientSecret: config.gmailClientSecret, refreshToken: config.gmailRefreshToken, redirectUri: config.gmailRedirectUri },
    hubspot: { accessToken: config.hubspotAccessToken, baseUrl: config.hubspotBaseUrl },
    // Fireflies API key is stored per-user (connections), not as a global env var.
    fireflies: { apiKey: undefined },
    email: { apiKey: config.resendApiKey, from: config.emailFrom, baseUrl: config.appBaseUrl },
    app: { port: config.port, mode: config.mode, nodeEnv: config.nodeEnv, logLevel: config.logLevel },
  };
}

/** A token that is obviously an unconfigured placeholder. */
export function isPlaceholderToken(value: string | undefined): boolean {
  if (!value) return true;
  return value.startsWith("your_") || value.includes("<") || value === "TODO";
}

/** Live Mode is viable when a real LLM key is present. */
export function isLiveConfigured(config: AppConfig): boolean {
  return !isPlaceholderToken(config.openaiApiKey ?? config.deepseekApiKey);
}

/** Per-integration connection status, derived purely from config (no probing). */
export interface IntegrationStatus {
  llm: { configured: boolean; provider: "openai" | "deepseek" | null };
  hubspot: { configured: boolean };
  gmail: { configured: boolean };
  stripe: { configured: boolean };
  live: boolean;
}

export function integrationStatus(config: AppConfig): IntegrationStatus {
  const openai = !isPlaceholderToken(config.openaiApiKey);
  const deepseek = !isPlaceholderToken(config.deepseekApiKey);
  return {
    llm: {
      configured: openai || deepseek,
      provider: openai ? "openai" : deepseek ? "deepseek" : null,
    },
    hubspot: { configured: !isPlaceholderToken(config.hubspotAccessToken) },
    gmail: {
      configured: Boolean(config.gmailClientId && config.gmailClientSecret && config.gmailRefreshToken),
    },
    stripe: { configured: Boolean(config.stripeSecretKey && !isPlaceholderToken(config.stripeSecretKey)) },
    live: isLiveConfigured(config),
  };
}
