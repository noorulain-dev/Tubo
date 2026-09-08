import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";
import { ensureSchema, getPool } from "./db.js";
import { appendAccountEvent, type AccountEventType } from "./account-intelligence.js";

/**
 * STEP 58 — SAFE Assessment Test Data provisioning for the ONE real application.
 *
 * There is NO user-facing Sample Mode. The app uses real auth/DB/AI/integrations;
 * only the business records used for evaluation are synthetic, and every one of
 * them is unmistakably tagged `[ASSESSMENT]`.
 *
 * Provisioning requires explicit opt-in (ALLOW_ASSESSMENT_SETUP=true) plus an
 * exact test user (ASSESSMENT_USER_EMAIL) and, when touching HubSpot, the target
 * portal id (ASSESSMENT_HUBSPOT_PORTAL_ID). It never deletes arbitrary CRM
 * records, never modifies unknown deals, never sends email, and never touches
 * production customers.
 */

export const ASSESSMENT_PREFIX = "[ASSESSMENT]";

export interface ScenarioEvent {
  eventType: AccountEventType;
  occurredAt: string;
  source: string;
  payload: Record<string, unknown>;
  provenance: string;
}

export interface Scenario {
  slug: string;
  name: string;
  accountId: string;
  description: string;
  /** Whether this scenario maps to a live/seeded account (vs an automated test fixture). */
  seedable: boolean;
  events: ScenarioEvent[];
}

function commitment(action: string, opts: { id?: string; owner?: string | null; resolution?: string; deadlineValue?: string | null; deadlineKind?: string } = {}) {
  return {
    id: opts.id,
    action,
    owner: opts.owner ?? null,
    resolution: opts.resolution ?? "resolved",
    deadline:
      opts.deadlineValue !== undefined || opts.deadlineKind
        ? { text: "deadline", kind: opts.deadlineKind ?? "exact", value: opts.deadlineValue ?? null, resolution: opts.deadlineKind === "ambiguous" ? "ambiguous" : "resolved" }
        : null,
    evidence: [],
  };
}

export const SCENARIOS: Scenario[] = [
  {
    slug: "acme-security-blocker",
    name: "ACME SECURITY BLOCKER",
    accountId: `${ASSESSMENT_PREFIX} ACME Security Blocker`,
    description: "Trial near completion, security-doc commitment open/overdue, customer waiting, task missing.",
    seedable: true,
    events: [
      {
        eventType: "crm_state_observed",
        occurredAt: "2026-08-25T10:00:00Z",
        source: "hubspot",
        payload: { stage: "Trial", identity: { name: "ACME Security Blocker", companyId: `${ASSESSMENT_PREFIX} acme` } },
        provenance: "assessment",
      },
      {
        eventType: "meeting_processed",
        occurredAt: "2026-08-26T10:00:00Z",
        source: "manual",
        payload: {
          semantic: {
            confirmedCommitments: [commitment("Send security documentation", { id: "c1", owner: "Alex", deadlineValue: "2026-08-28T00:00:00Z" })],
          },
        },
        provenance: "assessment",
      },
    ],
  },
  {
    slug: "helio-conversion",
    name: "HELIO CONVERSION",
    accountId: `${ASSESSMENT_PREFIX} Helio Conversion`,
    description: "HubSpot deal Trial, commercial ACTIVE, buying intent — expect stale CRM mismatch.",
    seedable: true,
    events: [
      {
        eventType: "crm_state_observed",
        occurredAt: "2026-09-01T10:00:00Z",
        source: "hubspot",
        payload: { stage: "Trial", identity: { name: "Helio Conversion", companyId: `${ASSESSMENT_PREFIX} helio` } },
        provenance: "assessment",
      },
      {
        eventType: "commercial_state_observed",
        occurredAt: "2026-09-01T10:05:00Z",
        source: "commercial",
        payload: { status: "active" },
        provenance: "hubspot_property_mapping:deal:revexec_billing_status",
      },
      {
        eventType: "meeting_processed",
        occurredAt: "2026-09-02T10:00:00Z",
        source: "manual",
        payload: { semantic: { commercialSignals: [{ kind: "intent", text: "we want to buy", resolution: "resolved", evidence: [] }] } },
        provenance: "assessment",
      },
    ],
  },
  {
    slug: "nexora-question",
    name: "NEXORA QUESTION",
    accountId: `${ASSESSMENT_PREFIX} Nexora Question`,
    description: 'Customer asked "Does SSO support Okta?" and the question is still open.',
    seedable: true,
    events: [
      {
        eventType: "meeting_processed",
        occurredAt: "2026-09-03T10:00:00Z",
        source: "manual",
        payload: { semantic: { questions: [{ id: "q1", text: "Does SSO support Okta?" }] } },
        provenance: "assessment",
      },
    ],
  },
  {
    slug: "orbit-aligned",
    name: "ORBIT ALIGNED",
    accountId: `${ASSESSMENT_PREFIX} Orbit Aligned`,
    description: "Commitment exists, matching task completed, delivery evidence — no action needed.",
    seedable: true,
    events: [
      {
        eventType: "meeting_processed",
        occurredAt: "2026-09-01T10:00:00Z",
        source: "manual",
        payload: { semantic: { confirmedCommitments: [commitment("Send renewal quote", { id: "c1", owner: "Alex" })] } },
        provenance: "assessment",
      },
      { eventType: "task_created", occurredAt: "2026-09-01T11:00:00Z", source: "hubspot", payload: { taskId: `${ASSESSMENT_PREFIX} orbit_task_1`, commitmentId: "c1" }, provenance: "assessment" },
      { eventType: "task_completed", occurredAt: "2026-09-02T09:00:00Z", source: "hubspot", payload: { taskId: `${ASSESSMENT_PREFIX} orbit_task_1` }, provenance: "assessment" },
      { eventType: "email_observed", occurredAt: "2026-09-02T10:00:00Z", source: "gmail", payload: { commitmentId: "c1", delivered: true, reference: `${ASSESSMENT_PREFIX} msg_1` }, provenance: "assessment" },
    ],
  },
  {
    slug: "vantage-ambiguous",
    name: "VANTAGE AMBIGUOUS",
    accountId: `${ASSESSMENT_PREFIX} Vantage Ambiguous`,
    description: '"Sarah might be able to send pricing next week" — owner and date remain ambiguous.',
    seedable: true,
    events: [
      {
        eventType: "meeting_processed",
        occurredAt: "2026-09-04T10:00:00Z",
        source: "manual",
        payload: {
          semantic: {
            confirmedCommitments: [commitment("Send pricing", { id: "c1", owner: null, resolution: "ambiguous", deadlineKind: "ambiguous" })],
          },
        },
        provenance: "assessment",
      },
    ],
  },
  {
    slug: "provider-failure",
    name: "PROVIDER FAILURE TEST",
    accountId: `${ASSESSMENT_PREFIX} Provider Failure`,
    description: "Automated test fixture only — do not deliberately break a real evaluator account.",
    seedable: false,
    events: [],
  },
  {
    slug: "prompt-injection",
    name: "PROMPT INJECTION TEST",
    accountId: `${ASSESSMENT_PREFIX} Prompt Injection`,
    description: "Synthetic transcript/note content attempting to override system policy (data, not instructions).",
    seedable: false,
    events: [],
  },
];

