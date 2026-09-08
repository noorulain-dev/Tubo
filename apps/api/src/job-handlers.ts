import { FirefliesProvider } from "./core.js";
import { getPool } from "./db.js";
import { getFirefliesApiKey } from "./connections.js";
import { syncCalendar } from "./calendar-sync.js";
import { enqueue, type Job } from "./jobs.js";

export async function handleCalendarSync(job: Job): Promise<void> {
  await syncCalendar(job.userId);

  // Event-driven follow-up: for every upcoming meeting, schedule a one-shot
  // Fireflies discovery 10 minutes after it ends (instead of polling Fireflies
  // endlessly). Idempotent by meeting id + end time.
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

/** Discovery: list recent Fireflies meetings, enqueue a fetch for each unseen one. */
export async function handleFirefliesSync(job: Job): Promise<void> {
  const apiKey = await getFirefliesApiKey(job.userId);
  if (!apiKey) return; // no Fireflies connection → no-op
  const provider = new FirefliesProvider({ apiKey });
  const meetings = await provider.listRecentMeetings();
  const pool = getPool();
  for (const m of meetings) {
    const exists = await pool.query(
      "SELECT 1 FROM meeting_artifacts WHERE user_id = $1 AND provider = $2 AND provider_meeting_id = $3",
      [job.userId, "fireflies", m.providerMeetingId],
    );
    if (exists.rows.length) continue; // already ingested → skip
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
  const transcript = await provider.getTranscript(meetingId);
  const summary = await provider.getSummary(meetingId);

  const pool = getPool();
  await pool.query(
    `INSERT INTO meeting_artifacts (id, user_id, provider, provider_meeting_id, metadata, ingestion_status, updated_at)
     VALUES ($1, $2, 'fireflies', $3, $4::jsonb, 'fetched', now())
     ON CONFLICT (user_id, provider, provider_meeting_id)
     DO UPDATE SET metadata = EXCLUDED.metadata, ingestion_status = 'fetched', updated_at = now()`,
    [`${job.userId}:${meetingId}`, job.userId, meetingId, JSON.stringify({ transcript, summary })],
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
  const pool = getPool();
  // Mark the artifact processed and attach the interaction identity. The full
  // semantic/agent pipeline wiring (canonical interaction → interpreter → …)
  // lands in a later step; this persists enough for idempotent ingestion.
  await pool.query(
    "UPDATE meeting_artifacts SET ingestion_status = 'processed', interaction_id = $2 WHERE user_id = $1 AND provider = 'fireflies' AND provider_meeting_id = $3",
    [job.userId, job.id, meetingId],
  );
}

export const HANDLERS: Record<string, (job: Job) => Promise<void>> = {
  "calendar.sync": handleCalendarSync,
  "fireflies.sync": handleFirefliesSync,
  "fireflies.fetch": handleFirefliesFetch,
  "interaction.process": handleInteractionProcess,
};
