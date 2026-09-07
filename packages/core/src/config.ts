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

  // Server
  authToken: z.string().min(1).optional(),
  port: z.coerce.number().int().positive().default(3000),
  mode: z.enum(["sample", "live"]).default("sample"),
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
    authToken: env.AUTH_TOKEN,
    port: env.PORT,
    mode: env.MODE,
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

/** A token that is obviously an unconfigured placeholder. */
export function isPlaceholderToken(value: string | undefined): boolean {
  if (!value) return true;
  return value.startsWith("your_") || value.includes("<") || value === "TODO";
}

/** Live Mode is viable when a real LLM key is present. */
export function isLiveConfigured(config: AppConfig): boolean {
  return !isPlaceholderToken(config.openaiApiKey ?? config.deepseekApiKey);
}
