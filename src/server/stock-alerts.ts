import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { renderEmail, type RenderedEmail } from "@/lib/email-layout";
import { emailText } from "@/lib/email-text";
import { INVENTORY_RETENTION_MONTHS, LOW_STOCK_EMAIL_LINES } from "@/lib/inventory";
import { variantLabel } from "@/lib/product-input";
import { siteUrl } from "@/lib/site";
import { ALERT_KEYS } from "@/lib/staff-alerts";
import { lowStockKey, lowStockLines, type PendingCrossing } from "@/lib/stock-alerts";

import { sendEmail, type SendOutcome } from "./email";
import { log } from "./log";
import { emailFooter, storeById } from "./shopper-emails";
import { alertRecipients } from "./staff-alerts";

type Row = Record<string, unknown>;

/**
 * The low-stock notice (wave 3, D172, `docs/wave-3-inventory.md` 2.7, 3.4) and the clean-up of the history.
 *
 * `commerce.stock_alerts` holds the state of each variant with a warning level (`ok`, `low`, `off`); the database moves it on every change of a level,
 * a location or a threshold, and marks a NEW crossing (`state = 'low'`, `notified_at` null, or the crossing's own time for a variant created at
 * or set to a level at or below it: `UNTOLD_SQL`, D370). This module only tells the owners: ONE email per store
 * per run listing the variants that crossed since the last run (at most `LOW_STOCK_EMAIL_LINES` lines and "and {n} more"), sent to the recipients
 * of *Low stock* (D238, the store's owners by default), English like the other staff emails, saying the stock, the level and the SKU and linking to the Inventory page: nothing about sales,
 * customers or prices. `notified_at` is set only after the send succeeded, so a failure is retried by the next run, and the idempotency key (the
 * store plus the newest crossing's time, per owner) makes a retry after a lost answer the same email. A store that is not open gets none.
 */

/**
 * A `low` row the owners are still to be told of (`untold()` in `src/lib/stock-alerts.ts`): never marked (a crossing from `ok`), or marked with
 * the crossing's own time, which `commerce.refresh_stock_alert()` writes for a crossing from `off` (a variant created at or below its level, or a
 * level set on one already there; D370 makes that a crossing at once without changing the function). Compared in the database, to the
 * microsecond: the job's mark is a later transaction's `now()`, so a crossing it told is never untold again.
 */
const UNTOLD_SQL = sql`(a.notified_at is null or a.notified_at = a.crossed_at)`;

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
    where a.state = 'low' and ${UNTOLD_SQL} and a.crossed_at is not null and v.active and v.low_stock_threshold is not null
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
    log("error", "stock_alerts.crossings_read_failed", {}, error);
    return out;
  }
  const byStore = new Map<string, Pending[]>();
  for (const crossing of pending) byStore.set(crossing.storeId, [...(byStore.get(crossing.storeId) ?? []), crossing]);
  for (const [storeId, crossings] of byStore) {
    try {
      const store = await storeById(storeId);
      // The recipients of *Low stock* (D238 4.7): the owners while the store has not chosen others.
      const targets = await alertRecipients(storeId, "low_stock");
      if (!store || targets.length === 0) continue;
      const { shown, more } = lowStockLines(crossings, LOW_STOCK_EMAIL_LINES);
      const key = lowStockKey(storeId, crossings);
      // One email per language, each recipient's own (D312 A10); English exactly as before.
      const made = new Map<AdminLang, RenderedEmail>();
      const emailIn = (lang: AdminLang): RenderedEmail => {
        const hit = made.get(lang);
        if (hit) return hit;
        const w = adminText(lang, "staffEmails").alerts.lowStock;
        const one = crossings.length === 1;
        const lines = shown.map((c) => ({ label: `${c.label} (${c.sku})`, value: fillWords(w.line, { stock: c.stock, level: c.threshold }), muted: false }));
        const email = renderEmail({
          subject: one ? fillWords(w.subjectOne, { product: shown[0].label }) : fillWords(w.subjectMany, { n: crossings.length }),
          preview: countWords(crossings.length, w.preview),
          lang: ADMIN_LANG_FACTS[lang].tag,
          footer: emailFooter(store, emailText(lang)),
          blocks: [
            { type: "heading", text: w.heading },
            { type: "paragraph", text: one ? w.textOne : w.textMany },
            { type: "lines", rows: lines },
            ...(more > 0 ? [{ type: "paragraph" as const, text: fillWords(adminText(lang, "staffEmails").alerts.more, { n: more }) }] : []),
            { type: "button", text: w.button, url: `${siteUrl()}/admin/${store.slug}/inventory?status=low` },
          ],
        });
        made.set(lang, email);
        return email;
      };
      const outcomes: SendOutcome[] = [];
      for (const target of targets) {
        outcomes.push(await send({ storeId, kind: "stock.low", to: target.to, email: emailIn(target.lang), fromName: store.name, idempotencyKey: ALERT_KEYS.lowStock(key, target.recipient) }));
      }
      if (!outcomes.some((o) => TOLD.includes(o))) {
        out.failed += 1;
        continue;
      }
      // Marked after the send: exactly the crossings this email named (a variant that crossed again meanwhile has a new time and stays pending).
      await db().execute(sql`
        update commerce.stock_alerts a set notified_at = now()
        from (select * from unnest(${`{${crossings.map((c) => c.variantId).join(",")}}`}::uuid[], ${`{${crossings.map((c) => `"${c.crossedRaw}"`).join(",")}}`}::timestamptz[]) as t(variant_id, crossed_at)) c
        where a.store_id = ${storeId}::uuid and a.variant_id = c.variant_id and a.crossed_at = c.crossed_at and a.state = 'low' and ${UNTOLD_SQL}
      `);
      out.stores += 1;
      out.emails += outcomes.filter((o) => TOLD.includes(o)).length;
      out.crossings += crossings.length;
    } catch (error) {
      out.failed += 1;
      log("error", "stock_alerts.email_failed", { storeId }, error);
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
    log("error", "stock_alerts.movements_prune_failed", {}, error);
  }
  return total;
}
