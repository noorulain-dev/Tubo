import { AuditService, HubSpotCRMProvider, HubSpotHttpClient, MemoryAuditSink, type CreateTaskInput } from "./core.js";
import { fail, initSmokeEnv, ok, resolveSmokeCredentials } from "./smoke-shared.js";

initSmokeEnv();

const companyId = process.env.HUBSPOT_SMOKE_COMPANY_ID;
const companyName = process.env.HUBSPOT_SMOKE_COMPANY;
const TEST_TAG = `[smoke ${Date.now()}]`;

async function main(): Promise<void> {
  if (process.env.ALLOW_LIVE_TEST_WRITES !== "true") {
    process.stderr.write("✗ set ALLOW_LIVE_TEST_WRITES=true to run live HubSpot writes (opt-in).\n");
    process.exit(2);
  }
  if (!companyId && !companyName) {
    process.stderr.write("✗ HUBSPOT_SMOKE_COMPANY_ID or HUBSPOT_SMOKE_COMPANY is required.\n");
    process.exit(1);
  }

  const creds = await resolveSmokeCredentials();
  if (!creds.hubspotToken) {
    process.stderr.write("✗ no HubSpot connection for this user (connect it first, or set HUBSPOT_ACCESS_TOKEN).\n");
    process.exit(1);
  }

  const audit = new AuditService(new MemoryAuditSink());
  const client = new HubSpotHttpClient({ accessToken: creds.hubspotToken, audit });
  const crm = new HubSpotCRMProvider(client, { audit });

  let accountId = companyId;
  let failed = false;

  // 1. create task
  let taskId: string | undefined;
  try {
    const input: CreateTaskInput = {
      accountId: accountId ?? "smoke",
      title: `${TEST_TAG} verify task`,
      type: "TODO",
      dueDate: new Date(Date.now() + 86400000).toISOString(),
    };
    taskId = (await crm.createTask(input)).externalRef;
    ok("task created");
  } catch (e) {
    failed = true;
    fail("task created", e instanceof Error ? e.message : String(e));
  }

  // 2. read task back by id
  try {
    if (taskId) {
      const task = await client.get(`/crm/v3/objects/tasks/${taskId}`);
      ok(`task read back (${(task as { id: string }).id})`);
    } else {
      fail("task read back", "no task id");
      failed = true;
    }
  } catch (e) {
    failed = true;
    fail("task read back", e instanceof Error ? e.message : String(e));
  }

  // 3. create note
  let noteId: string | undefined;
  try {
    noteId = (await crm.createNote(accountId ?? "smoke", `${TEST_TAG} verify note`)).externalRef;
    ok("note created");
  } catch (e) {
    failed = true;
    fail("note created", e instanceof Error ? e.message : String(e));
  }

  // 4. read note back by id
  try {
    if (noteId) {
      const note = await client.get(`/crm/v3/objects/notes/${noteId}`);
      ok(`note read back (${(note as { id: string }).id})`);
    } else {
      fail("note read back", "no note id");
      failed = true;
    }
  } catch (e) {
    failed = true;
    fail("note read back", e instanceof Error ? e.message : String(e));
  }

  if (failed) {
    process.stderr.write("HubSpot write smoke test FAILED.\n");
    process.exit(1);
  }
  process.stdout.write("HubSpot write smoke test passed.\n");
}

void main();
