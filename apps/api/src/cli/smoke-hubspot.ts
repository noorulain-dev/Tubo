import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import {
  AuditService,
  HubSpotCRMProvider,
  HubSpotHttpClient,
  MemoryAuditSink,
  type DealRecord,
} from "../shared/core.js";

// Load .env from the workspace cwd and/or the repo root (whichever runs it).
for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  loadDotenv({ path: p });
}

const token = process.env.HUBSPOT_ACCESS_TOKEN;
const baseUrl = process.env.HUBSPOT_BASE_URL;
const companyName = process.env.HUBSPOT_SMOKE_COMPANY;
const companyIdEnv = process.env.HUBSPOT_SMOKE_COMPANY_ID;

/** Redact anything that looks like a credential token from a string. */
function redact(value: string): string {
  return value
    .replace(/(sk_(?:live|test)_[A-Za-z0-9]+)/g, "***")
    .replace(/(pat-[A-Za-z0-9-]+)/g, "***")
    .replace(/(Bearer\s+)[A-Za-z0-9._-]+/g, "$1***");
}

let failed = false;

async function step(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    process.stdout.write(`✓ ${label}\n`);
  } catch (err) {
    failed = true;
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`✗ ${label}: ${redact(message)}\n`);
  }
}

async function main(): Promise<void> {
  if (!token) {
    process.stderr.write("✗ HUBSPOT_ACCESS_TOKEN is not set. Aborting.\n");
    process.exit(1);
  }
  if (!companyName && !companyIdEnv) {
    process.stderr.write("✗ HUBSPOT_SMOKE_COMPANY (or HUBSPOT_SMOKE_COMPANY_ID) is not set. Aborting.\n");
    process.exit(1);
  }

  const audit = new AuditService(new MemoryAuditSink());
  const client = new HubSpotHttpClient({ accessToken: token, baseUrl, audit });
  const crm = new HubSpotCRMProvider(client, { audit });

  // 1. Authenticate via a lightweight authenticated read.
  await step("authenticated", async () => {
    await client.get("/crm/v3/objects/companies", { limit: 1 });
  });

  // 2. Locate one configured company (by direct id, else by name search).
  let companyId: string | null = null;
  await step("company found", async () => {
    if (companyIdEnv) {
      companyId = companyIdEnv;
      return;
    }
    const accounts = await crm.resolveAccount(companyName!);
    if (!accounts.length) {
      throw new Error(`no HubSpot company matched "${companyName}"`);
    }
    companyId = accounts[0].id;
  });

  // 3. Retrieve associated contacts.
  await step("contact retrieved", async () => {
    const contacts = await crm.getContacts(companyId!);
    if (!contacts.length) throw new Error("no associated contacts");
  });

  // 4. Retrieve the associated/open deal.
  let openDeal: DealRecord | null = null;
  await step("deal retrieved", async () => {
    openDeal = await crm.getOpenDeal(companyId!);
    if (!openDeal) throw new Error("no open deal associated with the company");
  });

  // 5. Retrieve the current deal stage (re-fetched by deal id).
  await step("current stage retrieved", async () => {
    if (!openDeal) throw new Error("no open deal to read stage from");
    const deal = await crm.getDeal(openDeal.id);
    if (!deal || !deal.stage) throw new Error("deal has no stage");
  });

  // 6. Retrieve open tasks.
  await step("tasks retrieved", async () => {
    const tasks = await crm.getOpenTasks(companyId!);
    if (!tasks.length) throw new Error("no open tasks");
  });

  // 7. Retrieve recent notes where available.
  await step("note retrieved", async () => {
    await crm.getRecentNotes(companyId!);
  });

  if (failed) {
    process.stderr.write("HubSpot smoke test FAILED.\n");
    process.exit(1);
  }
  process.stdout.write("HubSpot smoke test passed.\n");
}

void main();