import { describe, expect, it } from "vitest";
import {
  AppError,
  DuplicateError,
  ExecutionError,
  MissingContextError,
  PolicyBlockError,
  RateLimitError,
  ValidationError,
  errorCode,
  isAppError,
} from "../index.js";

describe("application errors", () => {
  it("assigns correct codes and statuses", () => {
    expect(new ValidationError("x").code).toBe("VALIDATION");
    expect(new ValidationError("x").status).toBe(400);
    expect(new MissingContextError("x").code).toBe("MISSING_CONTEXT");
    expect(new DuplicateError("x").status).toBe(409);
    expect(new PolicyBlockError("x").code).toBe("POLICY_BLOCK");
    expect(new ExecutionError("x").status).toBe(500);
  });

  it("marks rate limit and timeout as retryable", () => {
    expect(new RateLimitError("x").retryable).toBe(true);
    expect(new ValidationError("x").retryable).toBe(false);
  });

  it("carries details and cause", () => {
    const cause = new Error("root");
    const e = new AppError({
      code: "PROVIDER_ERROR",
      message: "m",
      details: { a: 1 },
      cause,
    });
    expect(e.details).toEqual({ a: 1 });
    expect(e.cause).toBe(cause);
  });

  it("helpers identify app errors", () => {
    const e = new MissingContextError("missing");
    expect(isAppError(e)).toBe(true);
    expect(errorCode(e)).toBe("MISSING_CONTEXT");
    expect(isAppError(new Error("plain"))).toBe(false);
    expect(errorCode(new Error("plain"))).toBeUndefined();
  });
});
