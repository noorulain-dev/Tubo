import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { ensureSchema } from "../database/db.js";
import { claimNext, completeJob, emitJobEvent, enqueue, failJob, listConnectedUserIds, reclaimStaleRunning, type Job, type JobType } from "./jobs.js";
import { HANDLERS } from "./job-handlers.js";
import { listExpiringChannels, registerWatch } from "../integrations/calendar-watch.js";
import { listTrackedAccounts } from "../accounts/account-refresh.js";
import { createLiveApp } from "../app/live.js";
import { setPipelineService } from "../runs/pipeline-service.js";
import { isLiveConfigured, loadConfig } from "../shared/core.js";

const ALL_TYPES: JobType[] = ["calendar.sync", "fireflies.sync", "fireflies.fetch", "interaction.process", "account.refresh"];

function classify(err: unknown): { code: string; transient: boolean } {
  const status = (err as { status?: number } | undefined)?.status;
  if (status === 429) return { code: "RATE_LIMITED", transient: true };
  if (status != null && status >= 500) return { code: "PROVIDER_5XX", transient: true };
  if (status === 401 || status === 403) return { code: "AUTH", transient: false };
  if (status === 400) return { code: "BAD_REQUEST", transient: false };
  // network / timeout / unknown → transient
  return { code: "TIMEOUT", transient: true };
}

async function runJob(job: Job): Promise<void> {
  await emitJobEvent(job.id, job.userId, "started");
  try {
    await HANDLERS[job.type]?.(job);
    await completeJob(job.id);
    await emitJobEvent(job.id, job.userId, "completed");
  } catch (err) {
    const { code, transient } = classify(err);
    const status = await failJob(job.id, code, transient);
    await emitJobEvent(job.id, job.userId, status === "retrying" ? "retrying" : "failed");
  }
}

/** Conservative hourly idempotency bucket so a periodic scan doesn't pile up duplicates. */
function hourBucket(): string {
  return Math.floor(Date.now() / (60 * 60 * 1000)).toString();
}

async function scheduleScan(): Promise<void> {
  // Reclaim jobs left "running" by a prior crashed worker.
  await reclaimStaleRunning().catch(() => undefined);

  // Calendar sync is the only periodic driver: it discovers meetings and, in
  // handleCalendarSync, schedules the one-shot Fireflies discovery 10 minutes
  // after each meeting ends (event-driven — no endless Fireflies polling).
  const calendarUsers = await listConnectedUserIds("google-calendar");
  for (const userId of calendarUsers) {
    await enqueue({ type: "calendar.sync", userId, idempotencyKey: `cal:sync:${userId}:${hourBucket()}` });
  }

  // Conservative tracked-account refresh (hourly bucket). Selectively re-reads
  // HubSpot/Gmail source state and emits events only on material change.
  for (const acc of await listTrackedAccounts()) {
    await enqueue({ type: "account.refresh", userId: acc.userId, resourceRef: acc.accountId, idempotencyKey: `acct:refresh:${acc.userId}:${acc.accountId}:${hourBucket()}` });
  }

  // Renew Calendar watch channels before they expire (Google channels last ~1 week).
  const webhookUrl = loadConfig().calendarWebhookUrl;
  if (webhookUrl) {
    const expiring = await listExpiringChannels(24 * 60 * 60 * 1000);
    for (const ch of expiring) {
      await registerWatch(ch.userId, webhookUrl).catch(() => undefined);
    }
  }
}

async function main(): Promise<void> {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    loadDotenv({ path: p });
  }
  await ensureSchema();

  // Register the live pipeline so background jobs use the same engine as manual.
  const config = loadConfig();
  if (isLiveConfigured(config)) {
    setPipelineService(createLiveApp(config).service);
  }

  await scheduleScan();
  setInterval(() => {
    void scheduleScan();
  }, 30 * 60 * 1000);

  // Worker loop: claim ready jobs; idle when none.
  for (;;) {
    const jobs = await claimNext(ALL_TYPES, 5);
    for (const job of jobs) {
      await runJob(job);
    }
    if (jobs.length === 0) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

void main();
