import { getPipelineService } from "../runs/pipeline-service.js";
import { appendAccountEvent, getSnapshot, listAccounts } from "./account-intelligence.js";
import { listFindings } from "./risk-scanner.js";
import {
  EMPTY_CANDIDATES,
  assertNoAuthorityOverride,
  detectContextGaps,
  isValidationError,
  resolutionEventPayload,
  validateResolution,
  type ContextCandidates,
  type ContextGap,
  type ResolutionChoice,
} from "./context-resolution.js";
import { listContextResolutions, recordContextResolution, type ContextResolutionRecord } from "./context-resolution-repository.js";

/**
 * Orchestration for human-in-the-loop context resolution.
 *
 * The rule that matters: a human may supply a MISSING FACT, never a DECISION.
 * After the fact is stored, the existing deterministic pipeline recomputes the
 * account (append event -> rebuild state -> rescan findings). Approval, policy
 * and execution gates are untouched, so resolving context can never cause a
 * write to a customer-facing system.
 */

export interface ResolveActor {
  id: string;
  name?: string | null;
  email?: string | null;
}

function personLabel(actor: ResolveActor): string {
  return (actor.name && actor.name.trim()) || actor.email || actor.id;
}

/**
 * Gather real candidate data. Every provider read is best-effort: a failure
 * degrades to "no candidates + source marked unavailable", never to a guess.
 */
export async function loadCandidates(userId: string, accountId: string, actor?: ResolveActor): Promise<ContextCandidates> {
  const candidates: ContextCandidates = {
    ...EMPTY_CANDIDATES,
    accounts: [],
    contacts: [],
    deals: [],
    people: [],
    unavailableSources: [],
  };

  if (actor) {
    candidates.people.push({ id: actor.id, name: personLabel(actor), role: "You — workspace member", origin: "workspace" });
  }

  // Other tracked accounts in this workspace (identity ambiguity candidates).
  try {
    const ids = await listAccounts(userId);
    const others = ids.filter((id) => id !== accountId).slice(0, 25);
    for (const id of others) {
      const snap = await getSnapshot(userId, id).catch(() => null);
      candidates.accounts.push({ accountId: id, name: snap?.identity?.name ?? null });
    }
  } catch {
    // No account index available — offer no account candidates rather than guessing.
  }

  const service = getPipelineService();
  if (!service) {
    candidates.unavailableSources.push("hubspot", "commercial");
    candidates.commercialChecked = true;
    candidates.commercialConfigured = false;
    return candidates;
  }

  const ctx = await service.resolveReadContext(userId).catch(() => null);
  if (!ctx) {
    candidates.unavailableSources.push("hubspot", "commercial");
    candidates.commercialChecked = true;
    return candidates;
  }

  try {
    const contacts = await ctx.crm.getContacts(accountId);
    candidates.contacts = contacts.map((c) => ({
      id: c.id,
      name: [c.firstName, c.lastName].filter(Boolean).join(" ").trim() || null,
      email: c.email ?? null,
      title: c.lifecycleStage ?? null,
    }));
  } catch {
    candidates.unavailableSources.push("hubspot");
  }

  try {
    const deal = await ctx.crm.getOpenDeal(accountId);
    if (deal) candidates.deals = [{ id: deal.id, name: deal.name, stage: deal.stage, amount: deal.amount ?? null }];
  } catch {
    if (!candidates.unavailableSources.includes("hubspot")) candidates.unavailableSources.push("hubspot");
  }

  // Commercial: we only check whether an authoritative source ANSWERS. Its value
  // is never human-editable, so we do not surface it as a candidate.
  candidates.commercialChecked = true;
  try {
    await ctx.commercial.getCommercialState(accountId);
    candidates.commercialConfigured = true;
  } catch {
    candidates.commercialConfigured = false;
    candidates.unavailableSources.push("commercial");
  }

  return candidates;
}

export interface ContextGapsView {
  accountId: string;
  gaps: ContextGap[];
  resolutions: ContextResolutionRecord[];
}

