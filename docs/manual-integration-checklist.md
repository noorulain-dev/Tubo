# Manual Integration Checklist

Actionable to-dos. No code changes required for this doc. **Sample Mode works with zero config; Live Mode is not wired yet** — the items below marked "not yet read" are for later steps.

## 1. Get Sample Mode running locally

- [ ] `npm install`
- [ ] Start backend: `npm run dev --workspace @revexec/api` → `http://localhost:3000`
- [ ] Start frontend: `npm run dev --workspace @revexec/web` → `http://localhost:5173`
- [ ] Verify `GET /health` returns `{"status":"ok","mode":"sample"}`

## 2. Set environment variables (Sample vs Live)

- [ ] `PORT=3000` — optional
- [ ] `AUTH_TOKEN=` — optional (enables bearer auth on mutating routes)
- [ ] `VITE_API_URL=http://localhost:3000` — optional (frontend backend base URL)
- [ ] `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL=deepseek-chat`, `DEEPSEEK_BASE_URL=https://api.deepseek.com` — **Live Mode, not yet read by code**
- [ ] `DATABASE_URL=` — **Live Mode, not yet read by code**
- [ ] `HUBSPOT_ACCESS_TOKEN`, `GMAIL_*`, `GOOGLE_*` — **desired for Live Mode, not referenced anywhere yet**

## 3. LLM

- [ ] Obtain a DeepSeek API key; supported model is `deepseek-chat` (base `https://api.deepseek.com`).
- [ ] Note: there is **no DeepSeek adapter implemented yet** — only the `LLMProvider` interface + a keyword stand-in.

## 4. HubSpot

- [ ] Create a HubSpot **private app** (this is the current model — a single Bearer access token, not OAuth/service key).
- [ ] Grant scopes: `crm.objects.companies.read`, `crm.objects.contacts.read`, `crm.objects.deals.read`, `crm.objects.deals.write`, `crm.objects.tasks.read`, `crm.objects.tasks.write`, `crm.objects.notes.read`, `crm.objects.notes.write`.
- [ ] Copy the private-app access token (the code would use it as `Authorization: Bearer <token>`; a `HUBSPOT_ACCESS_TOKEN` read does **not** exist yet).

## 5. Gmail

- [ ] Enable the Gmail API and create an OAuth 2.0 web client in Google Cloud.
- [ ] Grant scopes: `https://www.googleapis.com/auth/gmail.readonly` and `https://www.googleapis.com/auth/gmail.compose` (draft-only in code).
- [ ] Obtain client-id/secret + a refresh token.
- [ ] Note: **no OAuth callback route exists** — you must decide the URL the (not-yet-written) route will use.

## 6. Database

- [ ] Provision PostgreSQL and note its `DATABASE_URL`.
- [ ] Note: there is **no migration or seed runner** — `db/migrations/0001_initial.sql` is dormant.

## 7. Manually test the API (Sample Mode)

- [ ] `POST /interactions` with `{"text":"Fjord has subscribed and is now paying.","kind":"note","accountId":"demo_stale"}`
- [ ] `GET /runs` · `GET /runs/:runId` · `GET /runs/:runId/semantic` · `/reconciliation` · `/proposals` · `/audit`
- [ ] `POST /proposals/:id/approve` then `POST /proposals/:id/execute`
- [ ] `PATCH /proposals/:id` (edit → confirm a server-side revision)
- [ ] `POST /proposals/:id/reject`
- [ ] `POST /admin/reset`
- [ ] `GET /health`

Seeded accounts to try: `demo_missing`, `demo_aligned`, `demo_stale`, `demo_closed_lost`, `demo_ambiguous`, `demo_unavailable`.

## 8. Manually test the UI flows

- [ ] Process → Analyze → Review (summary, What Changed, Context Gathered, Revenue State, Gaps, Needs Review).
- [ ] Approve → Execute a proposal → confirm Execution Result updates.
- [ ] Edit a proposal → confirm the original AI proposal is preserved + a revision is recorded.
- [ ] Run history table + Audit drawer + Evaluation + Settings.

## 9. Confirm the gaps for Live Mode

- [ ] HubSpot/Gmail provider classes exist but are only tested with mocked `fetch` — **not wired into the server**.
- [ ] No token persistence exists (in-memory only); no refresh-token handling.
- [ ] `loadConfig()` is defined but **never called** by the server entry point.
- [ ] No live integration smoke test exists (`npm test` and `npm run eval` are fixture/mock-based).

## BLOCKERS BEFORE INTELLIGENCE EXPANSION

Manual actions only (nothing here is automated):

- [ ] Obtain a DeepSeek API key.
- [ ] Create a HubSpot private app + access token.
- [ ] Create a Google OAuth 2.0 client and obtain id/secret + refresh token; decide the callback URL.
- [ ] Provision PostgreSQL and note `DATABASE_URL`.
- [ ] Decide the target model/base URL and scopes for the above.

> After obtaining these credentials, wiring them into code (LLM adapter, `loadConfig()`, provider construction, OAuth exchange, DB migration/connection) is a later code step — deliberately out of scope here.
