import { z } from "zod";
import { AuthorityLevelSchema, RunStatusSchema, SourceTypeSchema } from "./enums.js";

export const AgentRunSchema = z.object({
  id: z.string().optional(),
  semanticStateRef: z.string(),
  status: RunStatusSchema,
  toolBudget: z.object({
    used: z.number().int().nonnegative(),
    max: z.number().int().positive(),
  }),
  startedAt: z.string(),
  finishedAt: z.string().nullable().optional(),
});
export type AgentRun = z.infer<typeof AgentRunSchema>;

export const AgentToolCallSchema = z.object({
  id: z.string().optional(),
  toolName: z.string(),
  reasonCategory: z.string(),
  args: z.unknown(),
  result: z.unknown().optional(),
  ok: z.boolean(),
  source: SourceTypeSchema.optional(),
  authority: AuthorityLevelSchema.optional(),
  latencyMs: z.number().nonnegative().optional(),
  fromCache: z.boolean().optional(),
});
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

export const AgentRetrievalResultSchema = z.object({
  toolName: z.string(),
  ok: z.boolean(),
  source: SourceTypeSchema,
  authority: AuthorityLevelSchema,
  data: z.unknown(),
  error: z.string().nullable().optional(),
});
export type AgentRetrievalResult = z.infer<typeof AgentRetrievalResultSchema>;
