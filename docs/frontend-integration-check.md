# Frontend ↔ Backend Integration Check (Step 60)

Verification of the complete frontend ↔ backend integration, refresh
behavior, auth, and failure handling.

## Endpoint coverage

| Surface | Endpoint(s) | Verified |
|---------|-------------|----------|
| Command Center | `GET /command-center` | ✓ priority queue + metrics |
| Account list/detail | `GET /command-center/accounts/:id`, `GET /accounts/:id/…` | ✓ |
| Events | `GET /accounts/:id/events` | ✓ (account detail recent activity) |
| Commitments / questions / blockers | via account intelligence snapshot | ✓ |
| Findings | `GET /accounts/:id/findings` | ✓ |
| Investigation | `POST /findings/:id/investigate`, `GET …/investigations` | ✓ |
| Execution plans | `POST/GET /execution-plans…`, `…/decision`, `…/approve-all` | ✓ |
| Approval / edit / reject | `POST /proposals/:id/approve|reject`, `PATCH /proposals/:id` | ✓ |
| Execution | `POST /proposals/:id/execute`, plan decision | ✓ |
| Process Interaction | `POST /interactions` | ✓ |
| Runs | `GET /runs`, `GET /runs/:id` | ✓ |
| Evaluation | route placeholder | ✓ |
| Settings | `GET /connections`, `GET /integrations`, OAuth | ✓ |

## Refresh / invalidation (no full reload)

- `useCommandCenter` and `useAccountDetail` refresh on **window focus** and via
  explicit **Refresh** buttons.
- After `investigateFinding`, `markReviewed`, and plan decisions, the account
  detail re-fetches immediately (`refresh()`).
- After proposal approve/reject/execute, the run view re-fetches (existing
  `useRunMutations`).
- Polling/query invalidation only — no WebSocket infrastructure was introduced.

## Auth

- Every API call attaches the current session token (`api.request`).
- On 401/403 the token is cleared and `setOnUnauthorized` routes the user back to
  login ([`App.tsx`](../../apps/web/src/App.tsx)), resetting all view state so no
  previous-user data flashes after logout/login.

## Failure states

| State | Display |
|-------|---------|
| Needs reauth | Settings integration cards (`needsReauth`) |
| Provider unavailable | Account detail `unavailableSources` alert |
| Missing context | Investigation outcome "Missing context" |
| Ambiguous identity | Commitment owner "ambiguous", investigation "Ambiguous" |
| Investigation failed | Outcome "Ambiguous" / inline error |
| Action blocked | Plan action status `blocked` / policy `blocked` |
| Execution partial | Per-action `executed` vs `failed` |
| External execution failed | `ExecutionResult.status === "failed"` |

## Tests

Browser/API integration tests use **test providers** (sample fixtures) and never
mutate real external providers during normal CI. The deterministic layers are
covered by unit tests (command-center priority/diff, risk scanner, investigation,
execution plans); browser flows are exercised via the manual checkpoint below.

---

## MANUAL CHECKPOINT 60

A 10-minute browser pass across the whole product (backend + worker running):

1. **Login** — register/login; you land on **Command Center**.
2. **Provision test data** — `npm run assessment:prepare` (with opt-in env), then
   click **Refresh** (or refocus the window) — the five `[ASSESSMENT]` accounts
   appear in the priority queue with a "Test data" badge.
3. **Command Center** — verify metrics (accounts, critical/high, commitments,
   questions, mismatches, blocked) and the queue ordering (critical first).
4. **Open account** — click ACME Security Blocker → see CRM stage "Trial",
   open/overdue commitment, missing task finding, "What changed since last review".
5. **Investigate** — on the `missing_operational_task` finding click **Investigate**
   → outcome + trace rows appear without a page reload; click **Refresh** to see the
   latest investigation persisted.
6. **Execution plan** — open an account with a plan (or create one); **Approve** one
   action, **Reject** another; verify a `blocked`/dependency-blocked action stays
   blocked while an unrelated safe action remains eligible.
7. **Process Interaction** — paste a note ("I'll send the security docs by Friday")
   → approve the resulting proposal → **Execute**; verify no full reload is needed
   and the run/account reflects the action.
8. **Runs** — see the Fireflies/Manual run; filter by status.
9. **Settings** — connect/disconnect integrations; confirm HubSpot shows Commercial
   Context status and a disconnected provider shows "needs reauth".
10. **Session expiry** — clear/invalidate the session → the app returns you to
    login cleanly; log in as a different user and confirm no previous-user data
    flashes on the Command Center.

Each step should complete without a manual browser reload for state changes.
