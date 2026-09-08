# Retrieval Policy (v4)

The [`DeterministicToolPlanner`](../packages/core/src/agent/planner.ts) decides
which read-only sources to fetch. It is a **bounded** planner — it retrieves a
small authoritative baseline plus signal-triggered sources, never *retrieve-all*.

## Baseline (always retrieved)

| Tool | Source | Purpose |
|---|---|---|
| `get_open_deal` | hubspot | deal stage vs. authoritative state |
| `get_open_tasks` | tasks | duplicate / follow-up detection |

These two reads are the minimum needed to reconcile any interaction's
commitments against the CRM, and are what lift required-retrieval recall to
`≥ 0.90` without fetching contacts/notes/email/commercial indiscriminately.

## Signal-triggered (optional)

| Semantic trigger | Tool | Source |
|---|---|---|
| commercial signal (intent / claim / trial) | `get_commercial_state` | commercial |
| fact claim (`claims_subscribed`) | `get_outbound_communication` | gmail |
| unresolved person reference | `get_contacts` | hubspot |
| task candidate | `check_existing_action` | tasks |
| `metadata.threadId` | `get_email_thread` | gmail |

## Required vs. optional vs. irrelevant

- **Required**: the authoritative source needed to resolve the semantic signal
  (deal, tasks, plus commercial/Gmail where a claim is made).
- **Optional**: identity/thread resolution that only runs on an unresolved
  reference.
- **Irrelevant**: contacts/notes/Drafts are never fetched unless a specific
  signal requires them — this is what distinguishes the bounded planner from
  retrieve-all.

## Result

With these rules, the official 12-case harness reached **required-retrieval
recall 0.972** (target `≥ 0.90`), with zero duplicate calls and one expected
failure only where a required source is intentionally unavailable (case-12).