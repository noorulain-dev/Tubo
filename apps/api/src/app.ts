import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { isAppError } from "./core.js";
import { bearerAuth } from "./auth.js";
import type { RunService } from "./pipeline.js";
import { InteractionInputSchema, ProposalEditSchema, type ErrorEnvelope, type RunView } from "./types.js";

export interface CreateAppOptions {
  service: RunService;
  authToken?: string;
  mode?: "sample" | "integration";
  reset?: () => void;
}

function errorEnvelope(code: string, message: string, details?: unknown): ErrorEnvelope {
  return { error: { code, message, ...(details !== undefined ? { details } : {}) } };
}

function handleError(c: Context, err: unknown): Response {
  if (isAppError(err)) {
    return c.json(errorEnvelope(err.code, err.message, err.details), err.status as ContentfulStatusCode);
  }
  return c.json(errorEnvelope("INTERNAL", err instanceof Error ? err.message : "internal error"), 500);
}

function auditView(run: RunView) {
  const steps: string[] = [`run ${run.status} (created ${run.createdAt}, mode ${run.mode})`];
  if (run.semanticValid) {
    steps.push(
      `semantic: ${run.semantic?.confirmedCommitments.length ?? 0} confirmed commitments, ` +
        `${run.semantic?.commercialSignals.length ?? 0} commercial signals`,
    );
  } else {
    steps.push(`semantic failed: ${run.semanticErrors.join("; ")}`);
  }
  for (const f of run.findings) {
    steps.push(`reconciliation [${f.classification}] ${f.claimRef}: ${f.reason}`);
  }
  for (const p of run.proposals) {
    steps.push(`proposal ${p.id} (${p.action.type}) -> ${p.status} [policy ${p.policy.action}]`);
  }
  return { runId: run.id, mode: run.mode, status: run.status, steps };
}

export function createApp(opts: CreateAppOptions) {
  const app = new Hono();
  const mode = opts.mode ?? "integration";
  app.use("*", cors());
  app.use("*", bearerAuth(opts.authToken));

  app.post("/interactions", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = InteractionInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(errorEnvelope("VALIDATION", "invalid interaction payload", parsed.error.issues), 400);
    }
    try {
      const run = await opts.service.process(parsed.data);
      return c.json(run, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/runs", (c) => c.json(opts.service.listRuns()));

  app.get("/runs/:runId", (c) => {
    const run = opts.service.getRun(c.req.param("runId"));
    return run ? c.json(run) : c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
  });

  app.get("/runs/:runId/semantic", (c) => {
    const run = opts.service.getRun(c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json({ mode: run.mode, semantic: run.semantic, semanticValid: run.semanticValid, semanticErrors: run.semanticErrors });
  });

  app.get("/runs/:runId/reconciliation", (c) => {
    const run = opts.service.getRun(c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json({ mode: run.mode, findings: run.findings, gaps: run.gaps });
  });

  app.get("/runs/:runId/proposals", (c) => {
    const run = opts.service.getRun(c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json({ mode: run.mode, proposals: run.proposals });
  });

  app.get("/runs/:runId/audit", (c) => {
    const run = opts.service.getRun(c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json(auditView(run));
  });

  app.patch("/proposals/:proposalId", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ProposalEditSchema.safeParse(body);
    if (!parsed.success) return c.json(errorEnvelope("VALIDATION", "invalid edit payload", parsed.error.issues), 400);
    const view = opts.service.editProposal(c.req.param("proposalId"), parsed.data);
    return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
  });

  app.post("/proposals/:proposalId/approve", (c) => {
    const view = opts.service.approveProposal(c.req.param("proposalId"), "user");
    return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
  });

  app.post("/proposals/:proposalId/reject", (c) => {
    const view = opts.service.rejectProposal(c.req.param("proposalId"), "user");
    return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
  });

  app.post("/proposals/:proposalId/execute", async (c) => {
    try {
      const view = await opts.service.executeProposal(c.req.param("proposalId"));
      return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/admin/reset", (c) => {
    if (!opts.reset) return c.json(errorEnvelope("PERMISSION", "reset not available in this mode"), 404);
    opts.reset();
    return c.json({ ok: true, mode });
  });

  app.get("/health", (c) => c.json({ status: "ok", mode }));

  app.onError((err, c) => handleError(c, err));

  return app;
}
