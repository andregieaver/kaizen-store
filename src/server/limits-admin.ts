import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { isLimitKey, type LimitCell, type LimitKey } from "@/lib/limits";

import { audit, type Account } from "./auth";
import { forgetLimits } from "./limits";

/**
 * The platform admin's editing of limits (D314, `docs/capacity.md` step 2.6): the plans' limits and the default, and overrides for one
 * store or one owner. The only writer of `commerce.plan_limits` and `commerce.limit_overrides`; every change is in the platform's
 * activity log with ids and numbers only. The instance that changes them forgets them at once; others follow within a minute.
 */

type Row = Record<string, unknown>;

export type LimitGrid = { plans: { id: string; name: string }[]; cells: Record<string, Partial<Record<LimitKey, number | null>>> };

/** Every active plan's limits and the default (key `default`), as stored: a key with no row is absent. */
export async function limitGrid(): Promise<LimitGrid> {
  const [plans, rows] = await Promise.all([
    db().execute<Row>(sql`select id, name from commerce.plans where active order by position, name`),
    db().execute<Row>(sql`select plan_id, key, value from commerce.plan_limits`),
  ]);
  const cells: LimitGrid["cells"] = { default: {} };
  for (const plan of plans) cells[String(plan.id)] = {};
  for (const row of rows) {
    const plan = row.plan_id ? String(row.plan_id) : "default";
    if (!cells[plan] || !isLimitKey(row.key)) continue;
    cells[plan][row.key] = row.value == null ? null : Number(row.value);
  }
  return { plans: plans.map((p) => ({ id: String(p.id), name: String(p.name) })), cells };
}

/** Writes the cells that changed; returns how many did. */
export async function savePlanLimits(admin: Account, cells: readonly { planId: string | null; key: LimitKey; cell: LimitCell }[]): Promise<number> {
  const before = await limitGrid();
  let changed = 0;
  await db().transaction(async (tx) => {
    for (const { planId, key, cell } of cells) {
      const stored = before.cells[planId ?? "default"];
      if (!stored) continue;
      const had = key in stored ? { value: stored[key] ?? null } : undefined;
      const wanted = cell.kind === "unset" ? undefined : { value: cell.kind === "unlimited" ? null : cell.value };
      if ((had === undefined && wanted === undefined) || (had && wanted && had.value === wanted.value)) continue;
      if (wanted === undefined) {
        await tx.execute(sql`delete from commerce.plan_limits where plan_id is not distinct from ${planId}::uuid and key = ${key}`);
      } else {
        await tx.execute(sql`
          insert into commerce.plan_limits (plan_id, key, value, updated_by) values (${planId}::uuid, ${key}, ${wanted.value}, ${admin.id}::uuid)
          on conflict (plan_id, key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = now()`);
      }
      changed++;
      await audit(admin.id, null, "platform.plan_limit_changed", { plan: planId, key, before: had ? had.value : "unset", after: wanted ? wanted.value : "unset" });
    }
  });
  if (changed > 0) forgetLimits();
  return changed;
}

export type LimitOverride = { id: string; key: LimitKey; value: number | null; reason: string; expiresAt: string | null };

/** A store's overrides, ended ones too (they show as ended). */
export async function storeOverrides(storeId: string): Promise<LimitOverride[]> {
  const rows = await db().execute<Row>(sql`select id, key, value, reason, expires_at from commerce.limit_overrides where store_id = ${storeId}::uuid order by key`);
  return rows.filter((r) => isLimitKey(r.key)).map((r) => ({
    id: String(r.id),
    key: r.key as LimitKey,
    value: r.value == null ? null : Number(r.value),
    reason: String(r.reason),
    expiresAt: r.expires_at ? new Date(String(r.expires_at)).toISOString() : null,
  }));
}

export type OverrideTarget = { storeId: string } | { accountId: string };

/** Sets (or replaces) an override for one store or one owner account. */
export async function setLimitOverride(admin: Account, target: OverrideTarget, key: LimitKey, value: number | null, reason: string, expiresAt: Date | null): Promise<void> {
  const storeId = "storeId" in target ? target.storeId : null;
  const accountId = "accountId" in target ? target.accountId : null;
  await db().execute(sql`
    insert into commerce.limit_overrides (store_id, account_id, key, value, reason, expires_at, created_by)
    values (${storeId}::uuid, ${accountId}::uuid, ${key}, ${value}, ${reason.trim().slice(0, 300)}, ${expiresAt?.toISOString() ?? null}::timestamptz, ${admin.id}::uuid)
    on conflict (store_id, account_id, key) do update
      set value = excluded.value, reason = excluded.reason, expires_at = excluded.expires_at, created_by = excluded.created_by, created_at = now()
  `);
  await audit(admin.id, storeId, "platform.limit_override_set", { key, value, ends: expiresAt?.toISOString() ?? null, ...(accountId ? { account: accountId } : {}) });
  forgetLimits(storeId ?? undefined);
}

/** Removes a store's override. */
export async function removeLimitOverride(admin: Account, storeId: string, id: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`delete from commerce.limit_overrides where store_id = ${storeId}::uuid and id = ${id}::uuid returning key`);
  if (rows.length === 0) return false;
  await audit(admin.id, storeId, "platform.limit_override_removed", { key: String(rows[0].key) });
  forgetLimits(storeId);
  return true;
}
