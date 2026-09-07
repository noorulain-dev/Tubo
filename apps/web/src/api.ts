import type { ErrorEnvelope, InteractionInput, ProposalView, RunView } from "./types";

// The backend is the single source of truth. The frontend only talks to it via
// this typed client and never contacts HubSpot/Gmail directly.
const BASE_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? "http://localhost:3000";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = import.meta.env.VITE_AUTH_TOKEN as string | undefined;
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

export interface HealthView {
  status: string;
  mode: string;
  liveAvailable: boolean;
}

export const api = {
  getHealth(): Promise<HealthView> {
    return request<HealthView>("/health", { method: "GET" });
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
