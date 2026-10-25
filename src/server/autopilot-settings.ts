import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { autonomySettingsSchema, readAutonomy, type AutonomySettings } from "@/lib/autopilot-autonomy";
import { can, type PermissionHolder } from "@/lib/permissions";

import { costMicrosSql, priceFor } from "./ai-price-sql";
import { audit, type Account } from "./auth";
import { auditArea } from "./autopilot-goals";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The owner's autonomy levels and budgets for the autopilot (D309, `docs/ai-autopilot.md` 7.4), the only writer of
 * `commerce.autopilot_settings`: an owner of the store, or a platform admin for Kaizena Flow's own. A store with no row asks first for
 * everything (`DEFAULT_AUTONOMY`).
 */

const inScope = (storeId: string | null) => (storeId ? sql`store_id = ${storeId}::uuid` : sql`store_id is null`);

export async function autonomyFor(storeId: string | null): Promise<AutonomySettings> {
  const row = await typedRow(
    z.object({ paused: col.bool, levels: z.unknown(), budgets: z.unknown() }),
    sql`select paused, levels, budgets from commerce.autopilot_settings where ${inScope(storeId)}`,
  );
  return row ? readAutonomy({ paused: row.paused, levels: row.levels, budgets: row.budgets }) : readAutonomy({});
}

export type SettingsActor = { account: Account; store: Store | null; holder?: PermissionHolder };

/** Saves the levels and budgets as given (each read by the schema first); an owner's, or a platform admin's for the platform. */
export async function saveAutonomy(a: SettingsActor, input: unknown): Promise<AutonomySettings> {
  if (a.store && a.holder && !can(a.holder, "owner")) throw new OwnerToolError("Only an owner sets how far the autopilot may go.");
  if (!a.store && !a.account.platformAdmin) throw new OwnerToolError("Only a platform admin sets the autopilot for Kaizena Flow's own site.");
  const parsed = autonomySettingsSchema.safeParse(input);
  if (!parsed.success) throw new OwnerToolError(`The settings could not be read: ${parsed.error.issues.map((i) => i.path.join(".") || i.message).join(", ")}.`);
  const s = parsed.data;
  const storeId = a.store ? sql`${a.store.id}::uuid` : sql`null`;
  await db().execute(sql`
    insert into commerce.autopilot_settings (store_id, paused, levels, budgets, updated_by, updated_at)
    values (${storeId}, ${s.paused}, ${JSON.stringify(s.levels)}::jsonb, ${JSON.stringify(s.budgets)}::jsonb, ${a.account.id}::uuid, now())
    on conflict (store_id) do update set paused = excluded.paused, levels = excluded.levels, budgets = excluded.budgets,
      updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(a.account.id, a.store?.id ?? null, "ai.autopilot_settings", { paused: s.paused, levels: s.levels, budgets: s.budgets }, auditArea(a));
  return s;
}

/** The autopilot's AI cost this calendar month (UTC), in millionths of a dollar, at the prices in force for each call (D145). */
export async function autopilotCostThisMonth(storeId: string | null): Promise<number> {
  const row = await typedRow(
    z.object({ cost: col.minor }),
    sql`
      select coalesce(sum(${costMicrosSql}), 0)::bigint as cost
      from commerce.ai_usage u
      ${priceFor}
      where ${storeId ? sql`u.store_id = ${storeId}::uuid` : sql`u.store_id is null`} and u.feature = 'autopilot' and u.created_at >= date_trunc('month', now())
    `,
  );
  return row?.cost ?? 0;
}

/** Whether the month's budget is spent: a budget of null has no limit of its own. */
export async function aiBudgetSpent(storeId: string | null, settings: AutonomySettings): Promise<boolean> {
  if (settings.budgets.aiMonthlyUsd === null) return false;
  return (await autopilotCostThisMonth(storeId)) >= settings.budgets.aiMonthlyUsd * 1_000_000;
}
