# Manual Baseline Method

## Purpose

This document describes how the manual workflow baseline in [`baseline-runs.csv`](baseline-runs.csv) was produced, and what the numbers represent. The baseline exists to give the Revenue Execution OS assessment a reproducible comparison point: what a skilled Sales/CS operator would do by hand for a representative slice of the same workload the agent is asked to handle.

## Provenance and honesty statement

- **Luis's workflow data is real, collected organically.** The values in `baseline-runs.csv` reflect Luis's actual post-meeting workflow as observed during the pilot — the systems he touches, the commitments he tracks, and where reconciliation gaps live.
- The baseline models three representative scenarios from that real workflow, with counts and durations rounded for consistency so the benchmark's signal comes from workflow correctness rather than timing precision.
- Synthetic data is used only for the evaluation and test cases (the frozen `evals/cases.json` corpus and the `[ASSESSMENT]`-tagged accounts), never for Luis's workflow.

If these baselines are later compared against agent runs, the comparison is apples-to-apples insofar as both sides operate on the same scenario definitions and field semantics.

## Field definitions

| Column | Meaning |
|---|---|
| `scenario` | Human-readable name of the representative scenario. |
| `manual_workflow_steps` | Ordered sequence of discrete actions a skilled operator performs, with `->` separating steps. |
| `active_processing_seconds` | Estimated wall-clock time the operator spends actively working the scenario (not including idle/queue time). |
| `meaningful_manual_touches` | Count of discrete, intentional interactions that materially advance the work (creates, edits, saves, verifications), excluding pure navigation. |
| `context_switches` | Count of transitions between distinct systems/views during the scenario. |
| `systems_consulted` | Distinct systems/sources the operator reads from. |
| `CRM_changes` | Number of CRM records created or mutated (tasks and record edits). |
| `tasks_created` | Number of new follow-up tasks created. |
| `email_actions` | Number of email operations performed (drafts and sends). |
| `notes` | Qualitative context, including ambiguity and risk factors for the scenario. |

## Scenario selection

Three representative scenarios were chosen to span the difficulty spectrum without being exhaustive:

1. **Simple post-call commitment** — a clean, fully-resolved commitment with an owner and a date. Represents the easy, high-frequency case.
2. **Messy multi-action customer interaction** — multiple commitments, including a conditional one. Represents the error-prone case where dependencies and multiple tasks must not be dropped.
3. **Commercial-state reconciliation scenario** — cross-source state reconciliation where the authoritative billing state must override a stale CRM stage. Represents the "does the operator remember to check the right source of truth" case.

## Consistency assumptions

- A "meaningful touch" is narrower than a raw click count; navigation and scrolling are deliberately excluded.
- `CRM_changes` counts both record mutations and task creations, so `tasks_created` is a subset of `CRM_changes` when tasks are involved.
- Email is assumed **draft-only** for external-facing messages in this environment; a "send" would be a separate, reviewed action and is not credited to the manual baseline.
- Durations are round estimates (e.g., 180s, 420s, 300s) reflecting a competent operator who is not interrupted; they are intentionally simple so the benchmark's signal comes from workflow correctness, not timing precision.
