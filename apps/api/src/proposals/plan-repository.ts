import { getPool } from "../database/db.js";
import type { ExecutionPlan } from "./execution-plans.js";

export async function savePlan(userId: string, plan: ExecutionPlan): Promise<void> {
  const pool = getPool();
  await pool.query(
    `INSERT INTO execution_plans (plan_id, user_id, account_id, plan, created_at, updated_at)
     VALUES ($1,$2,$3,$4::jsonb,$5,now())
     ON CONFLICT (plan_id) DO UPDATE SET plan = EXCLUDED.plan, updated_at = now()`,
    [plan.planId, userId, plan.accountId, JSON.stringify(plan), plan.createdAt],
  );
}

export async function getPlan(userId: string, planId: string): Promise<ExecutionPlan | undefined> {
  const pool = getPool();
  const res = await pool.query("SELECT plan FROM execution_plans WHERE user_id = $1 AND plan_id = $2", [userId, planId]);
  const row = res.rows[0] as { plan: ExecutionPlan } | undefined;
  return row?.plan;
}

export async function listPlans(userId: string, accountId: string): Promise<ExecutionPlan[]> {
  const pool = getPool();
  const res = await pool.query("SELECT plan FROM execution_plans WHERE user_id = $1 AND account_id = $2 ORDER BY created_at DESC", [userId, accountId]);
  return (res.rows as { plan: ExecutionPlan }[]).map((r) => r.plan);
}