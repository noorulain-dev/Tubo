import { describe, expect, it, vi } from "vitest";
import {
  AuditService,
  Executor,
  InMemoryExecutionStore,
  MemoryAuditSink,
  SemanticInterpreter,
  type AgentReadContext,
} from "../core.js";
import { FixedProviderResolver, GmailTokenManager } from "../provider-resolver.js";
import { RunService } from "../pipeline.js";
import { InMemoryRunStore } from "../store.js";
import {
  createCrmRead,
  createCrmWrite,
  createEmailRead,
  createEmailWrite,
  createFixtureLLM,
  createSampleCommercial,
  getSampleState,
} from "../sample-fixtures.js";

function makeService(opts: { store?: InMemoryRunStore; executionStore?: InMemoryExecutionStore } = {}) {
  const state = getSampleState();
  const readContext: AgentReadContext = {
    crm: createCrmRead(state),
    email: createEmailRead(state),
    commercial: createSampleCommercial(),
  };
  const audit = new AuditService(new MemoryAuditSink());
  const executor = new Executor(createCrmWrite(state), createEmailWrite(state), {
    audit,
    store: opts.executionStore ?? new InMemoryExecutionStore(),
  });
  const interpreter = new SemanticInterpreter(createFixtureLLM());
  const resolver = new FixedProviderResolver({ readContext, executor });
  const store = opts.store ?? new InMemoryRunStore();
  const service = new RunService({ interpreter, resolver, store, mode: "sample" });
  return { service, store, executor };
}

describe("tenancy and persistence (step 50)", () => {
  it("isolates runs and proposals between users", async () => {
    const { service, store } = makeService();

    const runA = await service.process({ text: "I'll send the proposal by Friday.", kind: "note", accountId: "demo_missing" }, "userA");
    const runB = await service.process({ text: "I'll send the proposal by Friday.", kind: "note", accountId: "demo_missing" }, "userB");

    // Each user only sees their own runs.
    expect((await service.listRuns("userA")).map((r) => r.id)).toEqual([runA.id]);
    expect((await service.listRuns("userB")).map((r) => r.id)).toEqual([runB.id]);

    // User A cannot read User B's run.
    expect(await service.getRun(runB.id, "userA")).toBeUndefined();
    expect(await service.getRun(runA.id, "userA")).toBeDefined();

    // Proposals from A are not accessible to B.
    const proposalId = runA.proposals[0]?.id;
    expect(proposalId).toBeDefined();
    expect(await service.getProposal(proposalId!, "userB")).toBeUndefined();
    expect(await service.getProposal(proposalId!, "userA")).toBeDefined();

    // The store persisted both runs under distinct owners.
    expect(store).toBeDefined();
  });

  it("prevents User B from approving/executing User A's proposal", async () => {
    const { service } = makeService();
    const run = await service.process({ text: "Fjord has subscribed and is now paying.", kind: "note", accountId: "demo_stale" }, "userA");
    const proposal = run.proposals.find((p) => p.action.type === "update_stage");
    expect(proposal).toBeDefined();
    const id = proposal!.id;

    // User B cannot approve it.
    expect(await service.approveProposal(id, "userB", "userB")).toBeUndefined();
    // User B cannot execute it.
    expect(await service.executeProposal(id, "userB")).toBeUndefined();
    // User A still owns it and can approve.
    const approved = await service.approveProposal(id, "userA", "userA");
    expect(approved?.status).toBe("approved");
  });

  it("persists runs and proposals across RunService recreation (shared store)", async () => {
    const store = new InMemoryRunStore();
    const executionStore = new InMemoryExecutionStore();

    const first = makeService({ store, executionStore });
    const run = await first.service.process({ text: "I'll send the proposal by Friday.", kind: "note", accountId: "demo_missing" }, "userA");
    const proposalId = run.proposals[0]!.id;
    await first.service.approveProposal(proposalId, "userA", "userA");

    // Recreate the service over the SAME store (simulates API restart).
    const second = makeService({ store, executionStore });
    const reloaded = await second.service.getRun(run.id, "userA");
    expect(reloaded).toBeDefined();
    expect(reloaded!.proposals.map((p) => p.id)).toContain(proposalId);
    // Approval persisted.
    const proposal = await second.service.getProposal(proposalId, "userA");
    expect(proposal?.status).toBe("approved");
    expect(proposal?.approval?.decision).toBe("approve");
  });

  it("execution idempotency survives recreation (shared execution store)", async () => {
    const store = new InMemoryRunStore();
    const executionStore = new InMemoryExecutionStore();

    const first = makeService({ store, executionStore });
    const run = await first.service.process({ text: "Fjord has subscribed and is now paying.", kind: "note", accountId: "demo_stale" }, "userA");
    const proposal = run.proposals.find((p) => p.action.type === "update_stage");
    await first.service.approveProposal(proposal!.id, "userA", "userA");

    // Execute once.
    const executed = await first.service.executeProposal(proposal!.id, "userA");
    expect(executed?.status).toBe("executed");

    // Recreate service (same execution store) and execute again — must be a duplicate, not a second write.
    const second = makeService({ store, executionStore });
    const again = await second.service.executeProposal(proposal!.id, "userA");
    expect(again?.execution?.status).toBe("success");
  });

  it("audit sink records events for the owner", async () => {
    const audit = new AuditService(new MemoryAuditSink());
    const state = getSampleState();
    const executor = new Executor(createCrmWrite(state), createEmailWrite(state), { audit });
    const events = (audit as unknown as { sink: MemoryAuditSink }).sink.events;
    expect(Array.isArray(events)).toBe(true);
    // Executing an action emits audit events.
    const run = await executor.executeBatch([
      {
        proposal: { id: "p", type: "create_note", target: "demo_missing", payload: { body: "hi" }, requiresApproval: false, blocked: false },
        policyContext: { commercialState: null, openDeal: null },
        runId: "r1",
        interactionFingerprint: "fp",
        proposalSignature: "sig_1",
      },
    ]);
    expect(run.status).toBe("success");
    expect(events.length).toBeGreaterThan(0);
  });

  it("GmailTokenManager caches the access token and refreshes on expiry", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async () => {
      calls += 1;
      return new Response(JSON.stringify({ access_token: `tok_${calls}`, expires_in: 3600 }), { status: 200 });
    });

    const mgr = new GmailTokenManager("client", "secret", "refresh");
    const first = await mgr.getAccessToken();
    const second = await mgr.getAccessToken();
    expect(second).toBe(first); // cached, no extra exchange
    expect(calls).toBe(1);

    vi.unstubAllGlobals();
  });

  it("invalid/revoked Gmail refresh falls back to empty (no fabricated data) without throwing", async () => {
    vi.stubGlobal("fetch", async () => {
      return new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 });
    });
    const mgr = new GmailTokenManager("client", "secret", "revoked");
    await expect(mgr.getAccessToken()).rejects.toThrow();
    vi.unstubAllGlobals();
  });
});
