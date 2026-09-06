import { AuditService, NoopAuditSink } from "../audit-service.js";
import { InMemoryIdempotencyStore, type IdempotencyStore } from "../idempotency.js";
import type {
  CreateDraftInput,
  EmailMessageRecord,
  EmailProvider,
  EmailThreadRecord,
} from "../providers.js";
import { GmailClient, isGmailNotFound } from "./gmail-client.js";
import {
  buildRawMessage,
  normalizeMessage,
  normalizeThread,
  type GmailMessage,
  type GmailThread,
} from "./normalize.js";

export interface GmailProviderOptions {
  audit?: AuditService;
  idempotency?: IdempotencyStore;
}

/**
 * Gmail provider implementing EmailProvider. Write is limited to createDraft
 * (draft-only); there is deliberately no sendEmail method in assessment v1.
 * The reasoning agent receives an EmailReadProvider reference and can never
 * create drafts.
 */
export class GmailProvider implements EmailProvider {
  private readonly audit: AuditService;
  private readonly idempotency: IdempotencyStore;

  constructor(private readonly client: GmailClient, opts: GmailProviderOptions = {}) {
    this.audit = opts.audit ?? new AuditService(new NoopAuditSink());
    this.idempotency = opts.idempotency ?? new InMemoryIdempotencyStore();
  }

  // -------------------------------------------------------------------------
  // READ operations
  // -------------------------------------------------------------------------

  async getThread(threadId: string): Promise<EmailThreadRecord | null> {
    this.audit.emit({ eventType: "email.read", payload: { method: "getThread", threadId } });
    try {
      const raw = await this.client.get(`/gmail/v1/users/me/threads/${threadId}`, { format: "full" });
      return normalizeThread(raw as GmailThread);
    } catch (err) {
      if (isGmailNotFound(err)) return null;
      throw err;
    }
  }

  async getMessage(messageId: string): Promise<EmailMessageRecord | null> {
    this.audit.emit({ eventType: "email.read", payload: { method: "getMessage", messageId } });
    try {
      const raw = await this.client.get(`/gmail/v1/users/me/messages/${messageId}`, {
        format: "full",
      });
      return normalizeMessage(raw as GmailMessage);
    } catch (err) {
      if (isGmailNotFound(err)) return null;
      throw err;
    }
  }

  async hasOutboundCommunication(threadId: string): Promise<boolean> {
    this.audit.emit({ eventType: "email.read", payload: { method: "hasOutboundCommunication", threadId } });
    const thread = await this.getThread(threadId);
    return thread?.messages.some((m) => m.state === "sent") ?? false;
  }

  async getDrafts(threadId: string): Promise<EmailMessageRecord[]> {
    this.audit.emit({ eventType: "email.read", payload: { method: "getDrafts", threadId } });
    const thread = await this.getThread(threadId);
    return (thread?.messages ?? []).filter((m) => m.state === "draft");
  }

  // -------------------------------------------------------------------------
  // WRITE operations (consumed only by the deterministic executor)
  // -------------------------------------------------------------------------

  async createDraft(input: CreateDraftInput, idempotencyKey?: string): Promise<{ externalRef: string }> {
    const replay = idempotencyKey ? this.idempotency.get(idempotencyKey) : undefined;
    if (replay) {
      this.audit.emit({ eventType: "email.write.idempotent_replay", payload: { method: "createDraft" } });
      return { externalRef: replay };
    }

    // Duplicate protection: if a draft with the same subject already exists on
    // the target thread, reuse it instead of creating a new one.
    if (input.threadId) {
      const existing = (await this.getDrafts(input.threadId)).find(
        (d) => normalizeSubject(d.subject) === normalizeSubject(input.subject),
      );
      if (existing?.id) {
        if (idempotencyKey) this.idempotency.set(idempotencyKey, existing.id);
        this.audit.emit({ eventType: "email.write.duplicate_avoided", payload: { method: "createDraft", threadId: input.threadId } });
        return { externalRef: existing.id };
      }
    }

    const res = (await this.client.post("/gmail/v1/users/me/drafts", {
      message: { raw: buildRawMessage(input), threadId: input.threadId },
    })) as { id: string };

    if (idempotencyKey) this.idempotency.set(idempotencyKey, res.id);
    this.audit.emit({ eventType: "email.write", payload: { method: "createDraft", externalRef: res.id } });
    return { externalRef: res.id };
  }
}

function normalizeSubject(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}
