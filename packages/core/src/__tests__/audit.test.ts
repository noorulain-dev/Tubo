import { describe, expect, it } from "vitest";
import { AuditService, MemoryAuditSink, redact } from "../index.js";

describe("audit serialization + redaction", () => {
  it("redacts api keys and tokens recursively", () => {
    const out = redact({
      apiKey: "sk-secret",
      nested: { accessToken: "abc", ok: "visible" },
    }) as { apiKey: unknown; nested: { accessToken: unknown; ok: unknown } };

    expect(out.apiKey).toBe("[REDACTED]");
    expect(out.nested.accessToken).toBe("[REDACTED]");
    expect(out.nested.ok).toBe("visible");
  });

  it("redacts chain-of-thought fields", () => {
    const out = redact({ chainOfThought: "reasoning...", reasoning: "x" }) as {
      chainOfThought: unknown;
      reasoning: unknown;
    };
    expect(out.chainOfThought).toBe("[REDACTED]");
    expect(out.reasoning).toBe("[REDACTED]");
  });

  it("emits a valid, redacted audit event", () => {
    const sink = new MemoryAuditSink();
    const svc = new AuditService(sink);
    const evt = svc.emit({
      eventType: "run.started",
      runId: "r1",
      payload: { apiKey: "sk-x", note: "hello" },
    });

    expect(evt.eventType).toBe("run.started");
    expect(evt.runId).toBe("r1");
    expect(evt.payload).toEqual({ apiKey: "[REDACTED]", note: "hello" });
    expect(sink.events).toHaveLength(1);
  });
});
