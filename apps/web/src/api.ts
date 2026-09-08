import type { ErrorEnvelope, InteractionInput, ProposalView, RunView } from "./types";

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
};
