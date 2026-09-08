import { describe, expect, it } from "vitest";
import { createSampleApp } from "../app/sample.js";
import type { LLMProvider } from "../shared/core.js";

const commitmentLLM: LLMProvider = {
  generate: async () => ({
    content: JSON.stringify({
      confirmedCommitments: [
        {
          action: "send proposal",
          owner: "Sarah Chen",
          evidence: [{ source: "conversation", start: 0, end: 20, text: "send the proposal" }],
          resolution: "resolved",
        },
      ],
    }),
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    model: "mock",
    latencyMs: 1,
  }),
};

function json(res: Response) {
  return res.json();
}

async function post(app: ReturnType<typeof createSampleApp>["app"], path: string, body: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

describe("Revenue Execution API", () => {
  it("processes an interaction end-to-end", async () => {
    const { app } = createSampleApp({ llm: commitmentLLM });

    const created = await post(app, "/interactions", { text: "I'll send the proposal by Friday.", kind: "note" });
    expect(created.status).toBe(201);
    const run = (await json(created)) as { id: string; status: string; proposals: { id: string; status: string; action: { type: string } }[] };
    expect(run.status).toBe("needs_review");
    expect(run.proposals).toHaveLength(1);
    expect(run.proposals[0]?.action.type).toBe("create_task");
    expect(run.proposals[0]?.status).toBe("pending_approval");

    const runId = run.id;
    const proposalId = run.proposals[0]!.id;

    const fetched = await app.request(`/runs/${runId}`);
    expect(fetched.status).toBe(200);

    const semanticRes = await app.request(`/runs/${runId}/semantic`);
    const semantic = (await json(semanticRes)) as { semantic: { confirmedCommitments: unknown[] } };
    expect(semantic.semantic.confirmedCommitments).toHaveLength(1);

    const reconRes = await app.request(`/runs/${runId}/reconciliation`);
    const recon = (await json(reconRes)) as { findings: { classification: string }[] };
    expect(recon.findings[0]?.classification).toBe("missing");

    const history = await app.request("/runs");
    expect((await json(history)) as unknown[]).toHaveLength(1);

    const auditRes = await app.request(`/runs/${runId}/audit`);
    expect(auditRes.status).toBe(200);

    const health = (await json(await app.request("/health"))) as { status: string; mode: string };
    expect(health.status).toBe("ok");
    expect(health.mode).toBe("sample");

    const approveRes = await app.request(`/proposals/${proposalId}/approve`, { method: "POST" });
    expect(approveRes.status).toBe(200);

    const executeRes = await app.request(`/proposals/${proposalId}/execute`, { method: "POST" });
    expect(executeRes.status).toBe(200);
    const executed = (await json(executeRes)) as { status: string };
    expect(executed.status).toBe("executed");
  });

  it("records the CRM write during execution", async () => {
    const { app, state } = createSampleApp({ llm: commitmentLLM });
    const created = await post(app, "/interactions", { text: "I'll send the proposal by Friday.", kind: "note" });
    const run = (await json(created)) as { proposals: { id: string }[] };
    const proposalId = run.proposals[0]!.id;
    await app.request(`/proposals/${proposalId}/approve`, { method: "POST" });
    await app.request(`/proposals/${proposalId}/execute`, { method: "POST" });
    expect(state.tasks.some((t) => t.title === "send proposal")).toBe(true);
  });

  it("blocks execution without approval", async () => {
    const { app } = createSampleApp({ llm: commitmentLLM });
    const created = await post(app, "/interactions", { text: "I'll send the proposal by Friday.", kind: "note" });
    const run = (await json(created)) as { proposals: { id: string }[] };
    const res = await app.request(`/proposals/${run.proposals[0]!.id}/execute`, { method: "POST" });
    expect(res.status).toBe(422);
    const body = (await json(res)) as { error: { code: string } };
    expect(body.error.code).toBe("POLICY_BLOCK");
  });

  it("returns 404 for unknown run and proposal", async () => {
    const { app } = createSampleApp();
    expect((await app.request("/runs/missing")).status).toBe(404);
    expect((await app.request("/proposals/missing/approve", { method: "POST" })).status).toBe(404);
  });

  it("is open when no database is configured (session auth disabled)", async () => {
    const { app } = createSampleApp();
    const res = await post(app, "/interactions", { text: "hi", kind: "note" });
    expect(res.status).toBe(201);
  });

  it("rejects an invalid interaction payload", async () => {
    const { app } = createSampleApp();
    const res = await post(app, "/interactions", { text: "" });
    expect(res.status).toBe(400);
  });
});
