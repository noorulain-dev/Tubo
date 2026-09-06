import { beforeEach, describe, expect, it } from "vitest";
import { createSampleApp, resetSampleData } from "../sample.js";
import { DEMO_ACCOUNTS } from "../sample-fixtures.js";

interface Run {
  mode: string;
  status: string;
  findings: { classification: string; reason: string }[];
  proposals: { id: string; action: { type: string; payload?: Record<string, unknown> } }[];
}

async function submit(app: ReturnType<typeof createSampleApp>["app"], accountId: string, text: string): Promise<Run> {
  const res = await app.request("/interactions", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, kind: "note", accountId }),
  });
  return (await res.json()) as Run;
}

function account(id: string) {
  return DEMO_ACCOUNTS.find((a) => a.id === id)!;
}

beforeEach(() => resetSampleData());

describe("Sample Mode scenarios", () => {
  it("labels mode as sample", async () => {
    const { app } = createSampleApp();
    const health = (await (await app.request("/health")).json()) as { mode: string };
    expect(health.mode).toBe("sample");
    const run = await submit(app, "demo_missing", account("demo_missing").sampleInteraction);
    expect(run.mode).toBe("sample");
  });

  it("1. explicit missing-task scenario", async () => {
    const { app } = createSampleApp();
    const run = await submit(app, "demo_missing", account("demo_missing").sampleInteraction);
    expect(run.findings.map((f) => f.classification)).toContain("missing");
    expect(run.proposals.find((p) => p.action.type === "create_task")).toBeTruthy();
  });

  it("2. existing aligned task scenario", async () => {
    const { app } = createSampleApp();
    const run = await submit(app, "demo_aligned", account("demo_aligned").sampleInteraction);
    expect(run.findings.map((f) => f.classification)).toContain("duplicate");
    expect(run.proposals.find((p) => p.action.type === "create_task")).toBeUndefined();
  });

  it("3. active subscription / stale HubSpot Trial", async () => {
    const { app } = createSampleApp();
    const run = await submit(app, "demo_stale", account("demo_stale").sampleInteraction);
    const proposal = run.proposals.find((p) => p.action.type === "update_stage");
    expect(proposal?.action.payload?.stage).toBe("closedwon");
  });

  it("4. expired trial / Closed Lost eligibility", async () => {
    const { app } = createSampleApp();
    const run = await submit(app, "demo_closed_lost", account("demo_closed_lost").sampleInteraction);
    const proposal = run.proposals.find((p) => p.action.type === "update_stage");
    expect(proposal?.action.payload?.stage).toBe("closedlost");
  });

  it("5. ambiguous ownership scenario", async () => {
    const { app } = createSampleApp();
    const run = await submit(app, "demo_ambiguous", account("demo_ambiguous").sampleInteraction);
    expect(run.findings.map((f) => f.classification)).toContain("ambiguous");
  });

  it("6. source-unavailable scenario", async () => {
    const { app } = createSampleApp();
    const run = await submit(app, "demo_unavailable", account("demo_unavailable").sampleInteraction);
    expect(run.findings.map((f) => f.classification)).toContain("ambiguous");
  });

  it("updates fixture state on execution and resets", async () => {
    const { app, state } = createSampleApp();
    expect(state.deals.get("demo_stale")?.stage).toBe("Trial");

    const run = await submit(app, "demo_stale", account("demo_stale").sampleInteraction);
    const proposal = run.proposals.find((p) => p.action.type === "update_stage")!;
    await app.request(`/proposals/${proposal.id}/approve`, { method: "POST" });
    await app.request(`/proposals/${proposal.id}/execute`, { method: "POST" });

    expect(state.deals.get("demo_stale")?.stage).toBe("closedwon");
    expect(state.stageChanges).toContain("demo_stale: Trial -> closedwon");

    resetSampleData();
    expect(state.deals.get("demo_stale")?.stage).toBe("Trial");
  });

  it("exposes a reset admin endpoint", async () => {
    const { app } = createSampleApp();
    const res = await app.request("/admin/reset", { method: "POST" });
    expect(res.status).toBe(200);
    expect((await res.json()) as { ok: boolean }).toStrictEqual({ ok: true, mode: "sample" });
  });
});