export async function getContextGaps(userId: string, accountId: string, actor?: ResolveActor): Promise<ContextGapsView> {
  const [snapshot, findings, candidates, resolutions] = await Promise.all([
    getSnapshot(userId, accountId),
    listFindings(userId, accountId).catch(() => []),
    loadCandidates(userId, accountId, actor),
    listContextResolutions(userId, accountId).catch(() => []),
  ]);

  const gaps = detectContextGaps({ accountId, snapshot, findings, candidates });
  return { accountId, gaps, resolutions };
}

export type SubmitResult =
  | { ok: true; resolution: ContextResolutionRecord; gaps: ContextGap[]; reconciled: boolean }
  | { ok: false; code: "NOT_FOUND" | "VALIDATION" | "GAP_NOT_RESOLVABLE"; message: string };

/**
 * Persist one human answer and re-run ONLY the affected reconciliation.
 *
 * `appendAccountEvent` rebuilds this single account's state and rescans its
 * findings. No unrelated account, run, or provider work is triggered, and no
 * proposal is approved or executed as a side effect.
 */
export async function submitContextResolution(
  userId: string,
  accountId: string,
  gapId: string,
  choice: ResolutionChoice,
  actor: ResolveActor,
  links: { runId?: string | null; findingId?: string | null } = {},
): Promise<SubmitResult> {
  const snapshot = await getSnapshot(userId, accountId);
  const findings = await listFindings(userId, accountId).catch(() => []);
  const candidates = await loadCandidates(userId, accountId, actor);

  // Re-derive gaps server-side: the client can never widen what is answerable.
  const gaps = detectContextGaps({ accountId, snapshot, findings, candidates });
  const gap = gaps.find((g) => g.gapId === gapId);
  if (!gap) return { ok: false, code: "NOT_FOUND", message: "That context gap no longer exists on this account." };

  const validated = validateResolution(gap, choice);
  if (isValidationError(validated)) return { ok: false, code: validated.code, message: validated.message };

  const payload = resolutionEventPayload(validated);
  // Defence in depth: a resolution payload may never carry authority fields.
  assertNoAuthorityOverride(payload);

  // Deadlines: "leave unresolved" on a deadline gap is recorded explicitly as
  // "no deadline", so the pipeline stops asking — without inventing a date.
  if (gap.type === "missing_deadline" && choice.kind === "unresolved") {
    (payload as Record<string, unknown>).provenanceTag = "human_supplied";
    (payload as Record<string, unknown>).commitmentUpdates = [{ commitmentId: gap.subject.id, dueDateWaived: true }];
  }

  let accountEventId: string | null = null;
  let reconciled = false;
  const changesState = Object.keys(payload).some((k) => k === "commitmentUpdates" || k === "identityUpdates");

  if (changesState) {
    const result = await appendAccountEvent({
      userId,
      accountId,
      eventType: "manual_correction",
      source: "system",
      payload: { ...payload, resolvedBy: personLabel(actor) },
      provenance: "human_supplied",
      idempotencyKey: `ctxres:${userId}:${accountId}:${gap.gapId}:${validated.selectedLabel}`,
    });
    accountEventId = result.eventId;
    reconciled = true;
  }

  const resolution = await recordContextResolution({
    userId,
    accountId,
    gapId: gap.gapId,
    gapType: gap.type,
    subjectKind: gap.subject.kind,
    subjectId: gap.subject.id,
    subjectLabel: gap.subject.label,
    question: gap.question,
    originalAmbiguity: gap.unverified,
    choiceKind: choice.kind,
    selectedLabel: validated.selectedLabel,
    selectedValue: validated.selectedValue,
    provenance: "human_supplied",
    resolvedBy: actor.id,
    resolvedByName: personLabel(actor),
    accountEventId,
    runId: links.runId ?? null,
    findingId: links.findingId ?? null,
  });

  // Return the recomputed gap list so the UI shows the post-reconciliation truth.
  const nextSnapshot = await getSnapshot(userId, accountId);
  const nextFindings = await listFindings(userId, accountId).catch(() => []);
  const nextGaps = detectContextGaps({ accountId, snapshot: nextSnapshot, findings: nextFindings, candidates });

  return { ok: true, resolution, gaps: nextGaps, reconciled };
}
