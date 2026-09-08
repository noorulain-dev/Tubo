import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

const PROPERTY_NAME = "revexec_billing_status";
const PROPERTY_LABEL = "Revenue OS Assessment Billing Status";

for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
  loadDotenv({ path: p });
}

const VALUES = [
  { label: "Active", value: "active" },
  { label: "Trialing", value: "trialing" },
  { label: "Past Due", value: "past_due" },
  { label: "Cancelled", value: "cancelled" },
  { label: "None/Unknown", value: "none" },
];

async function main(): Promise<void> {
  if (process.env.ALLOW_ASSESSMENT_SETUP !== "true") {
    process.stderr.write("✗ set ALLOW_ASSESSMENT_SETUP=true to run assessment setup (opt-in).\n");
    process.exit(2);
  }
  const token = process.env.HUBSPOT_ACCESS_TOKEN;
  const base = (process.env.HUBSPOT_BASE_URL ?? "https://api.hubapi.com").replace(/\/$/, "");
  if (!token) {
    process.stderr.write("✗ HUBSPOT_ACCESS_TOKEN is required.\n");
    process.exit(1);
  }

  for (const objectType of ["deals", "companies"] as const) {
    const existing = await fetch(`${base}/crm/v3/properties/${objectType}/${PROPERTY_NAME}`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (existing.ok) {
      console.log(`✓ ${objectType} property '${PROPERTY_NAME}' already exists`);
      continue;
    }

    const create = await fetch(`${base}/crm/v3/properties/${objectType}`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        name: PROPERTY_NAME,
        label: PROPERTY_LABEL,
        type: "enumeration",
        fieldType: "select",
        groupName: "revenue_os_assessment",
        options: VALUES.map((o) => ({ label: o.label, value: o.value, displayOrder: -1, hidden: false })),
        hasUniqueValue: false,
      }),
    });
    if (create.ok) {
      console.log(`✓ created ${objectType} property '${PROPERTY_NAME}'`);
    } else {
      const body = await create.text().catch(() => "");
      console.log(`✗ could not create ${objectType} property (${create.status}). ${body.slice(0, 200)}`);
    }
  }

  console.log("\nManual fallback (if auto-create failed):");
  console.log(`  In HubSpot → Settings → Objects → Deals → Properties, create an enumeration property named`);
  console.log(`  "${PROPERTY_NAME}" (label "${PROPERTY_LABEL}") with options: Active, Trialing, Past Due, Cancelled, None/Unknown.`);
  console.log("  Then set this property on your synthetic test Deal/Company.");
}

void main();