# Frontend (Step 59)

The primary Revenue Execution OS frontend. DeepSeek owns the entire frontend —
no Lovable-generated code. Built with the existing design system/components
(no inconsistent duplicates).

## Navigation

Command Center · Accounts · Process Interaction · Runs · Evaluation · Settings.
Default landing after login is **Command Center**.

## Design principles

Professional internal SaaS (Linear/Stripe/Ramp/Notion quality, no copied
branding). Neutral surfaces, strong hierarchy, clean typography, compact tables,
clear evidence, subtle severity/status, responsive layout, accessible controls.
No neon AI gradients, robot icons, chatbot-first design, or massive generic cards.

## Screens

- **Command Center** — top metrics (accounts needing attention, critical/high
  findings, open commitments, unanswered questions, CRM/commercial mismatches,
  blocked) and a priority queue table (account, CRM stage, commercial state,
  priority/severity, top issue, commitments/questions, last event, pending).
- **Accounts** — flat list of accounts with persisted intelligence, linking to
  the account detail page.
- **Account detail** — header (company, deal, CRM stage, commercial state,
  severity, last event) plus sections: what changed since last review, CRM vs
  commercial state, open commitments, customer questions, blockers, execution
  findings, AI investigation, execution plan, recent activity. Includes
  "Mark reviewed".
- **AI Investigation** — shows the outcome (Confirmed/Rejected/Ambiguous/Missing
  context) and trace rows ("Checked HubSpot tasks · Reason: task deduplication ·
  Result: no matching open task found"). No chain-of-thought, no "AI thought…".
- **Execution Plan** — objective, evidence, actions, risk, policy status,
  approval requirement; per-action Approve/Reject plus Approve-eligible and
  Execute-approved controls. Clearly distinguishes Approved vs Executed.
- **Process Interaction** — manual entry (fallback/ad-hoc path); links to Account
  Intelligence after processing.
- **Runs** — Fireflies and Manual sources with Needs Review / Completed / Blocked
  / Failed filters.
- **Settings** — integrations (HubSpot incl. Commercial Context status, Gmail,
  Google Calendar, Fireflies). No separate commercial integration.

## Test data

Known `[ASSESSMENT]` records render a non-intrusive **"Test data"** badge
(`AccountRow.isAssessment`). There is no mode switch.

## States

Loading, empty, unresolved account, ambiguous, provider unavailable, needs
reauth, partial investigation, policy blocked, execution failure, and partial
execution are all represented explicitly (no silent fallbacks).

## Security

The frontend never assigns risk authority, invents evidence, calls HubSpot/Gmail
directly, overrides policy, approves on behalf of the server, or calculates source
authority. The server remains authoritative; the frontend is a typed client
([`api.ts`](../../apps/web/src/api.ts)) that only talks to the backend.

## Key files

- [`App.tsx`](../../apps/web/src/App.tsx) — routing/navigation.
- [`components.tsx`](../../apps/web/src/components.tsx) — shared primitives.
- [`screens/CommandCenterScreen.tsx`](../../apps/web/src/screens/CommandCenterScreen.tsx),
  [`screens/AccountsScreen.tsx`](../../apps/web/src/screens/AccountsScreen.tsx),
  [`screens/AccountScreen.tsx`](../../apps/web/src/screens/AccountScreen.tsx).
- [`types.ts`](../../apps/web/src/types.ts) and [`api.ts`](../../apps/web/src/api.ts).

## Tests

Component tests where useful, route/auth tests, and critical interaction flows
(process → review → approve/execute; command center → account → investigate →
plan). Run `typecheck` and the production build.
