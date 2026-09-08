import { buildCanonicalInteraction } from "./canonical-interaction.js";
import {
  correlateCalendar,
  resolveIdentity,
  type CalendarEventInput,
  type HubSpotIdentityInput,
  type MeetingArtifact,
} from "./core.js";
import type { InteractionInput } from "./types.js";

/** Minimal process surface so the orchestrator is unit-testable without the LLM. */
export interface ProcessFn {
  process(input: InteractionInput, userId: string): Promise<{ proposals: { status: string }[] }>;
}

export interface FirefliesIngestDeps {
  process: ProcessFn;
  loadArtifact: (userId: string, meetingId: string) => Promise<MeetingArtifact | null>;
  loadCalendarEvents: (userId: string) => Promise<CalendarEventInput[]>;
  loadHubSpotIdentity: (userId: string) => Promise<HubSpotIdentityInput>;
}

export interface IngestOutcome {
  status: "needs_review" | "completed_no_action" | "unresolved_account" | "failed";
  accountResolved: boolean;
}

/**
 * Ingest one Fireflies meeting artifact through the SAME canonical pipeline as
 * manual processing: load artifact → correlate Calendar → resolve HubSpot
 * identity → build canonical InteractionInput → process. Idempotency is owned by
 * the meeting_artifacts identity + the caller's dedup key.
 */
export async function ingestMeetingArtifact(userId: string, meetingId: string, deps: FirefliesIngestDeps): Promise<IngestOutcome> {
  const artifact = await deps.loadArtifact(userId, meetingId);
  if (!artifact) return { status: "failed", accountResolved: false };

  const meeting = {
    providerMeetingId: artifact.providerMeetingId,
    title: artifact.title,
    startedAt: artifact.startedAt,
    endedAt: artifact.endedAt,
    organizer: artifact.organizer,
    participants: artifact.participants,
    meetingUrl: artifact.meetingUrl,
  };

  const cal = correlateCalendar(meeting, await deps.loadCalendarEvents(userId));
  const identity = resolveIdentity(meeting, await deps.loadHubSpotIdentity(userId));

  const accountId = identity.state === "resolved" ? identity.resolved?.companyId ?? identity.resolved?.contactId : undefined;
  const { input } = buildCanonicalInteraction(artifact, { accountId, calendarEventId: cal.eventId ?? undefined });

  const run = await deps.process.process(input, userId);
  const accountResolved = accountId != null;
  const status = !accountResolved
    ? "unresolved_account"
    : run.proposals.some((p) => p.status === "pending_approval")
      ? "needs_review"
      : "completed_no_action";

  return { status, accountResolved };
}
