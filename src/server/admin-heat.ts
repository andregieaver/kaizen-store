import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { ADMIN_HEAT_STORE } from "@/lib/admin-heat";
import { isMeasuredScreen } from "@/lib/admin-screens";
import { CELL_KEEP_DAYS, HEAT_KEEP_DAYS } from "@/lib/page-heat";
import { storeDayKey } from "@/lib/visit-hash";

import { adminSignalsFor } from "./admin-signals";
import { log } from "./log";
import { cellRows, CELL_SUMS, HEAT_DAY_SUMS, heatCells, heatFigures, heatInput } from "./page-heat";
import { col, typedRow } from "./typed-rows";

/**
 * Admin heatmaps (D895 phase 3b, `docs/dpia-admin-use.md` section 2): the only writer of `commerce.platform_admin_heat_days` and
 * `commerce.platform_admin_click_cells`. A screen view's summary, in the storefront heatmaps' own shape (`heatInput`), is added to its
 * screen's daily totals; the person, their store and the address are never kept. Kept only while the switch is open, from a signed-in
 * store owner whose latest choice under the current notice allows heatmaps, for a screen on the allow-list (`isMeasuredScreen()`).
 */

export type AdminHeatOutcome = { recorded: true } | { recorded: false; reason: "invalid" | "not_allowed" | "not_measured" };

const DELETED = z.object({ n: col.int });

/** Adds one screen view's summary to the day's totals for `accountId`, or says why not. */
export async function recordAdminHeat({ accountId, body, now = new Date() }: { accountId: string; body: unknown; now?: Date }): Promise<AdminHeatOutcome> {
  const parsed = heatInput.safeParse(body);
  if (!parsed.success || parsed.data.store !== ADMIN_HEAT_STORE || parsed.data.ab.length > 0) return { recorded: false, reason: "invalid" };
  const input = parsed.data;
  if (!isMeasuredScreen(input.path)) return { recorded: false, reason: "not_measured" };
  const { eligible, choice } = await adminSignalsFor(accountId);
  if (!eligible || !choice?.heatmaps) return { recorded: false, reason: "not_allowed" };

  const day = storeDayKey(now, PLATFORM_TIME_ZONE);
  const f = heatFigures(input);
  await db().execute(sql`
    insert into commerce.platform_admin_heat_days as h
      (day, screen, device, views, reach, fold_sum, attention_ms, att_height_sum, clicks, dead_clicks, rage_clicks, dead_views, rage_views, frustrated_views)
    values (${day}::date, ${input.path}, ${input.device}, ${f.views}, ${f.reach}::int[], ${f.fold}, ${f.att}::bigint[], ${f.attH},
      ${f.clicks}, ${f.dead}, ${f.rage}, ${input.dv}, ${input.rv}, ${input.fv})
    on conflict (day, screen, device) do update set ${HEAT_DAY_SUMS}
  `);
  const k = heatCells(input.clicks);
  if (!k) return { recorded: true };
  await db().execute(sql`
    insert into commerce.platform_admin_click_cells as c (day, screen, device, anchor, cx, cy, clicks, dead, rage)
    select ${day}::date, ${input.path}, ${input.device}, k.anchor, k.cx, k.cy, k.clicks, k.dead, k.rage
    from ${cellRows(k)}
    order by k.anchor, k.cx, k.cy
    on conflict (day, screen, device, anchor, cx, cy) do update set ${CELL_SUMS}
  `);
  return { recorded: true };
}

/** Deletes admin heat totals older than 13 months and click cells older than 90 days, as the stores' are; never throws. */
export async function pruneAdminHeat(now: Date = new Date()): Promise<{ days: number; cells: number }> {
  try {
    const days = await typedRow(DELETED, sql`
      with d as (delete from commerce.platform_admin_heat_days where day < (${now.toISOString()}::timestamptz - make_interval(days => ${HEAT_KEEP_DAYS}))::date returning 1)
      select count(*)::int as n from d
    `);
    const cells = await typedRow(DELETED, sql`
      with d as (delete from commerce.platform_admin_click_cells where day < (${now.toISOString()}::timestamptz - make_interval(days => ${CELL_KEEP_DAYS}))::date returning 1)
      select count(*)::int as n from d
    `);
    return { days: days?.n ?? 0, cells: cells?.n ?? 0 };
  } catch (error) {
    log("warn", "admin_heat.prune_failed", {}, error);
    return { days: 0, cells: 0 };
  }
}
