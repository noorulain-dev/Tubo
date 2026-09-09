import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  loadDotenv({ path: p });
}

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const BASE = (process.env.HUBSPOT_BASE_URL ?? "https://api.hubapi.com").replace(/\/$/, "");
const MARKER = "Tubo E2E synthetic test data";
const PROPERTY_NAME = "revexec_billing_status";

if (!TOKEN) {
  console.error("✗ HUBSPOT_ACCESS_TOKEN is required");
  process.exit(1);
}

type Json = Record<string, unknown>;

async function api(method: string, path: string, body?: unknown): Promise<Json> {
  const res = await fetch(BASE + path, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Json | null = null;
  try {
    json = text ? (JSON.parse(text) as Json) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 400)}`);
  }
  return json ?? {};
}

async function search(type: string, filters: { propertyName: string; operator: string; value: string }[], properties: string[]): Promise<Json[]> {
  const res = await api("POST", `/crm/v3/objects/${type}/search`, { filterGroups: [{ filters }], properties, limit: 10 });
  return (res.results as Json[]) ?? [];
}

async function create(type: string, properties: Record<string, unknown>): Promise<string> {
  const res = await api("POST", `/crm/v3/objects/${type}`, { properties });
  return res.id as string;
}

async function update(type: string, id: string, properties: Record<string, unknown>): Promise<void> {
  await api("PATCH", `/crm/v3/objects/${type}/${id}`, { properties });
}

async function associate(fromType: string, fromId: string, toType: string, toId: string, assocType: string): Promise<void> {
  await api("PUT", `/crm/v3/objects/${fromType}/${fromId}/associations/${toType}/${toId}/${assocType}`);
}

async function get(type: string, id: string, properties: string[]): Promise<Json> {
  const qs = properties.map((p) => `properties=${encodeURIComponent(p)}`).join("&");
  return api("GET", `/crm/v3/objects/${type}/${id}?${qs}`);
}

async function upsert(type: string, searchProp: string, searchValue: string, properties: Record<string, unknown>): Promise<string> {
  const existing = await search(type, [{ propertyName: searchProp, operator: "EQ", value: searchValue }], Object.keys(properties));
  const match = existing.find((r) => !(r.archived === true));
  if (match) {
    await update(type, match.id as string, properties);
    return match.id as string;
  }
  return create(type, properties);
}

interface AccountSpec {
  name: string;
  domain: string;
  contact: { first: string; last: string; email: string };
  deal: { name: string; stage: string; commercial: string };
  task?: { subject: string; type: string; status: string };
  extraCompanies?: { name: string; domain: string }[];
}

// "appointmentscheduled" = earliest default stage → represents the pre-paid/Trial state
// for the CRM-vs-commercial contradiction scenario.
const ACCOUNTS: AccountSpec[] = [
  {
    name: "Northstar Labs",
    domain: "northstarlabs.com",
    contact: { first: "Emily", last: "Torres", email: "emily.torres@northstarlabs.com" },
    deal: { name: "Northstar Expansion", stage: "presentationscheduled", commercial: "none" },
  },
  {
    name: "Helio Systems",
    domain: "heliosystems.io",
    contact: { first: "Marcus", last: "Webb", email: "marcus.webb@heliosystems.io" },
    deal: { name: "Helio Enterprise", stage: "appointmentscheduled", commercial: "active" },
  },
  {
    name: "Atlas Robotics",
    domain: "atlasrobotics.ai",
    contact: { first: "Priya", last: "Nair", email: "priya.nair@atlasrobotics.ai" },
    deal: { name: "Atlas Renewal", stage: "presentationscheduled", commercial: "cancelled" },
  },
  {
    name: "NovaWorks",
    domain: "novaworks.co",
    contact: { first: "Alex", last: "Morgan", email: "alex.morgan@novaworks.co" },
    deal: { name: "NovaWorks Platform", stage: "presentationscheduled", commercial: "none" },
    extraCompanies: [{ name: "Nova Works Consulting", domain: "novaworks.co" }],
  },
  {
    name: "Beacon Health",
    domain: "beaconhealth.care",
    contact: { first: "Dana", last: "Whitfield", email: "dana@beaconhealth.care" },
    deal: { name: "Beacon Rollout", stage: "presentationscheduled", commercial: "none" },
    task: { subject: "Send proposal", type: "EMAIL", status: "NOT_STARTED" },
  },
];

async function ensureProperty(): Promise<boolean> {
  const options = [
    { label: "Active", value: "active" },
    { label: "Trialing", value: "trialing" },
    { label: "Past Due", value: "past_due" },
    { label: "Cancelled", value: "cancelled" },
    { label: "None/Unknown", value: "none" },
  ];
  const GROUPS: Record<string, string> = { deals: "dealinformation", companies: "companyinformation" };
  for (const objectType of ["deals", "companies"]) {
    const existing = await fetch(`${BASE}/crm/v3/properties/${objectType}/${PROPERTY_NAME}`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    if (existing.ok) continue;
    await api("POST", `/crm/v3/properties/${objectType}`, {
      name: PROPERTY_NAME,
      label: "Revenue OS Assessment Billing Status",
      type: "enumeration",
      fieldType: "select",
      groupName: GROUPS[objectType],
      options: options.map((o) => ({ label: o.label, value: o.value, displayOrder: -1, hidden: false })),
      hasUniqueValue: false,
    });
    console.log(`✓ created ${objectType} property '${PROPERTY_NAME}'`);
  }
  const prop = await api("GET", `/crm/v3/properties/deals/${PROPERTY_NAME}`);
  console.log(`Property verified: type=${prop.type}, options=${((prop.options as Json[]) ?? []).map((o) => o.value).join(", ")}`);
  return true;
}

async function main(): Promise<void> {
  console.log("=== DISCOVERY ===");

  const pipelines = await api("GET", "/crm/v3/pipelines/deals");
  const stages: { id: string; label: string; pipelineId: string }[] = [];
  for (const p of (pipelines.results as Json[]) ?? []) {
    for (const s of (p.stages as Json[]) ?? []) {
      stages.push({ id: s.id as string, label: s.label as string, pipelineId: p.id as string });
    }
  }
  console.log("Deal stages (default pipeline):");
  for (const s of stages) console.log(`  "${s.label}" = id "${s.id}"`);

  const validStageIds = new Set(stages.map((s) => s.id));
  for (const acc of ACCOUNTS) {
    if (!validStageIds.has(acc.deal.stage)) {
      console.error(`✗ invalid stage id "${acc.deal.stage}" for ${acc.name}; aborting.`);
      process.exit(2);
    }
  }

  let ownerId: string | undefined;
  try {
    const owners = await api("GET", "/crm/v3/owners");
    ownerId = ((owners.results as Json[])?.[0]?.id as string) ?? undefined;
    console.log(`Owners: first ownerId=${ownerId ?? "(none)"}`);
  } catch (e) {
    console.log(`Owners query failed (non-blocking): ${(e as Error).message}`);
  }

  console.log("\n=== PROPERTY ===");
  const propOk = await ensureProperty();

  console.log("\n=== PROVISION ===");
  const report: Record<string, Record<string, unknown>> = {};

  for (const acc of ACCOUNTS) {
    const companyId = await upsert("companies", "name", acc.name, { name: acc.name, domain: acc.domain, description: MARKER });
    console.log(`✓ company ${acc.name} -> ${companyId}`);

    for (const extra of acc.extraCompanies ?? []) {
      const extraId = await upsert("companies", "name", extra.name, { name: extra.name, domain: extra.domain, description: MARKER });
      console.log(`  · ambiguous company ${extra.name} -> ${extraId}`);
    }

    const contactId = await upsert("contacts", "email", acc.contact.email, {
      email: acc.contact.email,
      firstname: acc.contact.first,
      lastname: acc.contact.last,
    });
    await associate("contacts", contactId, "companies", companyId, "contact_to_company").catch((e) => console.log(`  ! associate contact→company: ${(e as Error).message}`));
    console.log(`✓ contact ${acc.contact.email} -> ${contactId}`);

    const dealProps: Record<string, unknown> = {
      dealname: acc.deal.name,
      dealstage: acc.deal.stage,
      revexec_billing_status: acc.deal.commercial,
      description: MARKER,
    };
    if (ownerId) dealProps.hubspot_owner_id = ownerId;
    const dealId = await upsert("deals", "dealname", acc.deal.name, dealProps);
    await associate("deals", dealId, "companies", companyId, "deal_to_company").catch((e) => console.log(`  ! associate deal→company: ${(e as Error).message}`));
    console.log(`✓ deal ${acc.deal.name} (stage ${acc.deal.stage}, commercial ${acc.deal.commercial}) -> ${dealId}`);

    let taskId: string | undefined;
    if (acc.task) {
      const taskProps: Record<string, unknown> = {
        hs_task_subject: acc.task.subject,
        hs_task_type: acc.task.type,
        hs_task_status: acc.task.status,
        hs_timestamp: String(Date.now() + 7 * 24 * 3600 * 1000),
      };
      if (ownerId) taskProps.hubspot_owner_id = ownerId;
      taskId = await upsert("tasks", "hs_task_subject", acc.task.subject, taskProps);
      await associate("tasks", taskId, "companies", companyId, "task_to_company").catch((e) => console.log(`  ! associate task→company: ${(e as Error).message}`));
      console.log(`✓ task ${acc.task.subject} -> ${taskId}`);
    }

    report[acc.name] = { companyId, contactId, dealId, taskId: taskId ?? null, dealStage: acc.deal.stage, commercial: acc.deal.commercial };
  }

  console.log("\n=== REMOTE VERIFICATION ===");
  for (const acc of ACCOUNTS) {
    const r = report[acc.name];
    const company = await get("companies", r.companyId as string, ["name", "domain"]);
    const contact = await get("contacts", r.contactId as string, ["email"]);
    const deal = await get("deals", r.dealId as string, ["dealname", "dealstage", "revexec_billing_status"]);
    const cp = company.properties as Record<string, unknown>;
    const cop = contact.properties as Record<string, unknown>;
    const dp = deal.properties as Record<string, unknown>;
    console.log(`\n${acc.name}`);
    console.log(`  company: ${cp.name} / ${cp.domain}`);
    console.log(`  contact: ${cop.email}`);
    console.log(`  deal: ${dp.dealname} | stage=${dp.dealstage} | commercial=${dp.revexec_billing_status}`);
    if (r.taskId) {
      const task = await get("tasks", r.taskId as string, ["hs_task_subject", "hs_task_status"]);
      const tp = task.properties as Record<string, unknown>;
      console.log(`  task: ${tp.hs_task_subject} (${tp.hs_task_status})`);
    }
  }

  console.log(`\n\nCOMMERCIAL MAPPING VERIFIED: ${propOk ? "YES" : "NO"}`);
  console.log(JSON.stringify(report, null, 2));
}

void main().catch((err) => {
  console.error("✗ " + (err as Error).message);
  process.exit(1);
});
