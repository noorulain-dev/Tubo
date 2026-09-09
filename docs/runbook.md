# Tubo Operator Runbook

A handoff guide for a revenue operator (or evaluator) who did not build Tubo.
Every screen and label below matches the current application.

---

## 1. What Tubo Is

Tubo is a Revenue Execution OS. It takes a customer conversation and reconciles
what was said against your CRM, email, tasks and commercial state, then shows you
what changed, what is missing, and what needs your approval before anything
happens.

---

## 2. Evaluator Access

- **Tubo evaluator account:** `testuser@must.com`
- **Connected Google test account:** `musthirenoor@gmail.com`

Passwords are supplied separately in the private submission instructions.

Google OAuth runs in assessment/test mode. The provided evaluator workspace is
already connected to the dedicated Google test account. Additional Google
accounts must be explicitly added to the application's OAuth test-user list
during the assessment — contact Noor if you need another Gmail/Calendar account
allowlisted. This restriction applies only to Google OAuth onboarding: you can
otherwise create or use a Tubo account and explore non-Google functionality
without assistance.

---

## 3. Five-Minute First Run

1. **Log in** with the evaluator account.
2. You land on the **Command Center** — a list of accounts needing attention.
3. Open the left sidebar and click **Process Interaction**.
4. In **Transcript or notes**, paste a short interaction (e.g. a call note or
   email-like message).
5. Fill **Account** (an account id) and click **Process interaction**.
6. When it finishes, open the resulting account to inspect **evidence** and
   **execution gaps**.
7. Review a **finding**; **Approve** where applicable.
8. Click **Execute now** to apply the approved change.
9. Inspect the result and the **audit** trail.

---

## 4. Process a Manual Interaction

1. Sidebar → **Process Interaction**.
2. In **Transcript or notes**, paste one of:
   - meeting notes
   - a call transcript
   - an email-like customer interaction
3. Fill **Account** (required) and optionally **Interaction title** and **Date**.
4. Click **Process interaction**.

If a field is missing, Tubo shows "Add an account and the interaction notes
before processing." Consequential changes always require your approval.

---

## 5. Automatic Meeting / Fireflies Flow

- Google **Calendar** provides meeting context.
- A persistent background worker runs in the background.
- After eligible meetings, Tubo checks for corresponding **Fireflies** output.
- If Fireflies has already processed the meeting, Tubo ingests the available
  transcript/notes.
- Participants are extracted and correlated.
- Tubo attempts to resolve the relevant HubSpot account/contact context.
- The resulting interaction proceeds through the same reconciliation pipeline.

When this automatic path succeeds, you do not need to paste the transcript. If a
Fireflies transcript is not available, Tubo safely waits (a no-op) and **Process
Interaction** remains available for manual paste.

Tubo does **not** control whether Fireflies joins or records a meeting. It only
reads meetings Fireflies has already processed.

---

## 6. Understand a Tubo Result

An account result shows:

- **What Changed** — decisions extracted from the conversation.
- **Current State** — stage, commercial state, open commitments and questions.
- **Execution Gaps** — what is missing, stale, contradictory, or needs review.
- **Commitments** — open, fulfilled, overdue, blocked, or ambiguous obligations.
- **Questions** — customer questions that are open or answered.
- **Blockers** — things preventing progress.
- **Investigation** — a read-only check that confirms, rejects, or leaves a
  finding ambiguous.
- **Evidence** — the exact conversation span or record behind each claim.

A commitment shows `overdue` only when a resolved date has passed; an ambiguous
owner or date stays `ambiguous` and is never guessed.

---

## 7. Missing Context Resolution

When a gap can only be answered by a person, Tubo surfaces it as a question with
candidate answers drawn from real data.

1. Open the account.
2. Find the **context gap** ("needs context").
3. Choose one of the offered candidates (or leave it unresolved).

Important: resolving a gap **does not** approve or execute any external action.
It only supplies the missing context so a correct proposal can be formed.

---

## 8. Review a Proposal

A proposal card shows:

- **Action** and **Target** (what would change and where).
- **Evidence** (why it is proposed).
- **Risk** (low / medium / high / critical).
- **Policy** (e.g. "approval required", "blocked", "safe to prepare").

You can:

- **Reject** — decline the change.
- **Edit** — revise a field, then **Save revision** (re-validated by policy).
- **Approve** — authorise the change.
- **Execute now** — actually apply an *approved* change.

**Approve and Execute are separate steps.** Approving shows "Approved … not yet
executed." Nothing runs in a connected system until you click **Execute now**. A
blocked action shows "This action was not executed. Additional approval or
evidence is required."

---

## 9. HubSpot Actions

