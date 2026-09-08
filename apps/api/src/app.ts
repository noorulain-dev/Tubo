import { randomUUID } from "node:crypto";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { FirefliesProvider, isAppError, type IntegrationStatus } from "./core.js";
import { bearerAuth } from "./auth.js";
import { loginUser, logout, registerUser, type AuthUser } from "./auth-service.js";
import { logger } from "./logger.js";
import { rateLimit } from "./rate-limit.js";
import { getPool, isDbConfigured } from "./db.js";
import { getConnectionsStatus, getFirefliesApiKey, removeConnection, setConnection, type ConnectionProvider } from "./connections.js";
import { buildGmailAuthorizationUrl, exchangeGmailAuthCode, GOOGLE_SCOPES } from "./gmail-oauth.js";
import { listCalendarEvents, syncCalendar } from "./calendar-sync.js";
import { getChannelUser, registerWatch } from "./calendar-watch.js";
import { enqueue } from "./jobs.js";
import { appendAccountEvent, getSnapshot, listAccountEvents, listAccounts } from "./account-intelligence.js";
import { Investigator, listInvestigations, saveInvestigation } from "./investigation.js";
import { getFinding, listFindings } from "./risk-scanner.js";
import { applyDecision, approveAllEligible, buildExecutionPlan, getPlan, listPlans, savePlan, type ExecutionPlan } from "./execution-plans.js";
import { getAccountDetail, listAccountRows, markReviewed } from "./command-center.js";
import type { RunService } from "./pipeline.js";
import { InteractionInputSchema, ProposalEditSchema, type ErrorEnvelope, type RunView } from "./types.js";

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

function handleError(c: Context, err: unknown): Response {
  const requestId = c.get("requestId") as string | undefined;
  if (isAppError(err)) {
    return c.json(errorEnvelope(err.code, err.message, err.details, requestId), err.status as ContentfulStatusCode);
  }
  // Never leak stack traces or internal messages in production.
  const production = process.env.NODE_ENV === "production";
  logger.error(
    { event: "error", requestId, error_code: "INTERNAL_ERROR", message: err instanceof Error ? err.message : String(err) },
    "unhandled request error",
  );
  return c.json(errorEnvelope("INTERNAL_ERROR", production ? "internal server error" : err instanceof Error ? err.message : "internal server error", undefined, requestId), 500);
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
    } catch {
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
      await appendAccountEvent({
        userId,
        accountId: input.accountId ?? null,
        eventType: "manual_interaction_processed",
        source: "manual",
        sourceReference: run.id,
        payload: {
          runId: run.id,
          status: run.status,
          proposals: run.proposals.map((p) => p.action.type),
          semantic: run.semantic,
          gaps: run.gaps.map((g) => ({ type: g.type, what: g.what, title: g.title, description: g.description })),
        },
        provenance: "manual",
        idempotencyKey: `interaction:${userId}:${run.id}`,
      }).catch(() => undefined);
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
    const policyContext = {
      commercialState: await readContext.commercial.getCommercialState(body.accountId).catch(() => null),
      openDeal: await readContext.crm.getOpenDeal(body.accountId).catch(() => null),
    };

    const plan = buildExecutionPlan({
      accountId: body.accountId,
      findingIds: body.findingIds ?? [],
      objective: body.objective,
      summary: body.summary,
      evidence: body.evidence,
      actions: body.actions.map((a) => ({ action: a.action as never, dependsOn: a.dependsOn })),
      policyContext,
    });
    await savePlan(user.id, plan);
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
    const svc = await findProposalService(c, c.req.param("proposalId"));
    if (!svc) return c.json(errorEnvelope("NOT_FOUND", "proposal not found"), 404);
    try {
      const view = await svc.executeProposal(c.req.param("proposalId"), ownerId(c));
      if (view) {
        await appendAccountEvent({
          userId: ownerId(c),
          accountId: view.action.target ?? null,
          eventType: "external_action_executed",
          source: "executor",
          sourceReference: view.id,
          payload: { actionType: view.action.type, status: view.execution?.status },
          provenance: "executor",
          idempotencyKey: `exec:${ownerId(c)}:${view.id}`,
        }).catch(() => undefined);
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

  // Readiness: critical dependency (database) must be reachable to serve.
  app.get("/ready", async (c) => {
    let database = "ok";
    if (!isDbConfigured()) {
      database = "not_configured";
    } else {
      try {
        await getPool().query("SELECT 1");
      } catch {
        database = "down";
      }
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
    const events = await listCalendarEvents(user.id, new Date(start), new Date(end));
    return c.json({ events });
  });

  app.post("/integrations/google-calendar/watch", async (c) => {
    const user = currentUser(c);
    if (!user) return c.json(errorEnvelope("AUTHENTICATION", "unauthorized"), 401);
    const webhookUrl = process.env.CALENDAR_WEBHOOK_URL;
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
