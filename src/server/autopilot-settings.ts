import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { autonomySettingsSchema, CUSTOMER_EMAIL_TOOLS, readAutonomy, type AutonomySettings } from "@/lib/autopilot-autonomy";
import { can, type PermissionHolder } from "@/lib/permissions";

import { costMicrosSql, priceFor, unpricedSql } from "./ai-price-sql";
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
    z.object({ paused: col.bool, levels: z.unknown(), budgets: z.unknown(), planning: z.unknown() }),
    sql`select paused, levels, budgets, planning from commerce.autopilot_settings where ${inScope(storeId)}`,
  );
  return row ? readAutonomy({ paused: row.paused, levels: row.levels, budgets: row.budgets, planning: row.planning }) : readAutonomy({});
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
    insert into commerce.autopilot_settings (store_id, paused, levels, budgets, planning, updated_by, updated_at)
    values (${storeId}, ${s.paused}, ${JSON.stringify(s.levels)}::jsonb, ${JSON.stringify(s.budgets)}::jsonb, ${JSON.stringify(s.planning)}::jsonb, ${a.account.id}::uuid, now())
    on conflict (store_id) do update set paused = excluded.paused, levels = excluded.levels, budgets = excluded.budgets,
      planning = excluded.planning, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(a.account.id, a.store?.id ?? null, "ai.autopilot_settings", { paused: s.paused, levels: s.levels, budgets: s.budgets, planning: s.planning }, auditArea(a));
  return s;
}

/**
 * The autopilot's AI cost this calendar month (UTC), in millionths of a dollar, at the prices in force for each call (D145): every call it made,
 * whatever the feature (`acted_by`, written from `currentActor()`; pictures, page looks and builds its steps asked for run as it too), and the
 * calls no price covers, which the sum cannot hold.
 */
export async function autopilotCostThisMonth(storeId: string | null): Promise<{ micros: number; unpriced: number }> {
  const row = await typedRow(
    z.object({ cost: col.minor, unpriced: col.int }),
    sql`
      select coalesce(sum(${costMicrosSql}), 0)::bigint as cost, count(*) filter (where ${unpricedSql})::int as unpriced
      from commerce.ai_usage u
      ${priceFor}
      where ${storeId ? sql`u.store_id = ${storeId}::uuid` : sql`u.store_id is null`} and (u.feature = 'autopilot' or u.acted_by = 'autopilot')
        and u.created_at >= date_trunc('month', now())
    `,
  );
  return { micros: row?.cost ?? 0, unpriced: row?.unpriced ?? 0 };
}

/**
 * Why the month's budget stops the autopilot, or null: spent, or a call no price covers (its cost cannot be added, so the budget cannot be
 * kept). A budget of null has no limit of its own.
 */
export async function aiBudgetProblem(storeId: string | null, settings: AutonomySettings): Promise<string | null> {
  if (settings.budgets.aiMonthlyUsd === null) return null;
  const { micros, unpriced } = await autopilotCostThisMonth(storeId);
  if (unpriced > 0) {
    return `The autopilot made ${unpriced === 1 ? "an AI call" : `${unpriced} AI calls`} this month that no price covers, so its budget cannot be kept: a platform admin adds the model's price under Platform, AI, Prices, or you set no AI budget under Autopilot, Settings.`;
  }
  if (micros >= settings.budgets.aiMonthlyUsd * 1_000_000) {
    return "The autopilot's AI budget for this month is spent: raise it under Autopilot, Settings, or wait for next month.";
  }
  return null;
}

/** Whether the month's budget stops the autopilot (`aiBudgetProblem()`). */
export async function aiBudgetSpent(storeId: string | null, settings: AutonomySettings): Promise<boolean> {
  return (await aiBudgetProblem(storeId, settings)) !== null;
}

/** Emails to customers the autopilot sent itself in the last seven days (`CUSTOMER_EMAIL_TOOLS`, counted from the audit log). */
export async function autopilotCustomerEmailsThisWeek(storeId: string): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`
      select count(*)::int as n from commerce.audit_log
      where store_id = ${storeId}::uuid and acted_by = 'autopilot' and created_at > now() - interval '7 days'
        and action in (${sql.join(
          CUSTOMER_EMAIL_TOOLS.map((tool) => sql`${`store.assistant.${tool}`}`),
          sql`, `,
        )})
    `,
  );
  return row?.n ?? 0;
}