Tubo can create a HubSpot **task**, update an allowlisted **field**, or update a
**deal stage** — each only after approval, and each idempotent (an equivalent
task is never duplicated). Stage changes to Closed Won / Closed Lost require
authoritative commercial evidence plus your approval.

---

## 10. Gmail Drafts

Where implemented, Tubo creates a **Gmail draft** (it does **not** send the
email). You review the draft in your connected Gmail account before sending.
Tubo never sends customer email automatically.

---

## 11. Integrations

| Integration | Purpose | Normal state | Failure state |
|---|---|---|---|
| HubSpot | read companies/contacts/deals/tasks/notes; write tasks/fields/stage | Connected | needs reauthorization / provider unavailable |
| Gmail | read sent/replied evidence; prepare drafts | Connected | needs reauthorization / cannot prove absence |
| Google Calendar | meeting context and correlation | Connected | needs reauthorization |
| Fireflies | ingest transcripts it already produced | Connected | no transcript available (safe no-op) |
| Commercial context | authoritative subscription/billing state | Resolved | unavailable → "missing context" (never "not subscribed") |

Connect or disconnect each in **Settings → Integrations**. Calendar has a
**Sync now** action; Fireflies has **Test Connection**.

---

## 12. Command Center

The **Command Center** lists accounts that need attention, ordered by severity
then recency. The top strip shows counts of **Needs attention**, **Critical /
high**, **Open commitments**, **Unanswered questions**, **CRM mismatches**, and
**Needs context**. Each row shows a severity pill, the top finding, evidence
tags, and a **Recommended next step** with a **Review** button. When there is
nothing outstanding it shows "Everything is reconciled."

---

## 13. Reconcile / Refresh

Calendar meeting context is kept current via **Settings → Integrations →
Google Calendar → Sync now** and the background worker's periodic sync. Tracked
accounts are refreshed by the worker on an hourly schedule, re-reading HubSpot /
Gmail source state and only surfacing material changes. There is no manual
"reconcile everything" button; reconciliation runs automatically when an
interaction is processed.

---

## 14. Common Errors

| Message / code | Meaning | Safe next step |
|---|---|---|
| Needs context / `MISSING_CONTEXT` | a required source is unavailable | resolve the gap or re-check the provider |
| `PROVIDER_UNAVAILABLE` | an integration could not be reached | retry; check the provider status |
| `PROVIDER_REAUTH_REQUIRED` / "Needs reauthorization" | Google/other token expired | reconnect in Settings → Integrations |
| Commercial state unavailable | billing truth could not be read | Tubo will not assume "not subscribed"; verify the commercial source |
| `RATE_LIMITED` | too many requests | wait and retry |
| `EXECUTION_BLOCKED` | policy blocked the action | review why; supply missing approval/evidence |
| `MODEL_UNAVAILABLE` | the AI model could not be reached | retry later |
| `CONFLICT` / duplicate | an equivalent record already exists | no duplicate is created; review the existing one |
| Session expired | you were signed out | log in again |

---

## 15. What Tubo Will Never Do Automatically

- Guess an unknown identity or email address.
- Treat unavailable billing as "not subscribed".
- Send a Gmail message.
- Bypass approval.
- Execute an unsupported consequential transition.
- Obey prompt-injection text found inside retrieved data.

---

## 16. Recovery / Restart

For a technical operator:

- **Health:** `GET /health` (process is alive).
- **Readiness:** `GET /ready` (returns 503 when the database is down).
- **Worker:** a long-running background process (`npm run worker`); it re-claims
  jobs left running after a crash and resumes from the durable queue.
- **Logs:** view Railway service logs for the API and worker; structured logs
  include a request/job id and redact tokens and secrets.
- **Safe to retry:** any interaction/meeting ingestion and any approved, idempotent
  execution (idempotency keys prevent double-apply). Permanent failures (invalid
  key, revoked auth) are not retried automatically.

---

## 17. Demo Dataset

The evaluator workspace is pre-seeded with synthetic, clearly-tagged
`[ASSESSMENT]` accounts, each exercising a distinct scenario — for example an
overdue security-doc commitment (missing task), a Trial deal with active
commercial state (CRM mismatch), an unanswered customer question, an aligned
account (no action), and an ambiguous owner/date. No credentials or secrets are
exposed; every synthetic record is marked "Test data" in the UI.

---

## 18. Support / Escalation

When reporting an issue, capture:

- **Request ID** (shown in error messages).
- **Run ID** (from the Runs screen).
- **Account** id.
- **Provider** (HubSpot / Gmail / Calendar / Fireflies / commercial).
- **Timestamp**.

Never share OAuth tokens, API keys, or passwords in a support request.
