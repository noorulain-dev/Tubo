import { FirefliesProvider, type CalendarEventInput, type HubSpotIdentityInput, type MeetingArtifact } from "./core.js";
import { getPool } from "./db.js";
import { getFirefliesApiKey } from "./connections.js";
import { listCalendarEvents, syncCalendar } from "./calendar-sync.js";
import { ingestMeetingArtifact } from "./fireflies-ingest.js";
import { getPipelineService } from "./pipeline-service.js";
import { enqueue, type Job } from "./jobs.js";

export async function handleCalendarSync(job: Job): Promise<void> {
  await syncCalendar(job.userId);

  const apiKey = await getFirefliesApiKey(job.userId);
  if (!apiKey) return;
  const pool = getPool();
  const res = await pool.query(
    "SELECT provider_event_id, end_at FROM calendar_events WHERE user_id = $1 AND end_at > now() ORDER BY end_at",
    [job.userId],
  );
  for (const row of res.rows as { provider_event_id: string; end_at: string }[]) {
    const fireAt = new Date(new Date(row.end_at).getTime() + 10 * 60 * 1000);
    await enqueue({
      type: "fireflies.sync",
      userId: job.userId,
      scheduledAt: fireAt,
      idempotencyKey: `ff:after:${job.userId}:${row.provider_event_id}:${row.end_at}`,
    });
  }
}

export async function handleFirefliesSync(job: Job): Promise<void> {
  const apiKey = await getFirefliesApiKey(job.userId);
  if (!apiKey) return;
  const provider = new FirefliesProvider({ apiKey });
  const meetings = await provider.listRecentMeetings();
  const pool = getPool();
  for (const m of meetings) {
    const exists = await pool.query(
      "SELECT 1 FROM meeting_artifacts WHERE user_id = $1 AND provider = $2 AND provider_meeting_id = $3",
      [job.userId, "fireflies", m.providerMeetingId],
    );
    if (exists.rows.length) continue;
    await enqueue({
      type: "fireflies.fetch",
      userId: job.userId,
      resourceRef: m.providerMeetingId,
      payload: { providerMeetingId: m.providerMeetingId },
      idempotencyKey: `ff:fetch:${job.userId}:${m.providerMeetingId}`,
    });
  }
}

export async function handleFirefliesFetch(job: Job): Promise<void> {
  const apiKey = await getFirefliesApiKey(job.userId);
  if (!apiKey) throw new Error("Fireflies not connected");
  const meetingId = (job.payload.providerMeetingId as string | undefined) ?? job.resourceRef;
  if (!meetingId) throw new Error("missing provider meeting id");

  const provider = new FirefliesProvider({ apiKey });
  const meetings = await provider.listRecentMeetings();
  const artifact = meetings.find((m) => m.providerMeetingId === meetingId);
  if (!artifact) throw new Error("meeting not found in Fireflies");

  const pool = getPool();
  await pool.query(
    `INSERT INTO meeting_artifacts (id, user_id, provider, provider_meeting_id, metadata, ingestion_status, updated_at)
     VALUES ($1, $2, 'fireflies', $3, $4::jsonb, 'fetched', now())
     ON CONFLICT (user_id, provider, provider_meeting_id)
     DO UPDATE SET metadata = EXCLUDED.metadata, ingestion_status = 'fetched', updated_at = now()`,
    [`${job.userId}:${meetingId}`, job.userId, meetingId, JSON.stringify(artifact)],
  );

  await enqueue({
    type: "interaction.process",
    userId: job.userId,
    resourceRef: meetingId,
    payload: { providerMeetingId: meetingId },
    idempotencyKey: `ff:process:${job.userId}:${meetingId}`,
  });
}

export async function handleInteractionProcess(job: Job): Promise<void> {
  const meetingId = (job.payload.providerMeetingId as string | undefined) ?? job.resourceRef;
  if (!meetingId) throw new Error("missing provider meeting id");
  const service = getPipelineService();
  if (!service) throw new Error("pipeline service not initialized");

  const pool = getPool();
  const res = await pool.query(
    "SELECT metadata FROM meeting_artifacts WHERE user_id = $1 AND provider = 'fireflies' AND provider_meeting_id = $2",
    [job.userId, meetingId],
  );
  const artifact = (res.rows[0] as { metadata: MeetingArtifact } | undefined)?.metadata;
  if (!artifact) throw new Error("artifact not persisted");

  const outcome = await ingestMeetingArtifact(job.userId, meetingId, {
    process: service,
    loadArtifact: async () => artifact,
    loadCalendarEvents: async (userId) => {
      const now = Date.now();
      const events = await listCalendarEvents(userId, new Date(now - 48 * 3600 * 1000), new Date(now + 48 * 3600 * 1000));
      return events.map((e) => ({
        providerEventId: e.id,
        title: e.title,
        startAt: e.startAt,
        endAt: e.endAt,
        organizerEmail: e.organizerEmail,
        attendees: [],
        meetingUrl: e.meetingUrl,
      })) as CalendarEventInput[];
    },
    loadHubSpotIdentity: async (): Promise<HubSpotIdentityInput> => {
      // Best-effort: real contact-by-email resolution is wired in a later step.
      return { contacts: [], companies: [], deals: [], internalEmails: [] };
    },
  });

  await pool.query(
    "UPDATE meeting_artifacts SET ingestion_status = $2, interaction_id = $3 WHERE user_id = $1 AND provider = 'fireflies' AND provider_meeting_id = $4",
    [job.userId, outcome.status === "unresolved_account" ? "unresolved_account" : "processed", job.id, meetingId],
  );
}

export const HANDLERS: Record<string, (job: Job) => Promise<void>> = {
  "calendar.sync": handleCalendarSync,
  "fireflies.sync": handleFirefliesSync,
  "fireflies.fetch": handleFirefliesFetch,
  "interaction.process": handleInteractionProcess,
};
