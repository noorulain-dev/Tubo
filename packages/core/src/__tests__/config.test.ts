import { describe, expect, it } from "vitest";
import { loadConfig } from "../index.js";

describe("config", () => {
  it("applies defaults", () => {
    const c = loadConfig({});
    expect(c.nodeEnv).toBe("development");
    expect(c.deepseekModel).toBe("deepseek-chat");
    expect(c.maxToolCalls).toBe(12);
    expect(c.deepseekApiKey).toBeUndefined();
  });

  it("reads overrides", () => {
    const c = loadConfig({
      NODE_ENV: "production",
      DEEPSEEK_MODEL: "deepseek-reasoner",
      MAX_TOOL_CALLS: "8",
      DATABASE_URL: "postgres://x",
    });
    expect(c.nodeEnv).toBe("production");
    expect(c.deepseekModel).toBe("deepseek-reasoner");
    expect(c.maxToolCalls).toBe(8);
    expect(c.databaseUrl).toBe("postgres://x");
  });

  it("rejects an invalid numeric env value", () => {
    expect(() => loadConfig({ MAX_TOOL_CALLS: "not-a-number" })).toThrow(
      /Invalid environment configuration/,
    );
  });
});
