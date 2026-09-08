import { describe, expect, it } from "vitest";
import { backoffDelayMs, isTransientErrorCode, shouldRetry } from "../jobs/jobs.js";
import { HANDLERS } from "../jobs/job-handlers.js";

describe("job retry policy (pure)", () => {
  it("exponential backoff is bounded and monotonic", () => {
    expect(backoffDelayMs(0)).toBe(250);
    expect(backoffDelayMs(1)).toBe(500);
    expect(backoffDelayMs(2)).toBe(1000);
    expect(backoffDelayMs(20)).toBe(60_000); // capped
  });

  it("classifies only transient codes as retryable", () => {
    expect(isTransientErrorCode("RATE_LIMITED")).toBe(true);
    expect(isTransientErrorCode("PROVIDER_5XX")).toBe(true);
    expect(isTransientErrorCode("TIMEOUT")).toBe(true);
    expect(isTransientErrorCode("AUTH")).toBe(false);
    expect(isTransientErrorCode("BAD_REQUEST")).toBe(false);
    expect(isTransientErrorCode(null)).toBe(false);
  });

  it("never retries permanent errors even with attempts remaining", () => {
    expect(shouldRetry(false, 1, 5)).toBe(false);
  });

  it("stops retrying once max attempts is reached (no infinite retry)", () => {
    expect(shouldRetry(true, 0, 5)).toBe(true);
    expect(shouldRetry(true, 4, 5)).toBe(true);
    expect(shouldRetry(true, 5, 5)).toBe(false);
    expect(shouldRetry(true, 99, 5)).toBe(false);
  });
});

describe("job handler registry", () => {
  it("registers all required job types", () => {
    expect(Object.keys(HANDLERS).sort()).toEqual(
      ["account.refresh", "calendar.sync", "fireflies.fetch", "fireflies.sync", "interaction.process"].sort(),
    );
  });
});
