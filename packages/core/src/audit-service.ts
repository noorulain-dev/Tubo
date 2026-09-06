import { AuditEventSchema, type AuditEvent } from "./audit.js";
import type { AuditLevel } from "./enums.js";

/**
 * Keys that must never appear in an audit payload. Any object key matching this
 * pattern is replaced with "[REDACTED]". This covers API keys, OAuth/access
 * tokens, credentials, and chain-of-thought/reasoning fields.
 */
const SENSITIVE_KEY_PATTERN =
  /(api[_-]?key|access[_-]?token|auth|authorization|token|secret|password|credential|oauth|cookie|chain[_-]?of[_-]?thought|reasoning|thinking|cot|private[_-]?key)/i;

const MAX_DEPTH = 12;

/**
 * Recursively redact sensitive fields from an arbitrary value. Returns a deep
 * copy; never mutates the input.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value;
  }
  if (depth > MAX_DEPTH) {
    return "[MAX_DEPTH]";
  }
  if (Array.isArray(value)) {
    return value.map((v) => redact(v, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? "[REDACTED]" : redact(val, depth + 1);
    }
    return out;
  }
  return value;
}

export interface AuditSink {
  write(event: AuditEvent): void | Promise<void>;
}

export class MemoryAuditSink implements AuditSink {
  readonly events: AuditEvent[] = [];
  write(event: AuditEvent): void {
    this.events.push(event);
  }
}

export class ConsoleAuditSink implements AuditSink {
  write(event: AuditEvent): void {
    const line = JSON.stringify(event);
    if (event.level === "error") {
      console.error(line);
    } else if (event.level === "warn") {
      console.warn(line);
    } else {
      console.log(line);
    }
  }
}

export class NoopAuditSink implements AuditSink {
  write(_event: AuditEvent): void {
    // intentionally empty
  }
}

export interface EmitAuditInput {
  eventType: string;
  runId?: string | null;
  actor?: string | null;
  level?: AuditLevel;
  payload?: unknown;
  now?: Date;
}

export class AuditService {
  constructor(private readonly sink: AuditSink) {}

  emit(input: EmitAuditInput): AuditEvent {
    const event = AuditEventSchema.parse({
      runId: input.runId ?? null,
      eventType: input.eventType,
      actor: input.actor ?? null,
      level: input.level ?? "info",
      payload: redact(input.payload ?? {}),
      createdAt: (input.now ?? new Date()).toISOString(),
    });
    void this.sink.write(event);
    return event;
  }
}
