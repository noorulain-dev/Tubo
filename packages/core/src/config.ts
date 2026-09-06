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
  deepseekApiKey: z.string().min(1).optional(),
  deepseekModel: z.string().min(1).default("deepseek-chat"),
  deepseekBaseUrl: z.string().url().default("https://api.deepseek.com"),
  maxToolCalls: z.coerce.number().int().positive().default(12),
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
    deepseekApiKey: env.DEEPSEEK_API_KEY,
    deepseekModel: env.DEEPSEEK_MODEL,
    deepseekBaseUrl: env.DEEPSEEK_BASE_URL,
    maxToolCalls: env.MAX_TOOL_CALLS,
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
