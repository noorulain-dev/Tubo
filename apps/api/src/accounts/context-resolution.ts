import type { AccountIntelligenceSnapshot, CommitmentState } from "./state-builder.js";
import type { Finding, Severity } from "./risk-scanner.js";

/**
 * STEP 72 — Missing / ambiguous context resolution (human-in-the-loop).
 *
 * Tubo already REFUSES to act when required context is missing or ambiguous.
 * This module turns that refusal into an answerable question without weakening
 * any existing safety rule.
 *
 * Invariants (enforced here, not in the UI):
 *  - Detection is deterministic and derived only from the persisted snapshot,
 *    the open findings, and real candidate data supplied by the caller.
 *  - A human may only choose among options that came from real data, pick a
 *    calendar date, or explicitly leave the gap unresolved. Free-text values
 *    are never accepted as facts (no invented emails, owners, or deal ids).
 *  - Authoritative commercial truth is NEVER human-assertable. When the
 *    commercial source is unconfigured/unavailable the gap is reported as
 *    not resolvable, with a configuration CTA instead of an input.
 *  - Resolving context never approves, executes, or unblocks anything. It only
 *    supplies the missing fact so the existing pipeline can recompute.
 */

export type ContextGapType =
  | "ambiguous_account"
  | "ambiguous_contact"
  | "missing_owner"
  | "missing_deadline"
  | "missing_deal"
  | "missing_commercial_authority"
  | "unavailable_source"
  | "incomplete_evidence";

export type ContextSubjectKind = "commitment" | "account" | "question" | "source";

/** Where a fact came from. Human input is never relabelled as source evidence. */
export type ContextProvenance = "ai_inferred" | "system_retrieved" | "human_supplied";

export interface ContextOption {
  /** Stable id the client sends back; the server re-derives and re-validates it. */
  optionId: string;
  label: string;
  detail?: string;
  /** Where this candidate came from — always real, never fabricated. */
  origin: "account_state" | "crm" | "workspace" | "conversation";
  /** The concrete value applied when selected. */
  value: Record<string, unknown>;
}

export interface ContextGap {
  gapId: string;
  accountId: string;
  type: ContextGapType;
  severity: Severity;
  subject: { kind: ContextSubjectKind; id: string; label: string };
  /** Headline question, e.g. "Who owns this follow-up?" */
  question: string;
  /** WHAT TUBO KNOWS — facts already verified from a real source. */
  known: string[];
  /** WHAT TUBO COULD NOT VERIFY. */
  unverified: string[];
  /** WHAT INPUT IS NEEDED TO CONTINUE. */
  needed: string;
  options: ContextOption[];
  /** True when a specific calendar date is a valid answer. */
  allowDate: boolean;
  /** True when "leave unresolved" is a safe answer (it always keeps execution blocked). */
  allowLeaveUnresolved: boolean;
  /** False when no human input can legitimately supply this fact. */
  resolvable: boolean;
  /** Why it is not resolvable, shown verbatim to the operator. */
  notResolvableReason?: string;
  /** Where to go instead (configuration), when not resolvable. */
  cta?: { label: string; href: string };
  /** Reason this blocks execution, so the operator sees the safety rule. */
  blocksExecution: boolean;
}

export interface ContextCandidates {
  /** Other tracked accounts in this workspace (identity ambiguity candidates). */
  accounts: { accountId: string; name: string | null }[];
  /** Contacts read from the CRM for this account. Empty when CRM is unavailable. */
  contacts: { id: string; name: string | null; email: string | null; title: string | null }[];
  /** Open deals read from the CRM for this account. Empty when CRM is unavailable. */
  deals: { id: string; name: string | null; stage: string | null; amount?: number | null }[];
  /** Legitimate owners: workspace members plus people already named as owners. */
  people: { id: string; name: string; role: string | null; origin: ContextOption["origin"] }[];
  /** Providers that failed/were not configured on the last read. */
  unavailableSources: string[];
  /** True when an authoritative commercial provider is configured for this workspace. */
  commercialConfigured: boolean;
  /** True when the caller actually checked commercial configuration (avoids false alarms). */
  commercialChecked: boolean;
}

export const EMPTY_CANDIDATES: ContextCandidates = {
  accounts: [],
  contacts: [],
  deals: [],
  people: [],
  unavailableSources: [],
  commercialConfigured: false,
  commercialChecked: false,
};

