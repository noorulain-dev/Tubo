import type { MeetingArtifact } from "../shared/core.js";
import type { InteractionInput } from "../shared/types.js";

/** Provenance metadata carried on a run so the UI can show Source/Meeting/Account. */
export interface SourceMetadata {
  sourceType: "manual" | "fireflies";
  providerMeetingId?: string;
  calendarEventId?: string;
  meetingTitle?: string | null;
  meetingDate?: string | null;
  participants?: string[];
  providerSummary?: string | null;
  actionItemHints?: string[];
  provenance?: string;
}

/**
 * Normalize a Fireflies meeting artifact into the SAME canonical InteractionInput
 * the manual path uses. Fireflies action items are carried as hints only — they
 * are never authoritative operational truth.
 */
export function buildCanonicalInteraction(
  artifact: MeetingArtifact,
  meta: { accountId?: string; calendarEventId?: string },
): { input: InteractionInput; source: SourceMetadata } {
  const transcriptText = artifact.transcript.map((s) => `${s.speaker ?? "Speaker"}: ${s.text}`).join("\n");
  const text = [
    artifact.title ? `Meeting: ${artifact.title}` : null,
    artifact.summary ? `Summary: ${artifact.summary}` : null,
    transcriptText,
  ]
    .filter(Boolean)
    .join("\n\n");

  const input: InteractionInput = {
    text,
    kind: "meeting",
    accountId: meta.accountId,
    participants: artifact.participants.map((p) => ({ role: "unknown", email: p, identity: "missing_context" })),
  };

  const source: SourceMetadata = {
    sourceType: "fireflies",
    providerMeetingId: artifact.providerMeetingId,
    calendarEventId: meta.calendarEventId,
    meetingTitle: artifact.title,
    meetingDate: artifact.startedAt,
    participants: artifact.participants,
    providerSummary: artifact.summary,
    actionItemHints: artifact.actionItemHints,
    provenance: artifact.provenance,
  };

  return { input, source };
}
