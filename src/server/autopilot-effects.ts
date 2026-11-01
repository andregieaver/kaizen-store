import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { customPeriod, todayIn } from "@/lib/analytics-period";
import {
  effectsMonth,
  effectTarget,
  effectWindows,
  EFFECT_DAYS,
  EFFECT_LOOKBACK_DAYS,
  EFFECTS_PER_RUN,
  monthDays,
  toolOfAction,
  type Effect,
  type EffectsMonth,
} from "@/lib/autopilot-effects";
import { conversionFactor } from "@/lib/currency";
import { mainCurrency } from "@/lib/markets";

import { GIFT_CARD_LINE, PAID, dayOf, soldIn } from "./analytics-sql";
import { log } from "./log";
import { currentStore, type Store } from "./stores";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * What the autopilot's changes moved (D418, `src/lib/autopilot-effects.ts`): the only writer of `commerce.autopilot_effects`. Once an hour the
 * dispatcher measures a few of the changes the autopilot made itself two weeks or more ago and not measured yet, each once: the product's or the
 * store's sales over the days before and after it, and the store's beside them. Read back for the Autopilot page's *What the AI did*, the
 * monthly email and the autopilot's own reviews.
 */

const CANDIDATE = z.object({ id: col.int.or(z.string().transform(Number).pipe(col.int)), store_id: col.uuid, slug: col.text, action: col.text, args: z.unknown(), created_at: col.timestamp });

export type EffectRun = { measured: number; waiting: number; skipped: number };

/** The hourly part of the five-minute dispatcher (`runJobs()`): a few changes measured, each in its own try so one store cannot stop the rest. */
export async function measureAutopilotEffects(options: { now?: Date; limit?: number; everyRun?: boolean } = {}): Promise<EffectRun> {
  const now = options.now ?? new Date();
  const run: EffectRun = { measured: 0, waiting: 0, skipped: 0 };
  // Once an hour is enough: a change waits two weeks anyway.
  if (!options.everyRun && now.getUTCMinutes() >= 5) return run;
  const rows = await typedRows(
    CANDIDATE,
    sql`
      select a.id, a.store_id, s.slug, a.action, a.details -> 'args' as args, a.created_at
      from commerce.audit_log a join commerce.stores s on s.id = a.store_id
      where a.acted_by = 'autopilot' and a.action like 'store.assistant.%'
        and a.created_at < ${now.toISOString()}::timestamptz - make_interval(days => ${EFFECT_DAYS + 1})
        and a.created_at > ${now.toISOString()}::timestamptz - make_interval(days => ${EFFECT_LOOKBACK_DAYS})
        and not exists (select 1 from commerce.autopilot_effects e where e.audit_id = a.id)
        and commerce.store_is_active(a.store_id)
      order by a.created_at limit ${options.limit ?? EFFECTS_PER_RUN}
    `,
  );
  const stores = new Map<string, Store | null>();
  for (const row of rows) {
    try {
      if (!stores.has(row.slug)) stores.set(row.slug, await currentStore(row.slug));
      const store = stores.get(row.slug);
      const tool = toolOfAction(row.action);
      if (!store || !tool) {
        run.skipped++;
        continue;
      }
      const outcome = await measureOne(store, row.id, tool, row.args, row.created_at, now);
      run[outcome]++;
    } catch (error) {
      run.skipped++;
      log("error", "autopilot.effect_failed", { store: row.store_id, audit: row.id }, error);
    }
  }
  return run;
}

/** A product of the store by the reference the change gave (its id, handle or title), when exactly one matches. */
async function productOf(store: Store, ref: string): Promise<{ id: string; title: string } | null> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const rows = await typedRows(
    z.object({ id: col.uuid, title: col.text }),
    sql`
      select p.id, coalesce((select t.title from commerce.product_translations t where t.product_id = p.id and t.title <> ''
        order by t.locale = ${store.localization.locales[0] ?? ""} desc, t.locale limit 1), p.handle) as title
      from commerce.products p
      where p.store_id = ${store.id}::uuid
        and ${byId ? sql`p.id = ${ref}::uuid` : sql`(p.handle = ${ref} or exists (select 1 from commerce.product_translations t where t.product_id = p.id and lower(t.title) = lower(${ref})))`}
      limit 2
    `,
  );
  return rows.length === 1 ? rows[0] : null;
}

/**
 * What the goods sold for without VAT in a store period, gift cards left out, in the main currency, with the units; for one product or the whole
 * store. Null when a currency sold in has no rate to the main one.
 */
async function salesIn(store: Store, period: { from: string; to: string }, productId: string | null): Promise<{ minor: number; units: number } | null> {
  const product: SQL = productId
    ? sql`and exists (select 1 from commerce.product_variants v where v.store_id = ol.store_id and v.id = ol.variant_id and v.product_id = ${productId}::uuid)`
    : sql``;
  const rows = await typedRows(
    z.object({ currency: col.currency, net: col.minor, units: col.int }),
    sql`
      select o.currency, coalesce(sum(ol.total_minor - ol.tax_minor), 0)::bigint as net, coalesce(sum(ol.quantity), 0)::int as units
      from commerce.orders o join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      where o.store_id = ${store.id}::uuid and ${PAID} and ${soldIn(store, customPeriod(period.from, period.to))} and not ${GIFT_CARD_LINE} ${product}
      group by o.currency
    `,
  );
  const main = mainCurrency(store);
  let minor = 0;
  let units = 0;
  for (const r of rows) {
    const c = conversionFactor(r.currency, main, store.localization.rates);
    if (!c) return null;
    minor += Math.round(r.net * c.factor);
    units += r.units;
  }
  return { minor, units };
}

