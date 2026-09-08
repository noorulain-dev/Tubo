import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDefaultTools, isPlaceholderToken } from "../shared/core.js";
import { buildReadContext, type EvalCase } from "../evaluation/eval-shared.js";

const EVALS_DIR = resolve(process.cwd(), "../../evals");
const cases = (JSON.parse(readFileSync(resolve(EVALS_DIR, "cases.json"), "utf-8")).cases as EvalCase[]);
const byId = (id: string) => cases.find((c) => c.id === id)!;

describe("system-v0 evaluation harness validation", () => {
  it("provider fixtures are deterministic and derived from the frozen case (case-06 equivalent task)", async () => {
    const ctx = buildReadContext(byId("case-06"));
    const tasks = await ctx.crm.getOpenTasks("co-006");
    expect(tasks.map((t) => t.title)).toContain("Send final proposal to Northwind Logistics");
  });

  it("case-09 fixture: HubSpot deal Trial + commercial context Active", async () => {
    const ctx = buildReadContext(byId("case-09"));
    const deal = await ctx.crm.getOpenDeal("co-009");
    const commercial = await ctx.commercial.getCommercialState("co-009");
    expect(deal?.stage).toBe("Trial");
    expect(commercial.subscription?.status).toBe("active");
  });

  it("case-12 fixture: required source unavailable throws (fail safe, never fabricates)", async () => {
    const ctx = buildReadContext(byId("case-12"));
    await expect(ctx.commercial.getCommercialState("co-012")).rejects.toThrow("commercial unavailable");
  });

  it("no external executor is reachable: the agent tool registry has zero write tools", () => {
    const names = buildDefaultTools().map((t) => t.name);
    const writeTools = ["create_task", "create_note", "create_draft", "update_stage", "update_field", "send"];
    expect(names.some((n) => writeTools.includes(n))).toBe(false);
  });

  it("fails loudly on a missing/placeholder LLM key (never a keyword fallback)", () => {
    expect(isPlaceholderToken(undefined)).toBe(true);
    expect(isPlaceholderToken("your_key_here")).toBe(true);
    expect(isPlaceholderToken("sk-real-not-a-placeholder")).toBe(false);
  });
});
