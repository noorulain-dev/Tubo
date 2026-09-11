import type {
  AccountDetail,
  AccountRow,
  ContextChoice,
  ContextGap,
  ContextGapsView,
  ContextResolutionRecord,

  ErrorEnvelope,
  ExecutionPlan,
  Finding,
  InteractionInput,
  EvaluationSummary,
  InvestigationResult,
  ProposalView,
  RunView,
} from "./types";

// The backend is the single source of truth. The frontend only talks to it via
// this typed client and never contacts HubSpot/Gmail directly.
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

const TOKEN_KEY = "revexec.token";

export function getToken(): string | undefined {
  return localStorage.getItem(TOKEN_KEY) ?? undefined;
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

let onUnauthorized: (() => void) | null = null;

/** Register a handler invoked when the session expires (401/403) on any call. */
export function setOnUnauthorized(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers as Record<string, string> | undefined),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      clearToken();
      onUnauthorized?.();
    }
    const body = (await res.json().catch(() => null)) as ErrorEnvelope | null;
    throw new ApiError(body?.error?.code ?? "HTTP_ERROR", body?.error?.message ?? `Request failed (${res.status})`, res.status);
  }
  return (await res.json()) as T;
}

export class ApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

export interface AuditView {
  runId: string;
  mode: string;
  status: string;
  steps: string[];
}

export interface AuthUser {
  id: string;
  email: string;
  /** True for a dedicated evaluator/demo account (external execution disabled). */
  evaluator?: boolean;
}

export interface AuthResult {
  token: string;
  user: AuthUser;
}

export interface HealthView {
  status: string;
  mode: string;
  liveAvailable: boolean;
}

export interface IntegrationsView {
  mode: string;
  llm: { configured: boolean; provider: "openai" | "deepseek" | null };
  hubspot: { configured: boolean };
  gmail: { configured: boolean };
  stripe: { configured: boolean };
  live: boolean;
}

export type ConnectionProvider = "stripe" | "hubspot" | "gmail" | "google-calendar" | "fireflies";

export interface ConnectionStatus {
  stripe: { connected: boolean; needsReauth: boolean };
  hubspot: { connected: boolean; needsReauth: boolean };
  gmail: { connected: boolean; needsReauth: boolean };
  calendar: { connected: boolean; needsReauth: boolean };
  fireflies: { connected: boolean; needsReauth: boolean };
}

export interface CalendarEventItem {
  id: string;
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  allDay: boolean;
  meetingUrl: string | null;
  organizerEmail: string | null;
  attendeeCount: number;
  status: string;
}

export interface CalendarEventView {
  events: CalendarEventItem[];
  lastSyncAt: string | null;
}