async function measureOne(store: Store, auditId: number, tool: string, args: unknown, actedAt: string, now: Date): Promise<"measured" | "waiting"> {
  const actedDay = todayIn(new Date(actedAt), store.timeZone);
  const windows = effectWindows(actedDay);
  if (todayIn(now, store.timeZone) < windows.measurableOn) return "waiting";
  const target = effectTarget(tool, args);
  const product = target.kind === "product" ? await productOf(store, target.ref) : null;
  const [before, after, storeBefore, storeAfter] = await Promise.all([
    product ? salesIn(store, windows.before, product.id) : null,
    product ? salesIn(store, windows.after, product.id) : null,
    salesIn(store, windows.before, null),
    salesIn(store, windows.after, null),
  ]);
  // A currency without a rate: tried again on a later run, until the lookback ends.
  if (!storeBefore || !storeAfter || (product && (!before || !after))) return "waiting";
  const own = product ? { before: before!, after: after! } : { before: storeBefore, after: storeAfter };
  await db().execute(sql`
    insert into commerce.autopilot_effects (audit_id, store_id, tool, target_kind, product_id, target_label, acted_at, days, currency,
      before_minor, after_minor, before_units, after_units, store_before_minor, store_after_minor)
    values (${auditId}, ${store.id}::uuid, ${tool}, ${product ? "product" : "store"}, ${product?.id ?? null}::uuid, ${product?.title.slice(0, 200) ?? ""},
      ${actedAt}::timestamptz, ${EFFECT_DAYS}, ${mainCurrency(store)}, ${own.before.minor}, ${own.after.minor},
      ${product ? own.before.units : null}, ${product ? own.after.units : null}, ${storeBefore.minor}, ${storeAfter.minor})
    on conflict (audit_id) do nothing
  `);
  return "measured";
}

const EFFECT = z.object({
  audit_id: col.int.or(z.string().transform(Number).pipe(col.int)),
  tool: col.text,
  target_kind: z.enum(["product", "store"]),
  target_label: col.text,
  acted_at: col.timestamp,
  currency: col.currency,
  before_minor: col.minor,
  after_minor: col.minor,
  before_units: col.int.nullable(),
  after_units: col.int.nullable(),
  store_before_minor: col.minor,
  store_after_minor: col.minor,
});

export type MeasuredEffect = Effect & { auditId: number };

const effectOf = (r: z.output<typeof EFFECT>): MeasuredEffect => ({
  auditId: r.audit_id,
  tool: r.tool,
  targetKind: r.target_kind,
  targetLabel: r.target_label,
  actedAt: r.acted_at,
  currency: r.currency,
  beforeMinor: r.before_minor,
  afterMinor: r.after_minor,
  beforeUnits: r.before_units,
  afterUnits: r.after_units,
  storeBeforeMinor: r.store_before_minor,
  storeAfterMinor: r.store_after_minor,
});

/** The store's latest measured changes, newest change first. */
export async function recentEffects(storeId: string, limit = 20): Promise<MeasuredEffect[]> {
  const rows = await typedRows(
    EFFECT,
    sql`
      select audit_id, tool, target_kind, target_label, acted_at, currency, before_minor, after_minor, before_units, after_units, store_before_minor, store_after_minor
      from commerce.autopilot_effects where store_id = ${storeId}::uuid order by acted_at desc, audit_id desc limit ${limit}
    `,
  );
  return rows.map(effectOf);
}

/** A store month (`YYYY-MM`): the changes the autopilot made in it and what the ones measured in it moved. */
export async function effectsOfMonth(store: Store, month: string): Promise<{ summary: EffectsMonth; effects: MeasuredEffect[] }> {
  const days = monthDays(month);
  const [actions, rows] = await Promise.all([
    typedRow(
      z.object({ n: col.int }),
      sql`
        select count(*)::int as n from commerce.audit_log
        where store_id = ${store.id}::uuid and acted_by = 'autopilot' and action like 'store.assistant.%'
          and ${dayOf(store, sql`created_at`)} between ${days.from}::date and ${days.to}::date
      `,
    ),
    typedRows(
      EFFECT,
      sql`
        select audit_id, tool, target_kind, target_label, acted_at, currency, before_minor, after_minor, before_units, after_units, store_before_minor, store_after_minor
        from commerce.autopilot_effects
        where store_id = ${store.id}::uuid and ${dayOf(store, sql`measured_at`)} between ${days.from}::date and ${days.to}::date
        order by acted_at, audit_id
      `,
    ),
  ]);
  const effects = rows.map(effectOf);
  return { summary: effectsMonth(month, actions?.n ?? 0, effects, mainCurrency(store)), effects };
}
