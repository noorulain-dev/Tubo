import type {
  CreateDraftInput,
  EmailMessageRecord,
  EmailMessageState,
  EmailThreadRecord,
} from "../providers.js";

export interface GmailHeader {
  name: string;
  value: string;
}
export interface GmailBody {
  data?: string;
  size?: number;
}
export interface GmailPart {
  mimeType?: string;
  body?: GmailBody;
  parts?: GmailPart[];
  headers?: GmailHeader[];
}
export interface GmailPayload {
  headers?: GmailHeader[];
  body?: GmailBody;
  parts?: GmailPart[];
  mimeType?: string;
}
export interface GmailMessage {
  id: string;
  threadId?: string;
  labelIds?: string[];
  internalDate?: string;
  payload?: GmailPayload;
}
export interface GmailThread {
  id: string;
  messages?: GmailMessage[];
}

/** Extract a bare email from a "Name <email>" or plain address value. */
export function parseAddress(value: string): string {
  const match = /<([^>]+)>/.exec(value);
  return (match ? match[1] : value).trim().toLowerCase();
}

/** Split a comma-separated recipient header into normalized addresses. */
export function parseAddressList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => parseAddress(s))
    .filter((s) => s.length > 0);
}

/** Decode Gmail's base64url body into UTF-8 text. */
export function decodeBase64Url(data: string | undefined): string {
  if (!data) return "";
  const normalized = data.replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(normalized, "base64").toString("utf-8");
}

function header(payload: GmailPayload | undefined, name: string): string | undefined {
  return payload?.headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value;
}

function extractPlainText(payload: GmailPayload | undefined): string {
  if (!payload) return "";
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return decodeBase64Url(payload.body.data);
  }
  if (payload.parts) {
    for (const part of payload.parts) {
      if (part.mimeType === "text/plain" && part.body?.data) {
        return decodeBase64Url(part.body.data);
      }
      const nested = extractPlainText(part);
      if (nested) return nested;
    }
  }
  if (payload.body?.data) return decodeBase64Url(payload.body.data);
  return "";
}

function messageState(labelIds: string[] | undefined): EmailMessageState {
  const labels = labelIds ?? [];
  if (labels.includes("DRAFT")) return "draft";
  if (labels.includes("SENT")) return "sent";
  return "received";
}

export function normalizeMessage(raw: GmailMessage): EmailMessageRecord {
  const fromHeader = header(raw.payload, "From");
  return {
    id: raw.id,
    threadId: raw.threadId,
    from: parseAddress(fromHeader ?? ""),
    to: parseAddressList(header(raw.payload, "To")),
    subject: header(raw.payload, "Subject"),
    body: extractPlainText(raw.payload),
    sentAt: raw.internalDate
      ? new Date(Number(raw.internalDate)).toISOString()
      : header(raw.payload, "Date") ?? "",
    state: messageState(raw.labelIds),
  };
}

export function normalizeThread(raw: GmailThread): EmailThreadRecord {
  const messages = (raw.messages ?? []).map(normalizeMessage);
  const participants = [...new Set(messages.flatMap((m) => [m.from, ...m.to]))].filter(Boolean);
  return {
    id: raw.id,
    subject: messages[0]?.subject ?? "",
    participants,
    messages,
  };
}

/**
 * Build a base64url-encoded RFC 2822 message body for the Gmail drafts API.
 * `From` is intentionally omitted so Gmail fills it from the authenticated user.
 */
export function buildRawMessage(input: CreateDraftInput): string {
  const raw = [
    `To: ${input.to.join(", ")}`,
    `Subject: ${input.subject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "",
    input.body,
  ].join("\r\n");
  return Buffer.from(raw, "utf-8").toString("base64url");
}
