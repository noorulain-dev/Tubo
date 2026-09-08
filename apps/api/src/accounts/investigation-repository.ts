import { getPool } from "../database/db.js";
import type { InvestigationOutcome, InvestigationResult, InvestigationTraceStep } from "./investigation.js";

export async function saveInvestigation(userId: string, result: InvestigationResult): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO finding_investigations (user_id, finding_id, outcome, trace, started_at, finished_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,$6)`,
    [userId, result.findingId, result.outcome, JSON.stringify(result.trace), result.startedAt, result.finishedAt],
  );
  // A rejected investigation resolves the finding so it no longer drives proposals.
  if (result.outcome === "rejected") {
    await pool.query(
      "UPDATE risk_findings SET status = 'resolved', resolved_at = now(), updated_at = now() WHERE finding_id = $1 AND user_id = $2",
      [result.findingId, userId],
    );
  }
}

export async function listInvestigations(userId: string, findingId: string): Promise<InvestigationResult[]> {
  const pool = getPool();
  const res = await pool.query(
    "SELECT finding_id, outcome, trace, started_at, finished_at FROM finding_investigations WHERE user_id = $1 AND finding_id = $2 ORDER BY id DESC",
    [userId, findingId],
  );
  return (res.rows as Record<string, unknown>[]).map((r) => ({
    findingId: String(r.finding_id),
    outcome: String(r.outcome) as InvestigationOutcome,
    trace: (r.trace as InvestigationTraceStep[]) ?? [],
    budget: { used: ((r.trace as InvestigationTraceStep[]) ?? []).length, max: 0 },
    startedAt: new Date(r.started_at as string).toISOString(),
    finishedAt: new Date(r.finished_at as string).toISOString(),
  }));
}