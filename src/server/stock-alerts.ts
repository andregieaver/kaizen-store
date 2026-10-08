import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { INVENTORY_RETENTION_MONTHS, LOW_STOCK_EMAIL_LINES } from "@/lib/inventory";
import { variantLabel } from "@/lib/product-input";
import { siteUrl } from "@/lib/site";
import { lowStockKey, lowStockLines, type PendingCrossing } from "@/lib/stock-alerts";

import { sendEmail, type SendOutcome } from "./email";
import { emailFooter, storeById } from "./shopper-emails";

type Row = Record<string, unknown>;

/**
 * The low-stock notice (wave 3, D172, `docs/wave-3-inventory.md` 2.7, 3.4) and the clean-up of the history.
 *
 * `commerce.stock_alerts` holds the state of each variant with a warning level (`ok`, `low`, `off`); the database moves it on every change of a level,
 * a location or a threshold, and marks a NEW crossing (`state = 'low'`, `notified_at` null). This module only tells the owners: ONE email per store
 * per run listing the variants that crossed since the last run (at most `LOW_STOCK_EMAIL_LINES` lines and "and {n} more"), sent to the store's
 * owners, English like the other staff emails, saying the stock, the level and the SKU and linking to the Inventory page: nothing about sales,
 * customers or prices. `notified_at` is set only after the send succeeded, so a failure is retried by the next run, and the idempotency key (the
 * store plus the newest crossing's time, per owner) makes a retry after a lost answer the same email. A store that is not open gets none.
 */

/** `crossedRaw` is the time as the database kept it (microseconds): a JavaScript date has milliseconds, so it never answers for an equality. */
type Pending = PendingCrossing & { storeId: string; crossedRaw: string };

async function pendingCrossings(): Promise<Pending[]> {
  const rows = await db().execute<Row>(sql`
    select a.store_id, a.variant_id, a.crossed_at, a.crossed_at::text as crossed_raw, v.sku, v.options, v.low_stock_threshold,
           coalesce(tl.title, tf.title, p.handle) as title,
           coalesce((select sum(l.on_hand) from commerce.inventory_levels l
                       join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.active
                      where l.store_id = a.store_id and l.variant_id = a.variant_id), 0)::int as stock
    from commerce.stock_alerts a
    join commerce.product_variants v on v.store_id = a.store_id and v.id = a.variant_id
    join commerce.products p on p.store_id = v.store_id and p.id = v.product_id
    left join commerce.stores s on s.id = a.store_id
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = coalesce((s.locales)[1], 'en')
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    where a.state = 'low' and a.notified_at is null and a.crossed_at is not null and v.active and v.low_stock_threshold is not null
      and commerce.store_is_active(a.store_id) and commerce.feature_on(a.store_id, 'shop')
    order by a.store_id, a.crossed_at, a.variant_id
  `);
  return rows.map((r) => ({
    storeId: String(r.store_id),
    variantId: String(r.variant_id),
    sku: String(r.sku),
    label: [String(r.title), variantLabel((r.options ?? {}) as Record<string, string>)].filter(Boolean).join(" "),
    stock: Number(r.stock),
    threshold: Number(r.low_stock_threshold),
    crossedAt: new Date(String(r.crossed_at)).toISOString(),
    crossedRaw: String(r.crossed_raw),
  }));
}

/** The owners of a store who can be written to: active members with the owner role and an address. */
async function ownersOf(storeId: string): Promise<{ id: string; email: string }[]> {
  const rows = await db().execute<Row>(sql`
    select distinct on (a.id) a.id, a.email
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
    where m.store_id = ${storeId}::uuid and m.role = 'owner' and m.disabled_at is null and a.email <> ''
      and (m.expires_at is null or m.expires_at > now())
  `);
  return rows.map((r) => ({ id: String(r.id), email: String(r.email) }));
}

export type LowStockRun = { stores: number; emails: number; crossings: number; failed: number };

const TOLD: readonly SendOutcome[] = ["sent", "logged", "duplicate"];

/**
 * Tells the owners of each open store about the variants that crossed their warning level, one email per store per run. Never throws: a store
 * that fails is logged and the next one goes on; what could not be sent stays unmarked and is tried again at the next run (every five minutes).
 */
