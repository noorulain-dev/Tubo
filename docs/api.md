# Revenue Execution OS — HTTP API

The backend API is consumed by the frontend. The backend is the single source of
truth; the frontend cannot override risk/policy state and never receives backend
credentials.

## Base

`POST /interactions` submits/processes an interaction and runs the full
pipeline (semantic interpreter → reasoning agent → reconciliation → policy →
proposals). All other endpoints read or act on the resulting run.

## Endpoints

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/interactions` | Submit/process an interaction. |
| `GET` | `/runs` | History (list of runs). |
| `GET` | `/runs/:runId` | Full processed run. |
| `GET` | `/runs/:runId/semantic` | Semantic state + validity. |
| `GET` | `/runs/:runId/reconciliation` | Findings + execution gaps. |
| `GET` | `/runs/:runId/proposals` | Proposed actions. |
| `GET` | `/runs/:runId/audit` | Human-readable operational audit. |
| `PATCH` | `/proposals/:proposalId` | Edit a proposal (re-evaluates policy). |
| `POST` | `/proposals/:proposalId/approve` | Approve a proposal. |
| `POST` | `/proposals/:proposalId/reject` | Reject a proposal. |
| `POST` | `/proposals/:proposalId/execute` | Execute (backend re-verifies policy + approval). |
| `GET` | `/health` | Health check. |

## Request example

```json
POST /interactions
{
  "text": "I'll send the final proposal by Friday.",
  "kind": "note",
  "accountId": "co-001"
}
```

## Error envelope

All errors return a consistent shape:

```json
{ "error": { "code": "POLICY_BLOCK", "message": "...", "details": {} } }
```

Codes mirror the backend `ErrorCode` set (`VALIDATION`, `AUTHENTICATION`,
`PERMISSION`, `MISSING_CONTEXT`, `PROVIDER_ERROR`, `RATE_LIMIT`, `TIMEOUT`,
`DUPLICATE`, `POLICY_BLOCK`, `EXECUTION_ERROR`) plus `NOT_FOUND`.

## Authentication

- **Sample / demo mode**: no token required (auth disabled).
- **Integration mode**: set `AUTH_TOKEN`; mutating routes require
  `Authorization: Bearer <token>`. The frontend holds only this token (or a
  server-side proxy forwards it); it never receives backend credentials.

## Modes

- **Sample Mode**: synthetic commercial fixtures + in-memory CRM/email + a
  mock LLM — no network access. Used by the evaluation runner and demo.
- **Integration Mode**: real HubSpot/Gmail/Commercial providers + a real
  `LLMProvider` (DeepSeek adapter).

## Frontend types

The frontend should import request/response types from
[`apps/api/src/types.ts`](../apps/api/src/types.ts) (e.g., `RunView`,
`ProposalView`, `InteractionInput`, `ErrorEnvelope`). These are the single
contract surface shared with the API.
