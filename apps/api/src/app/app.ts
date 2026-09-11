import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FirefliesProvider, isAppError, loadConfig, type IntegrationStatus } from "../shared/core.js";
import { bearerAuth } from "../auth/auth.js";
import { loginUser, logout, registerUser, type AuthUser } from "../auth/auth-service.js";
import { logger } from "../observability/logger.js";
import { rateLimit } from "../observability/rate-limit.js";
import { isDbConfigured, pingDb } from "../database/db.js";
import { consumePasswordReset, createPasswordReset } from "../auth/verification.js";
import { consumeVerificationToken, resendVerification } from "../auth/email-verification.service.js";
import { getConnectionsStatus, getFirefliesApiKey, removeConnection, setConnection, type ConnectionProvider } from "../integrations/connections.js";
import { buildGmailAuthorizationUrl, exchangeGmailAuthCode, GOOGLE_SCOPES } from "../integrations/gmail-oauth.js";
import { getCalendarLastSync, listCalendarEvents, syncCalendar } from "../integrations/calendar-sync.js";
import { getChannelUser, registerWatch } from "../integrations/calendar-watch.js";
import { enqueue } from "../jobs/jobs.js";
import { getSnapshot, listAccountEvents, listAccounts } from "../accounts/account-intelligence.js";
import { recordManualInteraction, recordExternalExecution } from "../accounts/account-service.js";
import { Investigator, listInvestigations, saveInvestigation } from "../accounts/investigation.js";
import { getFinding, listFindings } from "../accounts/risk-scanner.js";
import { applyDecision, approveAllEligible, getPlan, listPlans, savePlan, type ExecutionPlan } from "../proposals/execution-plans.js";
import { createExecutionPlan } from "../proposals/plan-service.js";
import { getAccountDetail, listAccountRows, markReviewed } from "../accounts/command-center.js";
import { getContextGaps, submitContextResolution } from "../accounts/context-resolution-service.js";
import { listContextResolutions } from "../accounts/context-resolution-repository.js";
import type { ResolutionChoice } from "../accounts/context-resolution.js";

import type { RunService } from "../runs/pipeline.js";
import { loadEvaluationSummary } from "../evaluation/evaluation-summary.js";

import { InteractionInputSchema, ProposalEditSchema, type ErrorEnvelope, type RunView } from "../shared/types.js";

export interface CreateAppOptions {
  sampleService: RunService;
  liveService?: RunService;
  mode?: "sample" | "integration";
  integrations?: IntegrationStatus;
  gmailOAuth?: { clientId: string; clientSecret: string; redirectUri: string; calendarRedirectUri?: string };
  reset?: () => void;
}

function errorEnvelope(code: string, message: string, details?: unknown, requestId?: string): ErrorEnvelope {
  return { error: { code, message, ...(details !== undefined ? { details } : {}), ...(requestId ? { requestId } : {}) } };
}

/** Normalize any thrown value into a stable, non-leaking API error. */
function normalizeError(err: unknown): { code: string; status: number; message: string; details?: unknown } {
  if (isAppError(err)) {
    return { code: err.code, status: err.statusCode, message: err.message, details: err.safeDetails };
  }
  const pgCode = (err as { code?: string } | undefined)?.code;
  if (pgCode === "23505") return { code: "CONFLICT", status: 409, message: "resource already exists" };
  if (pgCode === "23503") return { code: "CONFLICT", status: 409, message: "related resource is missing" };
  if (pgCode === "23502") return { code: "VALIDATION", status: 400, message: "a required field is missing" };
  // Fallback: never expose the raw error (stack, SQL, tokens, or credentials).
  const production = loadConfig().nodeEnv === "production";
  return {
    code: "INTERNAL_ERROR",
    status: 500,
    message: production ? "internal server error" : err instanceof Error ? err.message : "internal server error",
  };
}