export const api = {
  async login(email: string, password: string): Promise<AuthResult> {
    const result = await request<AuthResult>("/auth/login", { method: "POST", body: JSON.stringify({ email, password }) });
    setToken(result.token);
    return result;
  },
  async register(email: string, password: string): Promise<AuthResult> {
    const result = await request<AuthResult>("/auth/register", { method: "POST", body: JSON.stringify({ email, password }) });
    setToken(result.token);
    return result;
  },
  async logout(): Promise<void> {
    try {
      await request<{ ok: boolean }>("/auth/logout", { method: "POST" });
    } finally {
      clearToken();
    }
  },
  me(): Promise<{ user: AuthUser }> {
    return request<{ user: AuthUser }>("/auth/me", { method: "GET" });
  },
  getHealth(): Promise<HealthView> {
    return request<HealthView>("/health", { method: "GET" });
  },
  getIntegrations(): Promise<IntegrationsView> {
    return request<IntegrationsView>("/integrations", { method: "GET" });
  },
  getGmailOAuthUrl(): Promise<{ url: string }> {
    const returnTo = encodeURIComponent(window.location.origin);
    return request<{ url: string }>(`/gmail/oauth/url?returnTo=${returnTo}`, { method: "GET" });
  },
  getCalendarOAuthUrl(): Promise<{ url: string }> {
    const returnTo = encodeURIComponent(window.location.origin);
    return request<{ url: string }>(`/integrations/google-calendar/oauth/url?returnTo=${returnTo}`, { method: "GET" });
  },
  syncCalendar(): Promise<{ synced: number; window: { start: string; end: string } }> {
    return request<{ synced: number; window: { start: string; end: string } }>(`/integrations/google-calendar/sync`, { method: "POST" });
  },
  getCalendarEvents(start: string, end: string): Promise<CalendarEventView> {
    return request<CalendarEventView>(`/integrations/google-calendar/events?start=${encodeURIComponent(start)}&end=${encodeURIComponent(end)}`);
  },
  connectFireflies(apiKey: string): Promise<ConnectionStatus> {
    return request<ConnectionStatus>("/connections/fireflies", { method: "POST", body: JSON.stringify({ apiKey }) });
  },
  testFireflies(): Promise<{
    ok: boolean;
    message?: string;
    meetingCount?: number;
    recent?: { title: string | null; startedAt: string | null }[];
  }> {
    return request<{
      ok: boolean;
      message?: string;
      meetingCount?: number;
      recent?: { title: string | null; startedAt: string | null }[];
    }>("/connections/fireflies/test", { method: "POST" });
  },
  getConnections(): Promise<ConnectionStatus> {
    return request<ConnectionStatus>("/connections", { method: "GET" });
  },
  connectStripe(secretKey: string): Promise<ConnectionStatus> {
    return request<ConnectionStatus>("/connections/stripe", { method: "POST", body: JSON.stringify({ secretKey }) });
  },
  connectHubspot(accessToken: string): Promise<ConnectionStatus> {
    return request<ConnectionStatus>("/connections/hubspot", { method: "POST", body: JSON.stringify({ accessToken }) });
  },
  disconnectConnection(provider: ConnectionProvider): Promise<ConnectionStatus> {
    return request<ConnectionStatus>(`/connections/${provider}`, { method: "DELETE" });
  },
  processInteraction(input: InteractionInput): Promise<RunView> {
    return request<RunView>("/interactions", { method: "POST", body: JSON.stringify(input) });
  },
  listRuns(): Promise<RunView[]> {
    return request<RunView[]>("/runs");
  },
  getRun(id: string): Promise<RunView> {
    return request<RunView>(`/runs/${id}`);
  },
  getAudit(id: string): Promise<AuditView> {
    return request<AuditView>(`/runs/${id}/audit`);
  },
  approveProposal(id: string): Promise<ProposalView> {
    return request<ProposalView>(`/proposals/${id}/approve`, { method: "POST" });
  },
  rejectProposal(id: string): Promise<ProposalView> {
    return request<ProposalView>(`/proposals/${id}/reject`, { method: "POST" });
  },
  editProposal(id: string, payload: Record<string, unknown>): Promise<ProposalView> {
    return request<ProposalView>(`/proposals/${id}`, { method: "PATCH", body: JSON.stringify({ payload }) });
  },
  executeProposal(id: string): Promise<ProposalView> {
    return request<ProposalView>(`/proposals/${id}/execute`, { method: "POST" });
  },
  getCommandCenter(limit = 50, offset = 0): Promise<{ rows: AccountRow[]; total: number; limit: number; offset: number }> {
    return request<{ rows: AccountRow[]; total: number; limit: number; offset: number }>(`/command-center?limit=${limit}&offset=${offset}`);
  },
  getAccountDetail(accountId: string): Promise<AccountDetail> {
    return request<AccountDetail>(`/command-center/accounts/${encodeURIComponent(accountId)}`);
  },
  markReviewed(accountId: string): Promise<{ reviewedAt: string; version: number }> {
    return request<{ reviewedAt: string; version: number }>(`/command-center/accounts/${encodeURIComponent(accountId)}/reviewed`, { method: "POST" });
  },
  listFindings(accountId: string): Promise<{ findings: Finding[] }> {
    return request<{ findings: Finding[] }>(`/accounts/${encodeURIComponent(accountId)}/findings`);
  },
  /** Questions a human can legitimately answer on this account right now. */
  getContextGaps(accountId: string): Promise<ContextGapsView> {
    return request<ContextGapsView>(`/accounts/${encodeURIComponent(accountId)}/context-gaps`);
  },
  /**
   * Submit one human answer. The backend re-derives the gap and rejects any
   * value that is not one of the candidates it found in real data.
   */
  resolveContextGap(
    accountId: string,
    gapId: string,
    choice: ContextChoice,
    links: { runId?: string | null; findingId?: string | null } = {},
  ): Promise<{ ok: true; resolution: ContextResolutionRecord; gaps: ContextGap[]; reconciled: boolean }> {
    return request(`/accounts/${encodeURIComponent(accountId)}/context-resolutions`, {
      method: "POST",
      body: JSON.stringify({ gapId, choice, ...links }),
    });
  },
  listContextResolutions(accountId: string): Promise<{ resolutions: ContextResolutionRecord[] }> {
    return request<{ resolutions: ContextResolutionRecord[] }>(`/accounts/${encodeURIComponent(accountId)}/context-resolutions`);
  },


  refreshAccount(accountId: string): Promise<{ enqueued: boolean; jobId: string }> {
    return request<{ enqueued: boolean; jobId: string }>(`/accounts/${encodeURIComponent(accountId)}/refresh`, { method: "POST" });
  },
  investigateFinding(findingId: string): Promise<InvestigationResult> {
    return request<InvestigationResult>(`/findings/${findingId}/investigate`, { method: "POST" });
  },
  listInvestigations(findingId: string): Promise<{ investigations: InvestigationResult[] }> {
    return request<{ investigations: InvestigationResult[] }>(`/findings/${findingId}/investigations`);
  },
  listPlans(accountId: string): Promise<{ plans: ExecutionPlan[] }> {
    return request<{ plans: ExecutionPlan[] }>(`/execution-plans?accountId=${encodeURIComponent(accountId)}`);
  },
  applyPlanDecision(planId: string, actionId: string, decision: "approve" | "reject" | "edit", payload?: Record<string, unknown>): Promise<ExecutionPlan> {
    return request<ExecutionPlan>(`/execution-plans/${planId}/actions/${actionId}/decision`, { method: "POST", body: JSON.stringify({ decision, payload }) });
  },
  executePlanAction(planId: string, actionId: string, companyId?: string | null): Promise<ExecutionPlan> {
    return request<ExecutionPlan>(`/execution-plans/${planId}/actions/${actionId}/execute`, { method: "POST", body: JSON.stringify({ companyId }) });
  },
  listHubspotCompanies(): Promise<{ companies: { id: string; name: string }[] }> {
    return request<{ companies: { id: string; name: string }[] }>("/hubspot/companies");
  },
  getEvaluationSummary(): Promise<EvaluationSummary> {
    return request<EvaluationSummary>("/evaluation/summary");
  },
  approveAllPlan(planId: string): Promise<ExecutionPlan> {
    return request<ExecutionPlan>(`/execution-plans/${planId}/approve-all`, { method: "POST" });
  },
};
