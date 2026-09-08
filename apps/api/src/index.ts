import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { serve } from "@hono/node-server";
import { integrationStatus, isLiveConfigured, loadConfig } from "./core.js";
import { createSampleApp } from "./sample.js";
import { createLiveApp } from "./live.js";
import { createApp } from "./app.js";
import { ensureSchema } from "./db.js";

// Load .env from repo root and/or the workspace cwd (whichever runs the server).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  loadDotenv({ path: p });
}

const config = loadConfig();

async function main(): Promise<void> {
  await ensureSchema();
  const sample = createSampleApp();
  let liveService = undefined;

  if (isLiveConfigured(config)) {
    const live = await createLiveApp(config);
    liveService = live.service;
    for (const w of live.warnings) {
      // eslint-disable-next-line no-console
      console.warn(`[live] ${w}`);
    }
  } else {
    // eslint-disable-next-line no-console
    console.warn("[live] Live Mode unavailable: no LLM API key configured (OPENAI_API_KEY / DEEPSEEK_API_KEY).");
  }

  const redirectUri =
    config.gmailRedirectUri ?? `http://localhost:${config.port}/gmail/oauth/callback`;
  const calendarRedirectUri = `http://localhost:${config.port}/integrations/google-calendar/oauth/callback`;
  const gmailOAuth =
    config.gmailClientId && config.gmailClientSecret
      ? { clientId: config.gmailClientId, clientSecret: config.gmailClientSecret, redirectUri, calendarRedirectUri }
      : undefined;

  const app = createApp({
    sampleService: sample.service,
    liveService,
    integrations: integrationStatus(config),
    gmailOAuth,
    reset: sample.reset,
  });

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    // eslint-disable-next-line no-console
    console.log(`Revenue Execution OS API listening on http://localhost:${info.port} (live ${liveService ? "available" : "unavailable"})`);
  });
}

void main();