export async function sendLowStockNotices(deps: { send?: typeof sendEmail } = {}): Promise<LowStockRun> {
  const send = deps.send ?? sendEmail;
  const out: LowStockRun = { stores: 0, emails: 0, crossings: 0, failed: 0 };
  let pending: Pending[];
  try {
    pending = await pendingCrossings();
  } catch (error) {
    console.error("[stock-alerts] the crossings could not be read", error);
    return out;
  }
  const byStore = new Map<string, Pending[]>();
  for (const crossing of pending) byStore.set(crossing.storeId, [...(byStore.get(crossing.storeId) ?? []), crossing]);
  for (const [storeId, crossings] of byStore) {
    try {
      const store = await storeById(storeId);
      const owners = await ownersOf(storeId);
      if (!store || owners.length === 0) continue;
      const { shown, more } = lowStockLines(crossings, LOW_STOCK_EMAIL_LINES);
      const text = emailText("en");
      const key = lowStockKey(storeId, crossings);
      const lines = shown.map((c) => ({ label: `${c.label} (${c.sku})`, value: `${c.stock} left, level ${c.threshold}`, muted: false }));
      const email = renderEmail({
        subject: crossings.length === 1 ? `Low stock: ${shown[0].label}` : `Low stock: ${crossings.length} products at or below their level`,
        preview: `${crossings.length} ${crossings.length === 1 ? "variant has" : "variants have"} reached the low-stock level you set.`,
        lang: "en",
        footer: emailFooter(store, text),
        blocks: [
          { type: "heading", text: "Stock is running low" },
          { type: "paragraph", text: `${crossings.length === 1 ? "This variant has" : "These variants have"} reached the low-stock level you set. You hear about each one once, when it crosses its level.` },
          { type: "lines", rows: lines },
          ...(more > 0 ? [{ type: "paragraph" as const, text: `…and ${more} more.` }] : []),
          { type: "button", text: "Open the Inventory page", url: `${siteUrl()}/admin/${store.slug}/inventory?status=low` },
        ],
      });
      const outcomes: SendOutcome[] = [];
      for (const owner of owners) {
        outcomes.push(await send({ storeId, kind: "stock.low", to: owner.email, email, fromName: store.name, idempotencyKey: `${key}:${owner.id}` }));
      }
      if (!outcomes.some((o) => TOLD.includes(o))) {
        out.failed += 1;
        continue;
      }
      // Marked after the send: exactly the crossings this email named (a variant that crossed again meanwhile has a new time and stays pending).
      await db().execute(sql`
        update commerce.stock_alerts a set notified_at = now()
        from (select * from unnest(${`{${crossings.map((c) => c.variantId).join(",")}}`}::uuid[], ${`{${crossings.map((c) => `"${c.crossedRaw}"`).join(",")}}`}::timestamptz[]) as t(variant_id, crossed_at)) c
        where a.store_id = ${storeId}::uuid and a.variant_id = c.variant_id and a.crossed_at = c.crossed_at and a.state = 'low' and a.notified_at is null
      `);
      out.stores += 1;
      out.emails += outcomes.filter((o) => TOLD.includes(o)).length;
      out.crossings += crossings.length;
    } catch (error) {
      out.failed += 1;
      console.error("[stock-alerts] the low-stock email could not be sent", storeId, error);
    }
  }
  return out;
}

/**
 * Removes movements older than `INVENTORY_RETENTION_MONTHS` months (24: the audit log's length, a choice of Kaizen's, no law is claimed for it), in
 * batches, never throwing. The database's guard allows only exactly this: a younger movement is refused whoever asks. The cut-off is worked out from
 * the database's clock when the given clock is later, so a test that holds the clock still never asks for more than the guard allows.
 *
 * The NEWEST movement of each (variant, location) is kept however old it is (the guard refuses to remove it too): it is the baseline of
 * `inventory_ledger_check()`, which compares a level with the level before the oldest movement kept plus what the kept ones add up
 * to, so the clean-up never makes a whole history look broken. That is one small row per level at most, with no personal data.
 */
export async function pruneInventoryMovements(now: Date = new Date(), batch = 5000, rounds = 10): Promise<number> {
  let total = 0;
  try {
    for (let round = 0; round < rounds; round++) {
      const rows = await db().execute<Row>(sql`
        delete from commerce.inventory_movements
        where id in (
          select x.id from commerce.inventory_movements x
          where x.created_at < least(${now.toISOString()}::timestamptz, now()) - make_interval(months => ${INVENTORY_RETENTION_MONTHS})
            and exists (select 1 from commerce.inventory_movements n
                         where n.store_id = x.store_id and n.variant_id = x.variant_id and n.location_id = x.location_id and n.id > x.id)
          order by x.id limit ${batch})
        returning id
      `);
      total += rows.length;
      if (rows.length < batch) break;
    }
  } catch (error) {
    console.error("[stock-alerts] the old movements could not be removed", error);
  }
  return total;
}
