import { getPool } from "../database/db.js";
import type { Finding, FindingStatus, FindingType, Severity } from "./risk-scanner.js";

function rowToFinding(r: Record<string, unknown>): Finding {
  return {
    findingId: String(r.finding_id),
    userId: String(r.user_id),
    accountId: String(r.account_id),
    type: String(r.type) as FindingType,
    severity: String(r.severity) as Severity,
    title: String(r.title),
    description: (r.description as string) ?? "",
    evidence: (r.evidence as string[]) ?? [],
    sourceReferences: (r.source_references as string[]) ?? [],
    signals: (r.signals as { signal: string; value: string | number }[]) ?? [],
    needsInvestigation: Boolean(r.needs_investigation),
    status: String(r.status) as FindingStatus,
    createdAt: new Date(r.created_at as string).toISOString(),
    updatedAt: new Date(r.updated_at as string).toISOString(),
    resolvedAt: r.resolved_at ? new Date(r.resolved_at as string).toISOString() : null,
  };
}

export async function listFindings(userId: string, accountId: string): Promise<Finding[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT * FROM risk_findings WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC",
    [userId, accountId],
  );
  return (res.rows as Record<string, unknown>[]).map(rowToFinding);
}

export async function getFinding(userId: string, findingId: string): Promise<Finding | undefined> {
  const pool = getPool();
  const res = await pool.query("SELECT * FROM risk_findings WHERE user_id = $1 AND finding_id = $2", [userId, findingId]);
  const row = res.rows[0] as Record<string, unknown> | undefined;
  return row ? rowToFinding(row) : undefined;
}

export async function persistFindings(userId: string, accountId: string, findings: Finding[]): Promise<void> {
  const pool = getPool();
  for (const f of findings) {
    await pool.query(
      `INSERT INTO risk_findings (finding_id, user_id, account_id, type, severity, title, description, evidence, source_references, signals, needs_investigation, status, created_at, updated_at, resolved_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12,$13,$14,$15)
       ON CONFLICT (finding_id) DO UPDATE SET
         severity = EXCLUDED.severity, title = EXCLUDED.title, description = EXCLUDED.description,
         evidence = EXCLUDED.evidence, source_references = EXCLUDED.source_references,
         signals = EXCLUDED.signals, needs_investigation = EXCLUDED.needs_investigation,
         status = EXCLUDED.status, updated_at = EXCLUDED.updated_at, resolved_at = EXCLUDED.resolved_at`,
      [
        f.findingId,
        userId,
        accountId,
        f.type,
        f.severity,
        f.title,
        f.description,
        JSON.stringify(f.evidence),
        JSON.stringify(f.sourceReferences),
        JSON.stringify(f.signals),
        f.needsInvestigation,
        f.status,
        f.createdAt,
        f.updatedAt,
        f.resolvedAt,
      ],
    );
  }
}