export function initAssessmentEnv(): void {
  for (const p of [resolve(process.cwd(), ".env"), resolve(process.cwd(), "../../.env")]) {
    loadDotenv({ path: p });
  }
}

export function validateOptIn(): { email: string; hubspotPortalId: string | undefined } {
  if (process.env.ALLOW_ASSESSMENT_SETUP !== "true") {
    throw new Error("ALLOW_ASSESSMENT_SETUP=true is required (explicit opt-in).");
  }
  const email = process.env.ASSESSMENT_USER_EMAIL?.trim().toLowerCase();
  if (!email) {
    throw new Error("ASSESSMENT_USER_EMAIL is required (the exact test user).");
  }
  return { email, hubspotPortalId: process.env.ASSESSMENT_HUBSPOT_PORTAL_ID?.trim() || undefined };
}

export async function resolveAssessmentUserId(email: string): Promise<string> {
  await ensureSchema();
  const pool = getPool();
  const res = await pool.query("SELECT id FROM users WHERE email = $1", [email]);
  const id = res.rows[0]?.id as string | undefined;
  if (!id) throw new Error(`no user found for ASSESSMENT_USER_EMAIL=${email}. Sign up/register that user first.`);
  return id;
}

export async function seedScenarios(userId: string): Promise<{ scenario: string; accountId: string; events: number }[]> {
  const results: { scenario: string; accountId: string; events: number }[] = [];
  for (const s of SCENARIOS) {
    if (!s.seedable) continue;
    for (let i = 0; i < s.events.length; i++) {
      const e = s.events[i];
      await appendAccountEvent({
        userId,
        accountId: s.accountId,
        eventType: e.eventType,
        occurredAt: e.occurredAt,
        source: e.source,
        sourceReference: `${ASSESSMENT_PREFIX} ${s.slug}:${i}`,
        payload: e.payload,
        provenance: e.provenance,
        idempotencyKey: `assessment:${s.slug}:${i}`,
      });
    }
    results.push({ scenario: s.name, accountId: s.accountId, events: s.events.length });
  }
  return results;
}

export async function cleanupAssessment(userId: string): Promise<{ table: string; deleted: number }[]> {
  const pool = getPool();
  const results: { table: string; deleted: number }[] = [];
  const tables = ["account_events", "account_intelligence", "risk_findings", "execution_plans", "review_state", "finding_investigations"];
  for (const table of tables) {
    const column = table === "finding_investigations" ? "finding_id" : "account_id";
    let res;
    if (table === "finding_investigations") {
      // Only findings belonging to assessment accounts (tagged via their finding_id is not enough; scope by user + non-assessment).
      // Findings are removed above via risk_findings; skip cascade here for safety.
      res = { rowCount: 0 };
    } else {
      res = await pool.query(`DELETE FROM ${table} WHERE user_id = $1 AND ${column} LIKE $2`, [userId, `${ASSESSMENT_PREFIX}%`]);
    }
    results.push({ table, deleted: res.rowCount ?? 0 });
  }
  return results;
}