function hash(key: string): string {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (Math.imul(31, h) + key.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Deterministic and stable across rescans, so a gap keeps its identity. */
export function gapKey(accountId: string, type: ContextGapType, subjectId: string): string {
  return `gap_${hash(`${accountId}:${type}:${subjectId}`)}`;
}

function optionId(kind: string, value: string): string {
  return `${kind}_${hash(value)}`;
}

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function unresolvedOwner(c: CommitmentState): boolean {
  if (c.owner && c.owner.trim()) return false;
  return c.ownerResolution === "ambiguous" || c.ownerResolution === "conflicting" || c.ownerResolution === "missing_context";
}

function unresolvedDeadline(c: CommitmentState): boolean {
  if (c.dueDate) return false;
  if (c.dueDateWaived) return false;
  return c.dueDateResolution === "ambiguous" || c.dueDateResolution === "missing_context";
}

const ACTIVE_COMMITMENT = new Set(["open", "in_progress", "overdue", "ambiguous", "blocked"]);

// ---------------------------------------------------------------------------
// Option builders — every candidate comes from data that already exists.
// ---------------------------------------------------------------------------

export function buildOwnerOptions(snapshot: AccountIntelligenceSnapshot, candidates: ContextCandidates): ContextOption[] {
  const seen = new Set<string>();
  const out: ContextOption[] = [];

  const push = (name: string, detail: string | undefined, origin: ContextOption["origin"]) => {
    const key = norm(name);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push({ optionId: optionId("owner", key), label: name, ...(detail ? { detail } : {}), origin, value: { owner: name } });
  };

  // 1. Workspace members / previously-legitimate owners supplied by the caller.
  for (const p of candidates.people) push(p.name, p.role ?? undefined, p.origin);
  // 2. Owners already resolved on other commitments for this account.
  for (const c of snapshot.commitments) if (c.owner) push(c.owner, "Owns another commitment on this account", "account_state");
  // 3. People who recorded a decision on this account.
  for (const d of snapshot.decisions ?? []) if (d.decidedBy) push(d.decidedBy, "Recorded a decision on this account", "conversation");

  return out;
}

export function buildContactOptions(candidates: ContextCandidates): ContextOption[] {
  return candidates.contacts.map((c) => ({
    optionId: optionId("contact", c.id),
    label: c.name ?? c.email ?? c.id,
    // Only shown if the CRM actually returned it. Never synthesized.
    ...(c.title || c.email ? { detail: [c.title, c.email].filter(Boolean).join(" · ") } : {}),
    origin: "crm" as const,
    value: { contactId: c.id },
  }));
}

export function buildAccountOptions(accountId: string, candidates: ContextCandidates): ContextOption[] {
  return candidates.accounts
    .filter((a) => a.accountId !== accountId)
    .map((a) => ({
      optionId: optionId("account", a.accountId),
      label: a.name ?? a.accountId,
      detail: a.accountId,
      origin: "workspace" as const,
      value: { canonicalAccountId: a.accountId },
    }));
}

export function buildDealOptions(candidates: ContextCandidates): ContextOption[] {
  return candidates.deals.map((d) => ({
    optionId: optionId("deal", d.id),
    label: d.name ?? d.id,
    detail: [d.stage ? `Stage ${d.stage}` : null, typeof d.amount === "number" ? `Amount ${d.amount}` : null].filter(Boolean).join(" · ") || undefined,
    origin: "crm" as const,
    value: { dealId: d.id },
  })) as ContextOption[];
}

// ---------------------------------------------------------------------------
// Detection
// ---------------------------------------------------------------------------

export interface DetectContextInput {
  accountId: string;
  snapshot: AccountIntelligenceSnapshot;
  findings: Finding[];
  candidates?: ContextCandidates;
}

/**
 * Deterministic: which questions can a human legitimately answer right now?
 * Never invents a gap that the pipeline did not already refuse to act on.
 */
export function detectContextGaps(input: DetectContextInput): ContextGap[] {
  const { accountId, snapshot } = input;
  const candidates = input.candidates ?? EMPTY_CANDIDATES;
  const findings = input.findings.filter((f) => f.status === "open");
  const gaps: ContextGap[] = [];

  // --- 1. Owner could not be resolved on an active commitment ---------------
  for (const c of snapshot.commitments) {
    if (!ACTIVE_COMMITMENT.has(c.status)) continue;
    if (!unresolvedOwner(c)) continue;
    const options = buildOwnerOptions(snapshot, candidates);
    gaps.push({
      gapId: gapKey(accountId, "missing_owner", c.id),
      accountId,
      type: "missing_owner",
      severity: c.status === "overdue" ? "high" : "medium",
      subject: { kind: "commitment", id: c.id, label: c.description },
      question: "Who owns this follow-up?",
      known: [
        `Tubo found the commitment: "${c.description}".`,
        ...(c.dueDate ? [`It is due ${c.dueDate}.`] : c.dueDateText ? [`The conversation said "${c.dueDateText}".`] : []),
        `Source: ${c.sourceEvidence.map((e) => e.source).join(", ") || "conversation"}.`,
      ],
      unverified: [
        c.ownerResolution === "conflicting"
          ? "Two sources name different owners."
          : "No source names a specific owner — the conversation only said \"we\".",
        "An owner is never inferred from who happened to be on the email.",
      ],
      needed: "Select the person accountable for this follow-up.",
      options,
      allowDate: false,
      allowLeaveUnresolved: true,
      resolvable: true,
      blocksExecution: true,
    });
  }

  // --- 2. Deadline missing or ambiguous ------------------------------------
  for (const c of snapshot.commitments) {
    if (!ACTIVE_COMMITMENT.has(c.status)) continue;
    if (!unresolvedDeadline(c)) continue;
    gaps.push({
      gapId: gapKey(accountId, "missing_deadline", c.id),
      accountId,
      type: "missing_deadline",
      severity: "medium",
      subject: { kind: "commitment", id: c.id, label: c.description },
      question: "When is this due?",
      known: [
        `Tubo found the commitment: "${c.description}".`,
        ...(c.owner ? [`Owner: ${c.owner}.`] : []),
        ...(c.dueDateText ? [`The conversation said "${c.dueDateText}".`] : []),
      ],
      unverified: [
        c.dueDateText
          ? `"${c.dueDateText}" cannot be resolved to a specific date without guessing.`
          : "No date was stated anywhere in the source.",
        "Tubo will not fabricate a due date.",
      ],
      needed: "Pick the actual due date, or record that there is no deadline.",
      options: [],
      allowDate: true,
      allowLeaveUnresolved: true,
      resolvable: true,
      blocksExecution: true,
    });
  }

  // --- 3. Account identity ambiguous ---------------------------------------
  const accountOptions = buildAccountOptions(accountId, candidates);
  if (!snapshot.identity?.companyId && accountOptions.length > 0) {
    gaps.push({
      gapId: gapKey(accountId, "ambiguous_account", accountId),
      accountId,
      type: "ambiguous_account",
      severity: "high",
      subject: { kind: "account", id: accountId, label: snapshot.identity?.name ?? accountId },
      question: "Which account is this?",
      known: [
        `Tubo is tracking activity under "${snapshot.identity?.name ?? accountId}".`,
        `${accountOptions.length} other tracked account(s) could be the same company.`,
      ],
      unverified: ["No CRM company record is linked, so the canonical account cannot be confirmed."],
      needed: "Select the account this activity belongs to.",
      options: accountOptions,
      allowDate: false,
      allowLeaveUnresolved: true,
      resolvable: true,
      blocksExecution: true,
    });
  }

  // --- 4. Contact identity ambiguous ---------------------------------------
  if (!snapshot.identity?.contactId) {
    const contactOptions = buildContactOptions(candidates);
    const crmDown = candidates.unavailableSources.includes("hubspot");
    if (contactOptions.length > 0 || crmDown) {
      gaps.push({
        gapId: gapKey(accountId, "ambiguous_contact", accountId),
        accountId,
        type: "ambiguous_contact",
        severity: "medium",
        subject: { kind: "account", id: accountId, label: snapshot.identity?.name ?? accountId },
        question: "Which known contact is the counterpart here?",
        known: [`Tubo has conversation activity for "${snapshot.identity?.name ?? accountId}".`],
        unverified: [
          crmDown
            ? "The CRM could not be read, so no contact list is available."
            : "The person named in the conversation does not map to exactly one CRM contact.",
          "Tubo will never invent an email address for a person it cannot identify.",
        ],
        needed: crmDown ? "Reconnect the CRM, or leave this unresolved." : "Select the correct known contact.",
        options: contactOptions,
        allowDate: false,
        allowLeaveUnresolved: true,
        resolvable: contactOptions.length > 0,
        ...(contactOptions.length === 0
          ? {
              notResolvableReason: "No contact records could be read from the CRM, and a contact cannot be typed in by hand.",
              cta: { label: "Check CRM connection", href: "/app/settings#connections" },
            }
          : {}),
        blocksExecution: false,
      });
    }
  }

  // --- 5. Deal ambiguity / missing deal ------------------------------------
  const dealOptions = buildDealOptions(candidates);
  if (!snapshot.identity?.dealId && dealOptions.length > 0) {
    gaps.push({
      gapId: gapKey(accountId, "missing_deal", accountId),
      accountId,
      type: "missing_deal",
      severity: dealOptions.length > 1 ? "high" : "medium",
      subject: { kind: "account", id: accountId, label: snapshot.identity?.name ?? accountId },
      question: dealOptions.length > 1 ? "Which deal does this work belong to?" : "Is this the right deal?",
      known: [
        `${dealOptions.length} open deal(s) exist in the CRM for this account.`,
        ...(snapshot.stage ? [`Current stage on the account: ${snapshot.stage}.`] : []),
      ],
      unverified: ["No single deal is linked to this account's activity, so a CRM update could land on the wrong record."],
      needed: "Select the deal this work belongs to.",
      options: dealOptions,
      allowDate: false,
      allowLeaveUnresolved: true,
      resolvable: true,
      blocksExecution: true,
    });
  }

  // --- 6. Commercial authority (NEVER human-assertable) ---------------------
  const commercialUnavailable =
    (candidates.commercialChecked && !candidates.commercialConfigured) ||
    candidates.unavailableSources.includes("commercial") ||
    (snapshot.unavailableSources ?? []).includes("commercial");
  if (commercialUnavailable) {
    gaps.push({
      gapId: gapKey(accountId, "missing_commercial_authority", "commercial"),
      accountId,
      type: "missing_commercial_authority",
      severity: "high",
      subject: { kind: "source", id: "commercial", label: "Commercial source" },
      question: "Commercial authority is not configured.",
      known: [
        ...(snapshot.stage ? [`CRM stage is "${snapshot.stage}".`] : []),
        "CRM stage is a sales opinion, not proof of payment.",
      ],
      unverified: ["Subscription and payment state could not be read from an authoritative billing source."],
      needed: "Connect an authoritative commercial source. Payment status cannot be asserted by hand.",
      options: [],
      allowDate: false,
      allowLeaveUnresolved: false,
      resolvable: false,
      notResolvableReason:
        "Billing truth must come from the billing system. Typing \"customer paid\" here would be an unverified claim, so Tubo does not accept it.",
      cta: { label: "Configure commercial source", href: "/app/settings#connections" },
      blocksExecution: true,
    });
  }

  // --- 7. Other unavailable authoritative sources ---------------------------
  for (const src of snapshot.unavailableSources ?? []) {
    if (src === "commercial") continue;
    gaps.push({
      gapId: gapKey(accountId, "unavailable_source", src),
      accountId,
      type: "unavailable_source",
      severity: "medium",
      subject: { kind: "source", id: src, label: src },
      question: `The ${src} source could not be read.`,
      known: ["Tubo is working from the state it already has on file."],
      unverified: [`Live state from ${src} is unavailable, so anything derived from it may be out of date.`],
      needed: "Reconnect the source. Its values cannot be supplied by hand.",
      options: [],
      allowDate: false,
      allowLeaveUnresolved: false,
      resolvable: false,
      notResolvableReason: `${src} is an authoritative system of record. Its values are read, never typed in.`,
      cta: { label: "Check connections", href: "/app/settings#connections" },
      blocksExecution: true,
    });
  }

  // --- 8. Incomplete evidence flagged by the scanner ------------------------
  for (const f of findings) {
    if (f.type !== "missing_required_context") continue;
    const already = gaps.some((g) => g.type === "unavailable_source" || g.type === "missing_commercial_authority");
    if (already) continue;
    gaps.push({
      gapId: gapKey(accountId, "incomplete_evidence", f.findingId),
      accountId,
      type: "incomplete_evidence",
      severity: f.severity,
      subject: { kind: "source", id: f.findingId, label: f.title },
      question: "Required context is missing.",
      known: [f.description],
      unverified: f.evidence.length ? f.evidence : ["The required source data was not available at scan time."],
      needed: "Restore the missing source, then re-run the account refresh.",
      options: [],
      allowDate: false,
      allowLeaveUnresolved: false,
      resolvable: false,
      notResolvableReason: "This gap is about missing source data, not a human judgement call.",
      cta: { label: "Check connections", href: "/app/settings#connections" },
      blocksExecution: true,
    });
  }

  return gaps;
}

// ---------------------------------------------------------------------------
// Resolution validation + event projection
// ---------------------------------------------------------------------------

export type ResolutionChoice =
  | { kind: "option"; optionId: string }
  | { kind: "date"; date: string }
  | { kind: "unresolved" };

export interface ResolutionValidationError {
  code: "GAP_NOT_RESOLVABLE" | "VALIDATION" | "NOT_FOUND";
  message: string;
}

export interface ValidatedResolution {
  gap: ContextGap;
  choice: ResolutionChoice;
  /** Human-readable value recorded in the audit trail. */
  selectedLabel: string;
  /** Structured value applied to state. Empty for "leave unresolved". */
  selectedValue: Record<string, unknown>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The single safety gate for human input. Rejects anything that would let a
 * person assert a fact no real source supports.
 */
export function validateResolution(gap: ContextGap, choice: ResolutionChoice): ValidatedResolution | ResolutionValidationError {
  if (!gap.resolvable) {
    return {
      code: "GAP_NOT_RESOLVABLE",
      message: gap.notResolvableReason ?? "This gap cannot be resolved by human input.",
    };
  }

  if (choice.kind === "unresolved") {
    if (!gap.allowLeaveUnresolved) {
      return { code: "VALIDATION", message: "This gap cannot be left unresolved." };
    }
    return { gap, choice, selectedLabel: "Left unresolved", selectedValue: {} };
  }

  if (choice.kind === "date") {
    if (!gap.allowDate) return { code: "VALIDATION", message: "A date is not a valid answer for this gap." };
    if (!ISO_DATE.test(choice.date)) return { code: "VALIDATION", message: "Provide the date as YYYY-MM-DD." };
    const parsed = Date.parse(`${choice.date}T00:00:00.000Z`);
    if (Number.isNaN(parsed)) return { code: "VALIDATION", message: "That is not a real date." };
    return {
      gap,
      choice,
      selectedLabel: choice.date,
      selectedValue: { dueDate: new Date(parsed).toISOString() },
    };
  }

  const option = gap.options.find((o) => o.optionId === choice.optionId);
  if (!option) {
    // Critical: a value that is not in the server-derived candidate set is a
    // fabricated value, no matter what the client sent.
    return { code: "VALIDATION", message: "That option is not one of the candidates Tubo found in your real data." };
  }
  return { gap, choice, selectedLabel: option.label, selectedValue: option.value };
}

export function isValidationError(v: ValidatedResolution | ResolutionValidationError): v is ResolutionValidationError {
  return (v as ResolutionValidationError).code !== undefined;
}

/**
 * Project a validated resolution into a `manual_correction` account-event
 * payload. Provenance is always `human_supplied` — source evidence and the
 * original conversation record are never rewritten.
 */
export function resolutionEventPayload(v: ValidatedResolution): Record<string, unknown> {
  const { gap, choice, selectedValue } = v;
  const base = {
    contextResolution: {
      gapId: gap.gapId,
      gapType: gap.type,
      subject: gap.subject,
      provenance: "human_supplied" as ContextProvenance,
    },
  };

  if (choice.kind === "unresolved") return base;

  switch (gap.type) {
    case "missing_owner":
      return {
        ...base,
        provenanceTag: "human_supplied",
        commitmentUpdates: [{ commitmentId: gap.subject.id, owner: String(selectedValue.owner) }],
      };
    case "missing_deadline":
      return {
        ...base,
        provenanceTag: "human_supplied",
        commitmentUpdates: [{ commitmentId: gap.subject.id, dueDate: String(selectedValue.dueDate) }],
      };
    case "ambiguous_account":
      return { ...base, provenanceTag: "human_supplied", identityUpdates: { companyId: String(selectedValue.canonicalAccountId) } };
    case "ambiguous_contact":
      return { ...base, provenanceTag: "human_supplied", identityUpdates: { contactId: String(selectedValue.contactId) } };
    case "missing_deal":
      return { ...base, provenanceTag: "human_supplied", identityUpdates: { dealId: String(selectedValue.dealId) } };
    default:
      return base;
  }
}

/** Human input never approves, executes, or changes commercial/stage truth. */
export const FORBIDDEN_RESOLUTION_FIELDS = ["stage", "status", "commercial", "closedWon", "approval", "execute"] as const;

export function assertNoAuthorityOverride(payload: Record<string, unknown>): void {
  for (const key of FORBIDDEN_RESOLUTION_FIELDS) {
    if (key in payload) {
      throw new Error(`context resolution may not set "${key}"`);
    }
  }
}
