import { z } from "zod";
import type { Account } from "./domain.js";
import type { CommercialStateReadProvider } from "./commercial.js";

// ---------------------------------------------------------------------------
// Provider DTOs (validated shapes returned by integrations)
// ---------------------------------------------------------------------------

export const ContactRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  accountId: z.string().optional(),
  email: z.string().nullable().optional(),
  firstName: z.string().nullable().optional(),
  lastName: z.string().nullable().optional(),
  lifecycleStage: z.string().nullable().optional(),
});
export type ContactRecord = z.infer<typeof ContactRecordSchema>;

export const DealRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  accountId: z.string().optional(),
  name: z.string(),
  stage: z.string(),
  amount: z.number().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  closeDate: z.string().nullable().optional(),
  nextStep: z.string().nullable().optional(),
});
export type DealRecord = z.infer<typeof DealRecordSchema>;

export const TaskRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  accountId: z.string().optional(),
  contactId: z.string().nullable().optional(),
  dealId: z.string().nullable().optional(),
  ownerId: z.string().nullable().optional(),
  title: z.string(),
  type: z.string(),
  status: z.string(),
  dueDate: z.string().nullable().optional(),
});
export type TaskRecord = z.infer<typeof TaskRecordSchema>;

export const NoteRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  accountId: z.string().optional(),
  dealId: z.string().nullable().optional(),
  body: z.string(),
  createdAt: z.string().nullable().optional(),
});
export type NoteRecord = z.infer<typeof NoteRecordSchema>;

export const EMAIL_MESSAGE_STATES = ["draft", "sent", "received", "unknown"] as const;
export const EmailMessageStateSchema = z.enum(EMAIL_MESSAGE_STATES);
export type EmailMessageState = z.infer<typeof EmailMessageStateSchema>;

export const EmailMessageRecordSchema = z.object({
  id: z.string().optional(),
  threadId: z.string().optional(),
  from: z.string(),
  to: z.array(z.string()),
  subject: z.string().optional(),
  body: z.string(),
  sentAt: z.string(),
  state: EmailMessageStateSchema.optional(),
});
export type EmailMessageRecord = z.infer<typeof EmailMessageRecordSchema>;

export const EmailThreadRecordSchema = z.object({
  id: z.string(),
  externalId: z.string().optional(),
  subject: z.string(),
  participants: z.array(z.string()),
  messages: z.array(EmailMessageRecordSchema),
});
export type EmailThreadRecord = z.infer<typeof EmailThreadRecordSchema>;

/**
 * A normalized description of an action used to detect an equivalent, already
 * existing task (duplicate detection).
 */
export interface TaskSignature {
  title?: string;
  type?: string;
  contactId?: string | null;
  ownerId?: string | null;
  dueDate?: string | null;
}

// ---------------------------------------------------------------------------
// READ interfaces — the reasoning agent may consume ONLY these.
// ---------------------------------------------------------------------------

export interface CRMReadProvider {
  resolveAccount(query: string): Promise<Account[]>;
  /** List all accounts/companies available to the connected source (for pickers). */
  listCompanies?(): Promise<Account[]>;
  getContacts(accountId: string): Promise<ContactRecord[]>;
  getOpenDeal(accountId: string): Promise<DealRecord | null>;
  getDeal(dealId: string): Promise<DealRecord | null>;
  getRecentNotes(accountId: string): Promise<NoteRecord[]>;
  getOpenTasks(accountId: string): Promise<TaskRecord[]>;
  checkExistingAction(accountId: string, signature: TaskSignature): Promise<TaskRecord | null>;
}

export interface EmailReadProvider {
  getThread(threadId: string): Promise<EmailThreadRecord | null>;
  getMessage(messageId: string): Promise<EmailMessageRecord | null>;
  hasOutboundCommunication(threadId: string): Promise<boolean>;
  getDrafts(threadId: string): Promise<EmailMessageRecord[]>;
}

export type { CommercialStateReadProvider } from "./commercial.js";

// ---------------------------------------------------------------------------
// WRITE interfaces — the executor consumes these; the agent never sees them.
// ---------------------------------------------------------------------------

export interface CRMWriteProvider {
  createNote(accountId: string, body: string, idempotencyKey?: string): Promise<{ externalRef: string }>;
  createTask(input: CreateTaskInput, idempotencyKey?: string): Promise<{ externalRef: string }>;
  updateField(
    accountId: string,
    objectType: string,
    field: string,
    value: unknown,
  ): Promise<{ externalRef: string }>;
  updateStage(dealId: string, stage: string): Promise<{ externalRef: string }>;
}

export interface CreateTaskInput {
  accountId: string;
  title: string;
  type: string;
  dueDate?: string | null;
  ownerId?: string | null;
  contactId?: string | null;
  dealId?: string | null;
  companyId?: string | null;
}

export interface EmailWriteProvider {
  /** Draft only — there is deliberately no "send" method in assessment v1. */
  createDraft(input: CreateDraftInput, idempotencyKey?: string): Promise<{ externalRef: string }>;
}

export interface CreateDraftInput {
  to: string[];
  subject: string;
  body: string;
  threadId?: string;
}

// ---------------------------------------------------------------------------
// Combined interfaces for concrete implementations.
// ---------------------------------------------------------------------------

export interface CRMProvider extends CRMReadProvider, CRMWriteProvider {}
export interface EmailProvider extends EmailReadProvider, EmailWriteProvider {}

// ---------------------------------------------------------------------------
// LLM provider (inference only; no mutation).
// ---------------------------------------------------------------------------

export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  temperature?: number;
  responseFormat?: "json_object" | "text";
  maxTokens?: number;
  /** Reasoning effort for reasoning-capable models (Responses API). */
  reasoningEffort?: "low" | "medium" | "high";
}

export interface LLMResponse {
  content: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  model: string;
  latencyMs: number;
}

export interface LLMProvider {
  generate(request: LLMRequest): Promise<LLMResponse>;
}

// ---------------------------------------------------------------------------
// Read-only context handed to the reasoning agent.
// ---------------------------------------------------------------------------

export interface AgentReadContext {
  crm: CRMReadProvider;
  email: EmailReadProvider;
  commercial: CommercialStateReadProvider;
}