function handleError(c: Context, err: unknown): Response {
  const requestId = c.get("requestId") as string | undefined;
  const norm = normalizeError(err);
  if (norm.status >= 500) {
    logger.error(
      { event: "error", requestId, error_code: norm.code, message: err instanceof Error ? err.message : String(err) },
      "unhandled request error",
    );
  }
  return c.json(errorEnvelope(norm.code, norm.message, norm.details, requestId), norm.status as ContentfulStatusCode);
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

function safeReturnTo(value: string | undefined): string {
  if (value && (value.startsWith("http://") || value.startsWith("https://"))) return value;
  return "http://localhost:5173";
}

function parseState(state: string | undefined): { returnTo: string; userId: string | null } {
  let returnTo = "http://localhost:5173";
  let userId: string | null = null;
  try {
    const parsed = JSON.parse(state ?? "{}") as { returnTo?: unknown; userId?: unknown };
    if (typeof parsed.returnTo === "string" && (parsed.returnTo.startsWith("http://") || parsed.returnTo.startsWith("https://"))) {
      returnTo = parsed.returnTo;
    }
    if (typeof parsed.userId === "string" && parsed.userId) userId = parsed.userId;
  } catch {
    /* ignore malformed state */
  }
  return { returnTo, userId };
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&").replace(/</g, "<").replace(/>/g, ">");
}

function oauthPage(message: string, returnTo: string, auto: boolean): string {
  const refresh = auto ? `<meta http-equiv="refresh" content="1;url=${escapeHtml(returnTo)}">` : "";
  return `<!doctype html><html><head><meta charset="utf-8">${refresh}</head><body style="font-family:sans-serif;padding:32px"><p>${escapeHtml(message)}</p><p><a href="${escapeHtml(returnTo)}">Return to app</a></p></body></html>`;
}

function currentUser(c: Context): AuthUser | undefined {
  return c.get("user") as AuthUser | undefined;
}

/** In open (no-DB) mode there is no session; use a stable anonymous owner. */
function ownerId(c: Context): string {
  return currentUser(c)?.id ?? "anonymous";
}

function bearerToken(c: Context): string {
  const header = c.req.header("authorization") ?? "";
  return header.startsWith("Bearer ") ? header.slice("Bearer ".length) : "";
}

declare module "hono" {
  interface ContextVariableMap {
    requestId: string;
  }
}

export function createApp(opts: CreateAppOptions) {
  const app = new Hono();
  const all = [opts.sampleService, opts.liveService].filter((s): s is RunService => !!s);

  const findRun = async (c: Context, runId: string): Promise<RunView | undefined> => {
    const userId = ownerId(c);
    for (const s of all) {
      const run = await s.getRun(runId, userId);
      if (run) return run;
    }
    return undefined;
  };

  const findProposalService = async (c: Context, proposalId: string): Promise<RunService | undefined> => {
    const userId = ownerId(c);
    for (const s of all) {
      if (await s.getProposal(proposalId, userId)) return s;
    }
    return undefined;
  };

  // Request correlation: accept a safe incoming X-Request-ID or mint one; echo it.
  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });
  app.use("*", cors());
  app.use("*", bearerAuth());
  // Structured request logging (runs after auth so userId is known).
  app.use("*", async (c, next) => {
    const start = Date.now();
    await next();
    logger.info(
      {
        event: "request",
        requestId: c.get("requestId"),
        method: c.req.method,
        path: c.req.path,
        status: c.res.status,
        latency_ms: Date.now() - start,
        userId: currentUser(c)?.id,
      },
      "request",
    );
  });

  // ------------------------------------------------------------------- auth
  app.post("/auth/register", rateLimit({ max: 5, windowMs: 60_000 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) return c.json(errorEnvelope("VALIDATION", "email and password are required"), 400);
    if (password.length < 8) return c.json(errorEnvelope("VALIDATION", "password must be at least 8 characters"), 400);
    try {
      const { token, user } = await registerUser(email, password);
      return c.json({ token, user }, 201);
    } catch (err) {
      if ((err as { code?: string }).code === "23505") {
        return c.json(errorEnvelope("CONFLICT", "an account with that email already exists"), 409);
      }
      return handleError(c, err);
    }
  });

  app.post("/auth/login", rateLimit({ max: 10, windowMs: 60_000 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown; password?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!email || !password) return c.json(errorEnvelope("VALIDATION", "email and password are required"), 400);
    try {
      const { token, user } = await loginUser(email, password);
      return c.json({ token, user });
    } catch (err) {
      return c.json(errorEnvelope("AUTHENTICATION", "invalid email or password"), 401);
    }
  });

  app.post("/auth/logout", async (c) => {
    const token = bearerToken(c);
    if (token) await logout(token).catch(() => undefined);
    return c.json({ ok: true });
  });

  app.get("/auth/me", (c) => {
    const user = currentUser(c);
    return user ? c.json({ user }) : c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
  });

  app.post("/auth/verify-email", rateLimit({ max: 20, windowMs: 60_000 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    if (!token) return c.json(errorEnvelope("VALIDATION", "token is required"), 400);
    try {
      await consumeVerificationToken(token);
      return c.json({ ok: true });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/auth/resend-verification", rateLimit({ max: 3, windowMs: 60_000 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return c.json(errorEnvelope("VALIDATION", "email is required"), 400);
    try {
      await resendVerification(email);
      return c.json({ ok: true });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/auth/forgot-password", rateLimit({ max: 5, windowMs: 60_000 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { email?: unknown } | null;
    const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
    if (!email) return c.json(errorEnvelope("VALIDATION", "email is required"), 400);
    await createPasswordReset(email); // generic success regardless of account existence
    return c.json({ ok: true });
  });

  app.post("/auth/reset-password", rateLimit({ max: 10, windowMs: 60_000 }), async (c) => {
    const body = (await c.req.json().catch(() => null)) as { token?: unknown; password?: unknown } | null;
    const token = typeof body?.token === "string" ? body.token : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!token || password.length < 8) return c.json(errorEnvelope("VALIDATION", "a valid token and password (min 8 characters) are required"), 400);
    try {
      await consumePasswordReset(token, password);
      return c.json({ ok: true });
    } catch (err) {
      return handleError(c, err);
    }
  });

  // ------------------------------------------------------------------- runs
  app.post("/interactions", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = InteractionInputSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(errorEnvelope("VALIDATION", "invalid interaction payload", parsed.error.issues), 400);
    }
    const input = parsed.data;
    const wantLive = input.mode === "live";
    if (wantLive && !opts.liveService) {
      return c.json(errorEnvelope("UNAVAILABLE", "Live Mode is not configured on this server"), 400);
    }
    if (wantLive && !currentUser(c)) {
      return c.json(errorEnvelope("AUTHENTICATION", "Live Mode requires an authenticated user"), 401);
    }
    const service = wantLive ? opts.liveService! : opts.sampleService;
    const userId = ownerId(c);
    try {
      const run = await service.process(
        { text: input.text, kind: input.kind, accountId: input.accountId, participants: input.participants, truncated: input.truncated },
        userId,
      );
      await recordManualInteraction(userId, input.accountId, run).catch(() => undefined);
      return c.json(run, 201);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/accounts", async (c) => {
    const userId = ownerId(c);
    const accounts = await listAccounts(userId);
    return c.json({ accounts });
  });

  app.get("/accounts/:accountId/intelligence", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const snapshot = await getSnapshot(user.id, c.req.param("accountId"));
    return c.json(snapshot);
  });

  app.get("/accounts/:accountId/events", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const events = await listAccountEvents(user.id, c.req.param("accountId"));
    return c.json({ events });
  });

  app.get("/accounts/:accountId/findings", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const findings = await listFindings(user.id, c.req.param("accountId"));
    return c.json({ findings });
  });

  // --- Missing / ambiguous context resolution (human-in-the-loop) ----------
  // Read-only: what can a human legitimately answer on this account right now?
  app.get("/accounts/:accountId/context-gaps", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const view = await getContextGaps(user.id, c.req.param("accountId"), { id: user.id, email: user.email });
    return c.json(view);
  });

  // Persist one human answer, then re-run ONLY this account's reconciliation.
  // Never approves, executes, or overrides an authoritative source.
  app.post("/accounts/:accountId/context-resolutions", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const body = (await c.req.json().catch(() => null)) as {
      gapId?: string;
      choice?: { kind?: string; optionId?: string; date?: string };
      runId?: string | null;
      findingId?: string | null;
    } | null;
    if (!body?.gapId || !body.choice?.kind) return c.json(errorEnvelope("VALIDATION", "gapId and choice are required"), 400);

    const kind = body.choice.kind;
    let choice: ResolutionChoice;
    if (kind === "option") {
      if (!body.choice.optionId) return c.json(errorEnvelope("VALIDATION", "optionId is required"), 400);
      choice = { kind: "option", optionId: body.choice.optionId };
    } else if (kind === "date") {
      if (!body.choice.date) return c.json(errorEnvelope("VALIDATION", "date is required"), 400);
      choice = { kind: "date", date: body.choice.date };
    } else if (kind === "unresolved") {
      choice = { kind: "unresolved" };
    } else {
      return c.json(errorEnvelope("VALIDATION", "unsupported choice kind"), 400);
    }

    const result = await submitContextResolution(
      user.id,
      c.req.param("accountId"),
      body.gapId,
      choice,
      { id: user.id, email: user.email },
      { runId: body.runId ?? null, findingId: body.findingId ?? null },
    );
    if (!result.ok) {
      const status = result.code === "NOT_FOUND" ? 404 : result.code === "GAP_NOT_RESOLVABLE" ? 409 : 400;
      return c.json(errorEnvelope(result.code === "NOT_FOUND" ? "NOT_FOUND" : "VALIDATION", result.message), status);
    }
    return c.json(result, 201);
  });

  // Append-only audit trail of human-supplied context for this account.
  app.get("/accounts/:accountId/context-resolutions", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const resolutions = await listContextResolutions(user.id, c.req.param("accountId"));
    return c.json({ resolutions });
  });


  app.post("/accounts/:accountId/refresh", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const accountId = c.req.param("accountId");
    const { id, created } = await enqueue({
      type: "account.refresh",
      userId: user.id,
      resourceRef: accountId,
      idempotencyKey: `acct:refresh:manual:${user.id}:${accountId}:${Math.floor(Date.now() / 1000)}`,
    });
    return c.json({ enqueued: true, jobId: id, created });
  });

  app.post("/findings/:findingId/investigate", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const findingId = c.req.param("findingId");
    const finding = await getFinding(user.id, findingId);
    if (!finding) return c.json(errorEnvelope("NOT_FOUND", "finding not found"), 404);

    const service = opts.liveService ?? opts.sampleService;
    const readContext = await service.resolveReadContext(user.id);
    const investigator = new Investigator(readContext);
    const result = await investigator.investigate(finding, finding.accountId);
    await saveInvestigation(user.id, result).catch(() => undefined);
    return c.json(result);
  });

  app.get("/findings/:findingId/investigations", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const investigations = await listInvestigations(user.id, c.req.param("findingId"));
    return c.json({ investigations });
  });

  app.post("/execution-plans", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const body = (await c.req.json().catch(() => null)) as {
      accountId?: string;
      findingIds?: string[];
      objective?: string;
      summary?: string;
      evidence?: string[];
      actions?: { action: unknown; dependsOn?: string[] }[];
    } | null;
    if (!body?.accountId || !body?.objective || !Array.isArray(body.actions)) {
      return c.json(errorEnvelope("VALIDATION", "accountId, objective, and actions are required"), 400);
    }

    const service = opts.liveService ?? opts.sampleService;
    const readContext = await service.resolveReadContext(user.id);
    const plan = await createExecutionPlan(
      user.id,
      {
        accountId: body.accountId,
        findingIds: body.findingIds ?? [],
        objective: body.objective,
        summary: body.summary,
        evidence: body.evidence,
        actions: body.actions.map((a) => ({ action: a.action as never, dependsOn: a.dependsOn })),
      },
      readContext,
    );
    return c.json(plan, 201);
  });

  app.get("/execution-plans", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const accountId = c.req.query("accountId");
    if (!accountId) return c.json(errorEnvelope("VALIDATION", "accountId query is required"), 400);
    return c.json({ plans: await listPlans(user.id, accountId) });
  });

  app.get("/execution-plans/:planId", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const plan = await getPlan(user.id, c.req.param("planId"));
    return plan ? c.json(plan) : c.json(errorEnvelope("NOT_FOUND", "plan not found"), 404);
  });

  app.post("/execution-plans/:planId/actions/:actionId/decision", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const plan = await getPlan(user.id, c.req.param("planId"));
    if (!plan) return c.json(errorEnvelope("NOT_FOUND", "plan not found"), 404);
    const body = (await c.req.json().catch(() => null)) as { decision?: "approve" | "reject" | "edit"; payload?: Record<string, unknown> } | null;
    if (!body?.decision) return c.json(errorEnvelope("VALIDATION", "decision is required"), 400);
    const next = applyDecision(plan, c.req.param("actionId"), body.decision, { payload: body.payload, reviewer: user.email });
    await savePlan(user.id, next);
    return c.json(next);
  });

  app.post("/execution-plans/:planId/approve-all", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const plan = await getPlan(user.id, c.req.param("planId"));
    if (!plan) return c.json(errorEnvelope("NOT_FOUND", "plan not found"), 404);
    const next = approveAllEligible(plan, user.email);
    await savePlan(user.id, next);
    return c.json(next);
  });

  app.post("/execution-plans/:planId/actions/:actionId/execute", async (c) => {
    if (currentUser(c)?.evaluator) {
      return c.json(errorEnvelope("PERMISSION", "External execution is disabled in the evaluator workspace."), 403);
    }
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const plan = await getPlan(user.id, c.req.param("planId"));
    if (!plan) return c.json(errorEnvelope("NOT_FOUND", "plan not found"), 404);
    const service = opts.liveService ?? opts.sampleService;
    if (!service) return c.json(errorEnvelope("MODEL_UNAVAILABLE", "execution unavailable"), 503);
    try {
      const actionId = c.req.param("actionId");
      const body = (await c.req.json().catch(() => null)) as { companyId?: string | null } | null;
      const result = await service.executePlanAction(plan, actionId, user.id, body?.companyId ?? null);
      const updated: ExecutionPlan = {
        ...plan,
        actions: plan.actions.map((a) =>
          a.actionId === actionId
            ? { ...a, status: result.status === "success" ? "executed" : "failed", execution: result }
            : a,
        ),
      };
      await savePlan(user.id, updated);
      return c.json(updated);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/hubspot/companies", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const service = opts.liveService ?? opts.sampleService;
    if (!service) return c.json(errorEnvelope("MODEL_UNAVAILABLE", "live integrations unavailable"), 503);
    try {
      const companies = await service.listCompanies(user.id);
      return c.json({ companies });
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/command-center", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const limit = Number(c.req.query("limit") ?? 50);
    const offset = Number(c.req.query("offset") ?? 0);
    const { rows, total } = await listAccountRows(user.id, { limit, offset });
    return c.json({ rows, total, limit, offset });
  });

  app.get("/command-center/accounts/:accountId", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const detail = await getAccountDetail(user.id, c.req.param("accountId"));
    return detail ? c.json(detail) : c.json(errorEnvelope("NOT_FOUND", "account not found"), 404);
  });

  app.post("/command-center/accounts/:accountId/reviewed", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const result = await markReviewed(user.id, c.req.param("accountId"));
    return c.json(result);
  });

  app.get("/runs", async (c) => {
    const userId = ownerId(c);
    const runs = await Promise.all(all.map((s) => s.listRuns(userId)));
    return c.json(runs.flat());
  });

  app.get("/runs/:runId", async (c) => {
    const run = await findRun(c, c.req.param("runId"));
    return run ? c.json(run) : c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
  });

  app.get("/runs/:runId/semantic", async (c) => {
    const run = await findRun(c, c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json({ mode: run.mode, semantic: run.semantic, semanticValid: run.semanticValid, semanticErrors: run.semanticErrors });
  });

  app.get("/runs/:runId/reconciliation", async (c) => {
    const run = await findRun(c, c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json({ mode: run.mode, findings: run.findings, gaps: run.gaps });
  });

  app.get("/runs/:runId/proposals", async (c) => {
    const run = await findRun(c, c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json({ mode: run.mode, proposals: run.proposals });
  });

  app.get("/runs/:runId/audit", async (c) => {
    const run = await findRun(c, c.req.param("runId"));
    if (!run) return c.json(errorEnvelope("NOT_FOUND", "run not found"), 404);
    return c.json(auditView(run));
  });

  app.patch("/proposals/:proposalId", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = ProposalEditSchema.safeParse(body);
    if (!parsed.success) return c.json(errorEnvelope("VALIDATION", "invalid edit payload", parsed.error.issues), 400);
    const svc = await findProposalService(c, c.req.param("proposalId"));
    if (!svc) return c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    const view = await svc.editProposal(c.req.param("proposalId"), ownerId(c), parsed.data);
    return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
  });

  app.post("/proposals/:proposalId/approve", async (c) => {
    const svc = await findProposalService(c, c.req.param("proposalId"));
    if (!svc) return c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    const view = await svc.approveProposal(c.req.param("proposalId"), ownerId(c), "user");
    return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
  });

  app.post("/proposals/:proposalId/reject", async (c) => {
    const svc = await findProposalService(c, c.req.param("proposalId"));
    if (!svc) return c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    const view = await svc.rejectProposal(c.req.param("proposalId"), ownerId(c), "user");
    return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
  });

  app.post("/proposals/:proposalId/execute", async (c) => {
    // Evaluator (demo) workspace is read-only for external execution: never allow
    // an evaluator account to mutate a real HubSpot/Gmail integration.
    if (currentUser(c)?.evaluator) {
      return c.json(errorEnvelope("PERMISSION", "External execution is disabled in the evaluator workspace."), 403);
    }
    const svc = await findProposalService(c, c.req.param("proposalId"));
    if (!svc) return c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    try {
      const view = await svc.executeProposal(c.req.param("proposalId"), ownerId(c));
      if (view) {
        await recordExternalExecution(ownerId(c), view).catch(() => undefined);
      }
      return view ? c.json(view) : c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/admin/reset", (c) => {
    if (!opts.reset) return c.json(errorEnvelope("PERMISSION", "reset not available in this mode"), 404);
    opts.reset();
    return c.json({ ok: true, mode: opts.mode ?? "sample" });
  });

  app.get("/health", (c) => c.json({ status: "ok", mode: opts.mode ?? "sample", liveAvailable: !!opts.liveService }));

  // Read-only, public: normalized summary of the COMMITTED evaluation artifacts.
  // Never re-runs an evaluation; returns 404 when no artifacts are present.
  app.get("/evaluation/summary", async (c) => {
    try {
      const summary = await loadEvaluationSummary();
      if (!summary) return c.json(errorEnvelope("NOT_FOUND", "no committed evaluation artifacts are available"), 404);
      return c.json(summary);
    } catch (err) {
      return handleError(c, err);
    }
  });


  // Readiness: critical dependency (database) must be reachable to serve.
  app.get("/ready", async (c) => {
    let database = "ok";
    if (!isDbConfigured()) {
      database = "not_configured";
    } else if (!(await pingDb())) {
      database = "down";
    }
    // No credentials/account details are ever returned here.
    const ready = database === "ok";
    return c.json({ status: ready ? "ready" : "not_ready", dependencies: { database } }, ready ? 200 : 503);
  });

  // ---------------------------------------------------- customer connections
  app.get("/connections", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    return c.json(await getConnectionsStatus(user.id));
  });

  app.post("/connections/stripe", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const body = (await c.req.json().catch(() => null)) as { secretKey?: unknown } | null;
    const secretKey = typeof body?.secretKey === "string" ? body.secretKey.trim() : "";
    if (!secretKey) return c.json(errorEnvelope("VALIDATION", "secretKey is required"), 400);
    await setConnection(user.id, "stripe", secretKey);
    return c.json(await getConnectionsStatus(user.id));
  });

  app.post("/connections/hubspot", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const body = (await c.req.json().catch(() => null)) as { accessToken?: unknown } | null;
    const accessToken = typeof body?.accessToken === "string" ? body.accessToken.trim() : "";
    if (!accessToken) return c.json(errorEnvelope("VALIDATION", "accessToken is required"), 400);
    await setConnection(user.id, "hubspot", accessToken);
    return c.json(await getConnectionsStatus(user.id));
  });

  app.post("/connections/fireflies", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const body = (await c.req.json().catch(() => null)) as { apiKey?: unknown } | null;
    const apiKey = typeof body?.apiKey === "string" ? body.apiKey.trim() : "";
    if (!apiKey) return c.json(errorEnvelope("VALIDATION", "apiKey is required"), 400);
    await setConnection(user.id, "fireflies", apiKey);
    return c.json(await getConnectionsStatus(user.id));
  });

  app.post("/connections/fireflies/test", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const apiKey = await getFirefliesApiKey(user.id);
    if (!apiKey) return c.json(errorEnvelope("NOT_FOUND", "Fireflies is not connected"), 400);
    const provider = new FirefliesProvider({ apiKey });
    const result = await provider.validateConnection();
    if (!result.ok) return c.json(result);
    const meetings = await provider.listRecentMeetings();
    return c.json({
      ok: true,
      meetingCount: meetings.length,
      recent: meetings.slice(0, 5).map((m) => ({ title: m.title, startedAt: m.startedAt })),
    });
  });

  app.delete("/connections/:provider", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const provider = c.req.param("provider") as ConnectionProvider;
    if (!["stripe", "hubspot", "gmail", "google-calendar", "fireflies"].includes(provider)) {
      return c.json(errorEnvelope("VALIDATION", "unknown provider"), 400);
    }
    await removeConnection(user.id, provider);
    return c.json(await getConnectionsStatus(user.id));
  });

  // --------------------------------------------------------------- Gmail OAuth
  app.get("/gmail/oauth/url", (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const g = opts.gmailOAuth;
    if (!g) return c.json(errorEnvelope("UNAVAILABLE", "Gmail OAuth is not configured on this server"), 400);
    const returnTo = safeReturnTo(c.req.query("returnTo"));
    const state = JSON.stringify({ nonce: randomUUID(), returnTo, userId: user.id });
    const url = buildGmailAuthorizationUrl({ clientId: g.clientId, redirectUri: g.redirectUri, state });
    return c.json({ url });
  });

  app.get("/gmail/oauth/callback", async (c) => {
    const g = opts.gmailOAuth;
    const { returnTo, userId } = parseState(c.req.query("state"));
    if (!g) return c.html(oauthPage("Gmail OAuth is not configured on this server.", returnTo, false));

    const code = c.req.query("code");
    const denied = c.req.query("error");
    if (denied || !code) {
      return c.html(oauthPage("Authorization was not completed.", returnTo, false));
    }

    try {
      const tokens = await exchangeGmailAuthCode({
        clientId: g.clientId,
        clientSecret: g.clientSecret,
        redirectUri: g.redirectUri,
        code,
      });
      if (tokens.refreshToken && userId) {
        await setConnection(userId, "gmail", tokens.refreshToken);
      }
      return c.html(oauthPage("Gmail connected successfully.", returnTo, true));
    } catch (err) {
      return c.html(oauthPage(`Failed to connect Gmail: ${err instanceof Error ? err.message : String(err)}`, returnTo, false));
    }
  });

  app.get("/integrations/google-calendar/oauth/url", (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const g = opts.gmailOAuth;
    if (!g) return c.json(errorEnvelope("UNAVAILABLE", "Google OAuth is not configured"), 400);
    const returnTo = safeReturnTo(c.req.query("returnTo"));
    const state = JSON.stringify({ nonce: randomUUID(), returnTo, userId: user.id });
    const url = buildGmailAuthorizationUrl({
      clientId: g.clientId,
      redirectUri: g.calendarRedirectUri ?? g.redirectUri,
      state,
      scopes: GOOGLE_SCOPES,
    });
    return c.json({ url });
  });

  app.get("/integrations/google-calendar/oauth/callback", async (c) => {
    const g = opts.gmailOAuth;
    const { returnTo, userId } = parseState(c.req.query("state"));
    if (!g) return c.html(oauthPage("Google OAuth is not configured.", returnTo, false));
    const code = c.req.query("code");
    const denied = c.req.query("error");
    if (denied || !code) return c.html(oauthPage("Authorization was not completed.", returnTo, false));
    try {
      const tokens = await exchangeGmailAuthCode({
        clientId: g.clientId,
        clientSecret: g.clientSecret,
        redirectUri: g.calendarRedirectUri ?? g.redirectUri,
        code,
      });
      if (tokens.refreshToken && userId) {
        await setConnection(userId, "gmail", tokens.refreshToken);
        await setConnection(userId, "google-calendar", tokens.refreshToken);
      }
      return c.html(oauthPage("Google Calendar connected successfully.", returnTo, true));
    } catch (err) {
      return c.html(oauthPage(`Failed to connect Calendar: ${err instanceof Error ? err.message : String(err)}`, returnTo, false));
    }
  });

  app.post("/integrations/google-calendar/sync", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    try {
      const result = await syncCalendar(user.id);
      return c.json(result);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.get("/integrations/google-calendar/events", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const start = c.req.query("start");
    const end = c.req.query("end");
    if (!start || !end) return c.json(errorEnvelope("VALIDATION", "start and end are required"), 400);
    const [events, lastSyncAt] = await Promise.all([
      listCalendarEvents(user.id, new Date(start), new Date(end)),
      getCalendarLastSync(user.id),
    ]);
    return c.json({ events, lastSyncAt });
  });

  app.post("/integrations/google-calendar/watch", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const webhookUrl = loadConfig().calendarWebhookUrl;
    if (!webhookUrl) return c.json(errorEnvelope("CONFIG", "CALENDAR_WEBHOOK_URL is not set (a public HTTPS address is required)"), 400);
    try {
      const channel = await registerWatch(user.id, webhookUrl);
      return c.json(channel);
    } catch (err) {
      return handleError(c, err);
    }
  });

  app.post("/integrations/google-calendar/notifications", async (c) => {
    const channelId = c.req.header("x-goog-channel-id");
    if (channelId) {
      const userId = await getChannelUser(channelId).catch(() => null);
      if (userId) {
        await enqueue({
          type: "calendar.sync",
          userId,
          idempotencyKey: `cal:push:${userId}:${Math.floor(Date.now() / 60_000)}`,
        }).catch(() => undefined);
      }
    }
    // Respond quickly so Google doesn't retry; the body is ignored.
    return c.json({ ok: true });
  });

  app.get("/integrations", (c) =>
    c.json({
      mode: opts.mode ?? "sample",
      ...(opts.integrations ?? {
        llm: { configured: false, provider: null },
        hubspot: { configured: false },
        gmail: { configured: false },
        stripe: { configured: false },
        live: false,
      }),
    }),
  );

  app.onError((err, c) => handleError(c, err));

  return app;
}
