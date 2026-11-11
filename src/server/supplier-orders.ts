import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";
import {
  SUPPLIER_CARRIERS,
  SUPPLIER_KEY_PREFIX,
  SUPPLIER_LINK_DAYS,
  SUPPLIER_PROBLEM_MAX,
  isTrackingNumber,
  supplierLines,
  supplierWords,
  type SupplierOrderState,
} from "@/lib/supplier-orders";

import { writeCsv } from "@/lib/csv";
import { STOCK_MAX } from "@/lib/inventory";

import { audit, type Membership } from "./auth";
import { catalogTag } from "./catalog";
import { sendEmail } from "./email";
import { log } from "./log";
import { markSent } from "./order-admin";
import { NO_ACCESS, memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { sendShipped } from "./shopper-emails";
import { setStockContext } from "./stock-context";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Supplier orders (drop shipping, D551, `docs/drop-shipping.md` 4 and 5, step 2). The five-minute job (`runSupplierOrders()`) makes one per
 * paid order and supplier from the units the payment drew at the supplier's location (`inventory_movements` of reason `sale`), holds it for the
 * store's wait, then emails the supplier what to send and where, in the store's name and the supplier's language, with a link to its page. On
 * that page (`/supply/{token}`) the supplier posts the parcel, which is recorded by `markSent()` for exactly its lines and emailed to the customer
 * as the shop's own shipped email (`sendShipped()`), or says it cannot send, which tells the store's owners. A cancelled order's waiting supplier
 * order is cancelled and never sent. The only writer of `commerce.supplier_orders` and its lines.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The SHA-256 of a supplier page's token: only it is kept. */
export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** How far back the job looks for paid orders with supplier lines: a job that was down for a day still finds them. */
const LOOK_BACK_DAYS = 3;

/**
 * Makes the supplier orders of paid orders that have none yet, one per order and supplier, each waiting until the store's wait has passed since
 * the sale. Returns how many were made. Never throws for one order: a line that cannot be laid out is logged and the rest go on.
 */
export async function collectSupplierOrders({ storeId: only }: { storeId?: string } = {}): Promise<number> {
  const sales = await typedRows(
    z.object({ store_id: col.uuid, order_id: col.uuid, supplier_id: col.uuid, variant_id: col.uuid, units: col.int, sold_at: col.timestamp, wait: col.int }),
    sql`
      select m.store_id, m.order_id, loc.supplier_id, m.variant_id, sum(-m.delta)::int as units, max(m.created_at) as sold_at,
             coalesce((select os.drop_ship_wait_minutes from commerce.order_settings os where os.store_id = m.store_id), 30)::int as wait
      from commerce.inventory_locations loc
      join commerce.inventory_movements m on m.store_id = loc.store_id and m.location_id = loc.id
        and m.reason = 'sale' and m.order_id is not null and m.created_at > now() - make_interval(days => ${LOOK_BACK_DAYS})
      join commerce.orders o on o.store_id = m.store_id and o.id = m.order_id and o.status in ('paid', 'fulfilled') and o.copied_from is null
      where loc.supplier_id is not null and (${only ?? null}::uuid is null or loc.store_id = ${only ?? null}::uuid)
        and not exists (select 1 from commerce.supplier_orders so where so.store_id = m.store_id and so.order_id = m.order_id and so.supplier_id = loc.supplier_id)
      group by m.store_id, m.order_id, loc.supplier_id, m.variant_id
      having sum(-m.delta) > 0
    `,
  );
  const groups = new Map<string, typeof sales>();
  for (const sale of sales) {
    const key = `${sale.store_id}:${sale.order_id}:${sale.supplier_id}`;
    groups.set(key, [...(groups.get(key) ?? []), sale]);
  }
  let made = 0;
  for (const group of groups.values()) {
    const { store_id: storeId, order_id: orderId, supplier_id: supplierId, wait } = group[0];
    try {
      const lines = await typedRows(
        z.object({ id: col.uuid, variant_id: col.textOrNull, quantity: col.int }),
        sql`select id, variant_id::text as variant_id, quantity from commerce.order_lines where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid order by id`,
      );
      const asked = supplierLines(
        group.map((s) => ({ variantId: s.variant_id, units: s.units })),
        lines.map((l) => ({ id: l.id, variantId: l.variant_id, quantity: l.quantity })),
      );
      if (asked.length === 0) continue;
      const soldAt = Math.max(...group.map((s) => Date.parse(s.sold_at)));
      const sendAfter = new Date(soldAt + wait * 60_000).toISOString();
      const created = await db().transaction(async (tx) => {
        const row = await typedRow(
          z.object({ id: col.uuid }),
          sql`insert into commerce.supplier_orders (store_id, order_id, supplier_id, send_after)
              values (${storeId}::uuid, ${orderId}::uuid, ${supplierId}::uuid, ${sendAfter}::timestamptz)
              on conflict (store_id, order_id, supplier_id) do nothing returning id`,
          tx,
        );
        if (!row) return false;
        for (const line of asked) {
          await tx.execute(sql`
            insert into commerce.supplier_order_lines (store_id, supplier_order_id, order_line_id, quantity)
            values (${storeId}::uuid, ${row.id}::uuid, ${line.orderLineId}::uuid, ${line.quantity})
          `);
        }
        return true;
      });
      if (created) made += 1;
    } catch (error) {
      log("error", "supplier_orders.collect_failed", { storeId, orderId, supplierId }, error);
    }
  }
  return made;
}

type DueRow = {
  id: string;
  store_id: string;
  order_id: string;
  number: string;
  status: string;
  store_name: string;
  supplier: string;
  order_email: string;
  order_language: string;
  order_note: string;
  shipping_address: Record<string, unknown> | null;
  order_method: string;
  has_key: boolean;
};

const dueRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  order_id: col.uuid,
  number: col.text,
  status: col.text,
  store_name: col.text,
  supplier: col.text,
  order_email: col.text,
  order_language: col.text,
  order_note: col.text,
  shipping_address: z.record(z.string(), z.unknown()).nullable(),
  order_method: col.text,
  has_key: col.bool,
});

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");

/** The delivery address as lines for the supplier: name, street, postcode and city, country. */
export function shipToLines(address: Record<string, unknown> | null): string[] {
  const a = address ?? {};
  return [text(a.name), text(a.company), text(a.line1), text(a.line2), [text(a.postalCode), text(a.city)].filter(Boolean).join(" "), text(a.country), text(a.phone)].filter(Boolean);
}

/**
 * Sends the supplier orders whose wait is over: each gets a fresh link (the token's hash kept, 60 days) and one email to its supplier. One whose
 * order is no longer paid is cancelled instead. A supplier that no longer drop-ships is still sent the order it was given before it stopped.
 */
export async function sendDueSupplierOrders({ limit = 50, storeId: only }: { limit?: number; storeId?: string } = {}): Promise<{ sent: number; cancelled: number }> {
  const due = await typedRows(
    dueRow,
    sql`
      select so.id, so.store_id, so.order_id, o.number, o.status, st.name as store_name, s.name as supplier, s.order_email, s.order_language, s.order_note,
             o.shipping_address, s.order_method, s.api_key_hash is not null as has_key
      from commerce.supplier_orders so
      join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
      join commerce.stores st on st.id = so.store_id
      join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
      where so.state = 'waiting' and so.send_after <= now() and s.order_email is not null
        and (${only ?? null}::uuid is null or so.store_id = ${only ?? null}::uuid)
      order by so.send_after
      limit ${Math.min(Math.max(limit, 1), 200)}
    `,
  );
  let sent = 0;
  let cancelled = 0;
  for (const row of due as DueRow[]) {
    try {
      if (!["paid", "fulfilled"].includes(row.status)) {
        await db().execute(sql`update commerce.supplier_orders set state = 'cancelled', updated_at = now() where id = ${row.id}::uuid and state = 'waiting'`);
        cancelled += 1;
        continue;
      }
      // A supplier with its own system or a daily file (D553) reads its orders with its key: no email, no link. Without a key it gets the email.
      if (row.order_method !== "email" && row.has_key) {
        const marked = await typedRow(
          z.object({ id: col.uuid }),
          sql`update commerce.supplier_orders set state = 'sent', sent_at = now(), updated_at = now() where id = ${row.id}::uuid and state = 'waiting' returning id`,
        );
        if (marked) sent += 1;
        continue;
      }
      const token = randomBytes(32).toString("base64url");
      const claimed = await typedRow(
        z.object({ id: col.uuid }),
        sql`update commerce.supplier_orders set state = 'sent', sent_at = now(), token_hash = ${tokenHash(token)},
              token_expires_at = now() + make_interval(days => ${SUPPLIER_LINK_DAYS}), updated_at = now()
            where id = ${row.id}::uuid and state = 'waiting' returning id`,
      );
      if (!claimed) continue;
      const outcome = await sendEmail({
        storeId: row.store_id,
        kind: "supplier.order",
        to: row.order_email,
        email: await supplierEmail(row, token),
        fromName: row.store_name,
        idempotencyKey: `supplier.order:${row.id}`,
        orderId: row.order_id,
        // The link is the supplier's key: never kept in the email log (only its hash is kept, on the supplier order).
        secrets: [token],
      });
      if (outcome === "failed") log("warn", "supplier_orders.email_failed", { storeId: row.store_id, supplierOrderId: row.id });
      sent += 1;
    } catch (error) {
      log("error", "supplier_orders.send_failed", { storeId: row.store_id, supplierOrderId: row.id }, error);
    }
  }
  return { sent, cancelled };
}

async function linesOf(storeId: string, supplierOrderId: string) {
  return typedRows(
    z.object({ order_line_id: col.uuid, sku: col.textOrNull, title: col.text, quantity: col.int }),
    sql`select l.order_line_id, ol.sku, ol.title, l.quantity
        from commerce.supplier_order_lines l
        join commerce.order_lines ol on ol.store_id = l.store_id and ol.id = l.order_line_id
        where l.store_id = ${storeId}::uuid and l.supplier_order_id = ${supplierOrderId}::uuid
        order by ol.title, ol.id`,
  );
}

async function supplierEmail(row: DueRow, token: string) {
  const w = supplierWords(row.order_language);
  const facts = { store: row.store_name, number: row.number, days: SUPPLIER_LINK_DAYS };
  const lines = await linesOf(row.store_id, row.id);
  return renderEmail({
    subject: fillWords(w.subject, facts),
    preview: fillWords(w.preview, facts),
    lang: row.order_language,
    footer: [fillWords(w.footer, facts)],
    blocks: [
      { type: "heading", text: fillWords(w.heading, facts) },
      { type: "paragraph", text: fillWords(w.intro, facts) },
      { type: "paragraph", text: w.send },
      { type: "lines", rows: lines.map((l) => ({ label: l.sku ? `${l.title} (${l.sku})` : l.title, value: `× ${l.quantity}` })) },
      { type: "paragraph", text: `${w.shipTo}: ${shipToLines(row.shipping_address).join(", ")}` },
      ...(row.order_note ? [{ type: "paragraph" as const, text: `${fillWords(w.note, facts)}: ${row.order_note}` }] : []),
      { type: "button", text: w.button, url: `${siteUrl()}/supply/${token}` },
      { type: "paragraph", text: fillWords(w.after, facts) },
    ],
  });
}

export type SupplierOrderView = {
  id: string;
  state: SupplierOrderState;
  storeName: string;
  number: string;
  language: string;
  note: string;
  shipTo: string[];
  lines: { sku: string | null; title: string; quantity: number }[];
  orderPaid: boolean;
};

const viewRow = z.object({
  id: col.uuid,
  store_id: col.uuid,
  order_id: col.uuid,
  state: z.enum(["waiting", "sent", "shipped", "problem", "cancelled"]),
  store_name: col.text,
  number: col.text,
  status: col.text,
  order_language: col.text,
  order_note: col.text,
  shipping_address: z.record(z.string(), z.unknown()).nullable(),
});

async function byToken(token: string) {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{30,80}$/.test(token)) return null;
  return typedRow(
    viewRow,
    sql`select so.id, so.store_id, so.order_id, so.state, st.name as store_name, o.number, o.status, s.order_language, s.order_note, o.shipping_address
        from commerce.supplier_orders so
        join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
        join commerce.stores st on st.id = so.store_id
        join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
        where so.token_hash = ${tokenHash(token)} and so.token_expires_at > now()`,
  );
}

/**
 * What the supplier's page shows: its order alone (what to send, where, the store's note) and nothing else of the store. Null for a link that
 * is wrong or past its 60 days. The delivery address is shown only while there is something to send.
 */
export async function supplierOrderByToken(token: string): Promise<SupplierOrderView | null> {
  const row = await byToken(token);
  if (!row) return null;
  const lines = await linesOf(row.store_id, row.id);
  const open = row.state === "sent" || row.state === "problem";
  return {
    id: row.id,
    state: row.state,
    storeName: row.store_name,
    number: row.number,
    language: row.order_language,
    note: row.order_note,
    shipTo: open ? shipToLines(row.shipping_address) : [],
    lines: lines.map((l) => ({ sku: l.sku, title: l.title, quantity: l.quantity })),
    orderPaid: ["paid", "fulfilled"].includes(row.status),
  };
}

export type SupplierPost = { ok: true } | { ok: false; problem: "gone" | "done" | "cancelled" | "tracking" | "carrier" | "link" | "refused" | "reason" };

/**
 * The supplier posts its parcel: the carrier and tracking number (a link for another carrier). Recorded by `markSent()` for exactly the supplier
 * order's lines, then emailed to the customer as the shop's shipped email. Posted once: a second post finds it shipped.
 */
export async function postSupplierParcel(token: string, raw: { carrier?: unknown; trackingNumber?: unknown; trackingUrl?: unknown }): Promise<SupplierPost> {
  const carrier = typeof raw.carrier === "string" ? raw.carrier : "";
  const trackingNumber = typeof raw.trackingNumber === "string" ? raw.trackingNumber.trim() : "";
  const link = typeof raw.trackingUrl === "string" ? raw.trackingUrl.trim() : "";
  if (!(SUPPLIER_CARRIERS as readonly string[]).includes(carrier)) return { ok: false, problem: "carrier" };
  if (!isTrackingNumber(trackingNumber)) return { ok: false, problem: "tracking" };
  if (link && !/^https:\/\/[^\s]{4,500}$/.test(link)) return { ok: false, problem: "link" };
  const row = await byToken(token);
  if (!row) return { ok: false, problem: "gone" };
  return recordParcel(row, carrier, trackingNumber, link);
}

/** The parcel of a supplier order the supplier has proved it may answer (by its page's link, or by its API key). */
async function recordParcel(row: z.output<typeof viewRow>, carrier: string, trackingNumber: string, link: string): Promise<SupplierPost> {
  if (row.state === "shipped") return { ok: false, problem: "done" };
  if (row.state === "cancelled" || !["paid", "fulfilled"].includes(row.status)) return { ok: false, problem: "cancelled" };
  // Claimed first, so two presses cannot record two parcels; given back if the parcel is refused.
  const claimed = await typedRow(
    z.object({ id: col.uuid, was: col.text }),
    sql`update commerce.supplier_orders so set state = 'shipped', shipped_at = now(), updated_at = now()
        from (select id, state as was from commerce.supplier_orders where id = ${row.id}::uuid for update) prev
        where so.id = prev.id and so.state in ('sent', 'problem') returning so.id, prev.was`,
  );
  if (!claimed) return { ok: false, problem: "done" };
  const lines = await linesOf(row.store_id, row.id);
  const outcome = await markSent(
    row.store_id,
    row.order_id,
    { carrier, trackingNumber, trackingUrl: carrier === "other" && link ? link : null },
    null,
    null,
    { lines: lines.map((l) => ({ lineId: l.order_line_id, quantity: l.quantity })) },
  );
  if (!outcome.ok) {
    await db().execute(sql`update commerce.supplier_orders set state = ${claimed.was}, shipped_at = null, updated_at = now() where id = ${row.id}::uuid`);
    log("warn", "supplier_orders.parcel_refused", { storeId: row.store_id, supplierOrderId: row.id, reason: outcome.reason });
    return { ok: false, problem: "refused" };
  }
  await db().execute(sql`update commerce.supplier_orders set shipment_id = ${outcome.shipment.id}::uuid where id = ${row.id}::uuid`);
  await audit(null, row.store_id, "order.supplier_parcel_posted", { lines: lines.length }, { area: "orders", target: { type: "order", id: row.order_id } }).catch((error) =>
    log("error", "supplier_orders.parcel_audit_failed", {}, error),
  );
  try {
    await sendShipped(row.store_id, row.order_id, outcome.shipment);
  } catch (error) {
    log("error", "supplier_orders.shipped_email_failed", { storeId: row.store_id, supplierOrderId: row.id }, error);
  }
  return { ok: true };
}

/**
 * The supplier says it cannot send (a line out of stock, discontinued): the supplier order is marked `problem` with its words and the store's
 * owners are emailed once. Nothing is refunded by itself: the owner decides. The words are kept as data and shown as text, never followed.
 */
export async function reportSupplierProblem(token: string, reason: unknown): Promise<SupplierPost> {
  const words = typeof reason === "string" ? reason.trim().replace(/\s+/g, " ") : "";
  if (words.length < 3 || words.length > SUPPLIER_PROBLEM_MAX) return { ok: false, problem: "reason" };
  const row = await byToken(token);
  if (!row) return { ok: false, problem: "gone" };
  if (row.state === "shipped") return { ok: false, problem: "done" };
  if (row.state === "cancelled") return { ok: false, problem: "cancelled" };
  const marked = await typedRow(
    z.object({ id: col.uuid, notify: col.bool }),
    sql`update commerce.supplier_orders set state = 'problem', problem = ${words}, updated_at = now(),
          problem_notified_at = coalesce(problem_notified_at, now())
        where id = ${row.id}::uuid and state in ('sent', 'problem') returning id, (problem_notified_at = updated_at) as notify`,
  );
  if (!marked) return { ok: false, problem: "done" };
  await audit(null, row.store_id, "order.supplier_problem", {}, { area: "orders", target: { type: "order", id: row.order_id } }).catch((error) => log("error", "supplier_orders.problem_audit_failed", {}, error));
  if (marked.notify) await notifyOwnersOfProblem(row.store_id, row.order_id, row.number, row.id, words);
  return { ok: true };
}

/** One email to each of the store's owners, in English: which order and supplier, and the supplier's words as quoted text. Never throws. */
async function notifyOwnersOfProblem(storeId: string, orderId: string, number: string, supplierOrderId: string, words: string): Promise<void> {
  try {
    const store = await typedRow(z.object({ slug: col.text, name: col.text }), sql`select slug, name from commerce.stores where id = ${storeId}::uuid`);
    const supplier = await typedRow(
      z.object({ name: col.text }),
      sql`select s.name from commerce.supplier_orders so join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id where so.id = ${supplierOrderId}::uuid`,
    );
    const owners = await typedRows(
      z.object({ id: col.uuid, email: col.text }),
      sql`select distinct on (a.id) a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
          where m.store_id = ${storeId}::uuid and m.disabled_at is null and m.role = 'owner' and a.email <> ''`,
    );
    if (!store) return;
    const email = renderEmail({
      subject: `${supplier?.name ?? "A supplier"} cannot send order ${number}`,
      preview: "Decide what happens next: refund the line, wait, or send it from somewhere else.",
      lang: "en",
      footer: ["Kaizena Flow, for " + store.name],
      blocks: [
        { type: "heading", text: `${supplier?.name ?? "A supplier"} cannot send order ${number}` },
        { type: "paragraph", text: `They wrote: “${words}”` },
        { type: "paragraph", text: "Nothing has been refunded. Decide what happens next: refund the line, wait for the supplier, or send it from somewhere else." },
        { type: "button", text: "Open the order", url: `${siteUrl()}/admin/${store.slug}/orders/${orderId}` },
      ],
    });
    for (const owner of owners) {
      await sendEmail({ storeId, kind: "supplier.problem", to: owner.email, email, fromName: "Kaizena Flow", idempotencyKey: `supplier.problem:${supplierOrderId}:${owner.id}`, orderId });
    }
  } catch (error) {
    log("error", "supplier_orders.problem_email_failed", { storeId, supplierOrderId }, error);
  }
}

export type SupplierOrderRow = { id: string; orderId: string; number: string; state: SupplierOrderState; sendAfter: string; sentAt: string | null; shippedAt: string | null; problem: string | null; units: number; /** Sent and not shipped within the supplier's working days (D553). */ late: boolean };

/** A supplier's orders for its page in the admin, newest first. */
export async function listSupplierOrders(storeId: string, supplierId: string, limit = 50): Promise<SupplierOrderRow[]> {
  if (!UUID.test(supplierId)) return [];
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      order_id: col.uuid,
      number: col.text,
      state: z.enum(["waiting", "sent", "shipped", "problem", "cancelled"]),
      send_after: col.timestamp,
      sent_at: col.timestampOrNull,
      shipped_at: col.timestampOrNull,
      problem: col.textOrNull,
      units: col.int,
      late: col.bool,
    }),
    sql`select so.id, so.order_id, o.number, so.state, so.send_after, so.sent_at, so.shipped_at, so.problem,
               (so.state = 'sent' and so.sent_at < now() - make_interval(days => (ceil(s.dispatch_days * 7 / 5.0) + 1)::int)) as late,
               coalesce((select sum(l.quantity) from commerce.supplier_order_lines l where l.store_id = so.store_id and l.supplier_order_id = so.id), 0)::int as units
        from commerce.supplier_orders so join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
        join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
        where so.store_id = ${storeId}::uuid and so.supplier_id = ${supplierId}::uuid
        order by so.created_at desc limit ${Math.min(Math.max(limit, 1), 200)}`,
  );
  return rows.map((r) => ({ id: r.id, orderId: r.order_id, number: r.number, state: r.state, sendAfter: r.send_after, sentAt: r.sent_at, shippedAt: r.shipped_at, problem: r.problem, units: r.units, late: r.late }));
}

/** The five-minute job: new supplier orders made, then those whose wait is over sent. */
export async function runSupplierOrders(): Promise<{ made: number; sent: number; cancelled: number; reminded: number; toppedUp: number }> {
  const made = await collectSupplierOrders();
  const { sent, cancelled } = await sendDueSupplierOrders();
  const reminded = await remindLateSuppliers();
  const toppedUp = await topUpAlwaysAvailable();
  return { made, sent, cancelled, reminded, toppedUp };
}

// ---------------------------------------------------------------------------
// Step 3 (D553): the supplier API, stock from the supplier, and suppliers that always have the goods.
// ---------------------------------------------------------------------------

/** The supplier a key belongs to, while it drop-ships; null for a key that is wrong or revoked. */
export async function supplierByKey(key: string): Promise<{ storeId: string; supplierId: string; method: string } | null> {
  if (typeof key !== "string" || !key.startsWith(SUPPLIER_KEY_PREFIX) || key.length > 100) return null;
  const row = await typedRow(
    z.object({ store_id: col.uuid, id: col.uuid, order_method: col.text }),
    sql`select store_id, id, order_method from commerce.suppliers where api_key_hash = ${tokenHash(key)} and drop_ships`,
  );
  return row ? { storeId: row.store_id, supplierId: row.id, method: row.order_method } : null;
}

export type ApiSupplierOrder = {
  id: string;
  number: string;
  state: "sent" | "problem";
  sentAt: string | null;
  shipTo: Record<string, string>;
  note: string;
  lines: { sku: string | null; title: string; quantity: number }[];
};

/** A supplier's orders still to send (sent to it, or with a problem it reported), oldest first: what its system reads. */
export async function openOrdersForSupplier(storeId: string, supplierId: string, limit = 200): Promise<ApiSupplierOrder[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, number: col.text, state: z.enum(["sent", "problem"]), sent_at: col.timestampOrNull, order_note: col.text, shipping_address: z.record(z.string(), z.unknown()).nullable() }),
    sql`select so.id, o.number, so.state, so.sent_at, s.order_note, o.shipping_address
        from commerce.supplier_orders so
        join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id and o.status in ('paid', 'fulfilled')
        join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
        where so.store_id = ${storeId}::uuid and so.supplier_id = ${supplierId}::uuid and so.state in ('sent', 'problem')
        order by so.sent_at nulls last, so.id limit ${Math.min(Math.max(limit, 1), 500)}`,
  );
  const out: ApiSupplierOrder[] = [];
  for (const r of rows) {
    const a = r.shipping_address ?? {};
    const shipTo = Object.fromEntries(["name", "company", "line1", "line2", "postalCode", "city", "country", "phone"].map((k) => [k, text(a[k])]).filter(([, v]) => v !== ""));
    out.push({ id: r.id, number: r.number, state: r.state, sentAt: r.sent_at, shipTo, note: r.order_note, lines: (await linesOf(storeId, r.id)).map((l) => ({ sku: l.sku, title: l.title, quantity: l.quantity })) });
  }
  return out;
}

/** The open orders as one CSV for a supplier that takes a daily file: a row per line, the address on each. */
export function supplierOrdersCsv(orders: readonly ApiSupplierOrder[]): string {
  const head = ["order_id", "order_number", "sku", "title", "quantity", "name", "company", "line1", "line2", "postal_code", "city", "country", "phone", "note"];
  const rows = orders.flatMap((o) =>
    o.lines.map((l) => [o.id, o.number, l.sku ?? "", l.title, l.quantity, o.shipTo.name ?? "", o.shipTo.company ?? "", o.shipTo.line1 ?? "", o.shipTo.line2 ?? "", o.shipTo.postalCode ?? "", o.shipTo.city ?? "", o.shipTo.country ?? "", o.shipTo.phone ?? "", o.note]),
  );
  return writeCsv([head, ...rows]);
}

/** A parcel posted by a supplier's system for one of its own supplier orders. */
export async function postParcelByKey(
  storeId: string,
  supplierId: string,
  supplierOrderId: string,
  raw: { carrier?: unknown; trackingNumber?: unknown; trackingUrl?: unknown },
): Promise<SupplierPost> {
  const carrier = typeof raw.carrier === "string" ? raw.carrier : "";
  const trackingNumber = typeof raw.trackingNumber === "string" ? raw.trackingNumber.trim() : "";
  const link = typeof raw.trackingUrl === "string" ? raw.trackingUrl.trim() : "";
  if (!(SUPPLIER_CARRIERS as readonly string[]).includes(carrier)) return { ok: false, problem: "carrier" };
  if (!isTrackingNumber(trackingNumber)) return { ok: false, problem: "tracking" };
  if (link && !/^https:\/\/[^\s]{4,500}$/.test(link)) return { ok: false, problem: "link" };
  if (!UUID.test(supplierOrderId)) return { ok: false, problem: "gone" };
  const row = await typedRow(
    viewRow,
    sql`select so.id, so.store_id, so.order_id, so.state, st.name as store_name, o.number, o.status, s.order_language, s.order_note, o.shipping_address
        from commerce.supplier_orders so
        join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
        join commerce.stores st on st.id = so.store_id
        join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
        where so.store_id = ${storeId}::uuid and so.supplier_id = ${supplierId}::uuid and so.id = ${supplierOrderId}::uuid`,
  );
  if (!row) return { ok: false, problem: "gone" };
  return recordParcel(row, carrier, trackingNumber, link);
}

/**
 * Stock as the supplier says it has it: SKU and units, for the variants it sends, written at its own location (a correction from the API in
 * the stock history). A SKU that is not one of its variants is listed back as unknown and changes nothing.
 */
export async function setSupplierStock(
  storeId: string,
  supplierId: string,
  items: readonly { sku?: unknown; quantity?: unknown }[],
): Promise<{ ok: true; set: number; unknown: string[] } | { ok: false; problem: string }> {
  if (!Array.isArray(items) || items.length === 0 || items.length > 2000) return { ok: false, problem: "Send 1 to 2000 items, each { sku, quantity }." };
  const wanted = new Map<string, number>();
  for (const item of items) {
    const sku = typeof item?.sku === "string" ? item.sku.trim() : "";
    const quantity = Number(item?.quantity);
    if (!sku || !Number.isInteger(quantity) || quantity < 0 || quantity > STOCK_MAX) return { ok: false, problem: `Each item needs a sku and a whole quantity from 0 to ${STOCK_MAX}.` };
    wanted.set(sku, quantity);
  }
  const unknown: string[] = [];
  const set = await db().transaction(async (tx) => {
    const found = await typedRows(
      z.object({ variant_id: col.uuid, sku: col.text, location_id: col.uuid }),
      sql`select v.id as variant_id, v.sku, loc.id as location_id
          from commerce.product_variants v
          join commerce.inventory_locations loc on loc.store_id = v.store_id and loc.supplier_id = v.supplier_id
          where v.store_id = ${storeId}::uuid and v.supplier_id = ${supplierId}::uuid and v.sku in (${sql.join([...wanted.keys()].map((k) => sql`${k}`), sql`, `)})
          order by v.id`,
      tx,
    );
    const known = new Set(found.map((f) => f.sku));
    for (const sku of wanted.keys()) if (!known.has(sku)) unknown.push(sku);
    if (found.length === 0) return 0;
    await setStockContext(tx, { reason: "correction", source: "api", note: "Stock from the supplier" });
    const rows = found.map((f) => ({ id: f.variant_id, location_id: f.location_id, on_hand: wanted.get(f.sku)! }));
    await tx.execute(sql`
      insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
      select ${storeId}::uuid, r.id, r.location_id, r.on_hand
      from jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) as r(id uuid, location_id uuid, on_hand integer)
      order by r.id, r.location_id
      on conflict (variant_id, location_id) do update set on_hand = excluded.on_hand, updated_at = now()
    `);
    return found.length;
  });
  if (set > 0) refreshTag(catalogTag(storeId));
  return { ok: true, set, unknown };
}

/** The level an always-available supplier's variants are kept at, and the level below which they are topped up again. */
const ALWAYS_LEVEL = 10_000;
const ALWAYS_REFILL_BELOW = 5_000;

/** Tops up the stock of suppliers that always have the goods (D553): one movement now and then, never a level that runs out. */
export async function topUpAlwaysAvailable(): Promise<number> {
  const due = await typedRows(
    z.object({ store_id: col.uuid, variant_id: col.uuid, location_id: col.uuid }),
    sql`select v.store_id, v.id as variant_id, loc.id as location_id
        from commerce.suppliers s
        join commerce.inventory_locations loc on loc.store_id = s.store_id and loc.supplier_id = s.id and loc.active
        join commerce.product_variants v on v.store_id = s.store_id and v.supplier_id = s.id
        left join commerce.inventory_levels l on l.variant_id = v.id and l.location_id = loc.id
        where s.drop_ships and s.always_available and coalesce(l.on_hand, 0) < ${ALWAYS_REFILL_BELOW}
        order by v.store_id, v.id limit 2000`,
  );
  const byStore = new Map<string, typeof due>();
  for (const row of due) byStore.set(row.store_id, [...(byStore.get(row.store_id) ?? []), row]);
  for (const [storeId, rows] of byStore) {
    try {
      await db().transaction(async (tx) => {
        await setStockContext(tx, { reason: "correction", source: "system", note: "Always available from the supplier" });
        await tx.execute(sql`
          insert into commerce.inventory_levels (store_id, variant_id, location_id, on_hand)
          select ${storeId}::uuid, r.id, r.location_id, ${ALWAYS_LEVEL}
          from jsonb_to_recordset(${JSON.stringify(rows.map((r) => ({ id: r.variant_id, location_id: r.location_id })))}::jsonb) as r(id uuid, location_id uuid)
          order by r.id, r.location_id
          on conflict (variant_id, location_id) do update set on_hand = ${ALWAYS_LEVEL}, updated_at = now()
        `);
      });
      refreshTag(catalogTag(storeId));
    } catch (error) {
      log("error", "supplier_orders.top_up_failed", { storeId }, error);
    }
  }
  return due.length;
}

// ---------------------------------------------------------------------------
// Step 4 (D553): late suppliers, the owner's answers to a problem, and what the shop owes.
// ---------------------------------------------------------------------------

/**
 * Suppliers that have not sent within their dispatch days (and a day's grace, weekends counted): each supplier order gets one reminder, by email
 * with a fresh link for a supplier that takes email, and the store's owners are told once. Never more than once per supplier order.
 */
export async function remindLateSuppliers({ storeId: only }: { storeId?: string } = {}): Promise<number> {
  const late = await typedRows(
    dueRow.extend({ dispatch_days: col.int, supplier_id: col.uuid }),
    sql`select so.id, so.store_id, so.order_id, o.number, o.status, st.name as store_name, s.name as supplier, s.order_email, s.order_language, s.order_note,
               o.shipping_address, s.order_method, s.api_key_hash is not null as has_key, s.dispatch_days, s.id as supplier_id
        from commerce.supplier_orders so
        join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id and o.status in ('paid', 'fulfilled')
        join commerce.stores st on st.id = so.store_id
        join commerce.suppliers s on s.store_id = so.store_id and s.id = so.supplier_id
        where so.state = 'sent' and so.reminded_at is null
          and so.sent_at < now() - make_interval(days => (ceil(s.dispatch_days * 7 / 5.0) + 1)::int)
          and (${only ?? null}::uuid is null or so.store_id = ${only ?? null}::uuid)
        order by so.sent_at limit 100`,
  );
  let reminded = 0;
  for (const row of late) {
    try {
      const claimed = await typedRow(
        z.object({ id: col.uuid }),
        sql`update commerce.supplier_orders set reminded_at = now(), updated_at = now() where id = ${row.id}::uuid and reminded_at is null returning id`,
      );
      if (!claimed) continue;
      reminded += 1;
      if (row.order_email && !(row.order_method !== "email" && row.has_key)) {
        const token = randomBytes(32).toString("base64url");
        await db().execute(sql`update commerce.supplier_orders set token_hash = ${tokenHash(token)}, token_expires_at = now() + make_interval(days => ${SUPPLIER_LINK_DAYS}) where id = ${row.id}::uuid`);
        const w = supplierWords(row.order_language);
        const facts = { store: row.store_name, number: row.number, days: row.dispatch_days };
        await sendEmail({
          storeId: row.store_id,
          kind: "supplier.reminder",
          to: row.order_email,
          email: renderEmail({
            subject: fillWords(w.reminderSubject, facts),
            preview: fillWords(w.reminderIntro, facts),
            lang: row.order_language,
            footer: [fillWords(w.footer, { ...facts, days: SUPPLIER_LINK_DAYS })],
            blocks: [
              { type: "heading", text: fillWords(w.reminderSubject, facts) },
              { type: "paragraph", text: fillWords(w.reminderIntro, facts) },
              { type: "button", text: w.button, url: `${siteUrl()}/supply/${token}` },
            ],
          }),
          fromName: row.store_name,
          idempotencyKey: `supplier.reminder:${row.id}`,
          orderId: row.order_id,
          secrets: [token],
        });
      }
      await notifyOwners(row.store_id, row.order_id, `supplier.late:${row.id}`, "supplier.late", {
        subject: `${row.supplier} has not sent order ${row.number}`,
        heading: `${row.supplier} has not sent order ${row.number} within its ${row.dispatch_days} working days`,
        body: "It has been reminded once. If it does not answer, you can send the order again to it, cancel its part and send the goods from elsewhere, or refund the customer from the order.",
      });
    } catch (error) {
      log("error", "supplier_orders.remind_failed", { storeId: row.store_id, supplierOrderId: row.id }, error);
    }
  }
  return reminded;
}

/** One email to each of the store's owners about an order (English, as the problem email). Never throws. */
async function notifyOwners(storeId: string, orderId: string, key: string, kind: string, words: { subject: string; heading: string; body: string }): Promise<void> {
  try {
    const store = await typedRow(z.object({ slug: col.text, name: col.text }), sql`select slug, name from commerce.stores where id = ${storeId}::uuid`);
    if (!store) return;
    const owners = await typedRows(
      z.object({ id: col.uuid, email: col.text }),
      sql`select distinct on (a.id) a.id, a.email from commerce.store_members m join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
          where m.store_id = ${storeId}::uuid and m.disabled_at is null and m.role = 'owner' and a.email <> ''`,
    );
    const email = renderEmail({
      subject: words.subject,
      preview: words.body,
      lang: "en",
      footer: [`Kaizena Flow, for ${store.name}`],
      blocks: [
        { type: "heading", text: words.heading },
        { type: "paragraph", text: words.body },
        { type: "button", text: "Open the order", url: `${siteUrl()}/admin/${store.slug}/orders/${orderId}` },
      ],
    });
    for (const owner of owners) await sendEmail({ storeId, kind, to: owner.email, email, fromName: "Kaizena Flow", idempotencyKey: `${key}:${owner.id}`, orderId });
  } catch (error) {
    log("error", "supplier_orders.owner_email_failed", { storeId }, error);
  }
}

export type OwnerStep = { ok: true } | { ok: false; problem: string };

/**
 * The owner's answers to a supplier order that has a problem or is late (step 4): send it to the supplier again (a fresh email and link, at once),
 * or cancel the supplier's part (it is not asked again; the owner sends the goods from elsewhere or refunds from the order, which stays as it is).
 * `products:write`, as the supplier's page is.
 */
export async function answerSupplierOrder(member: Membership, supplierOrderId: string, answer: "resend" | "cancel"): Promise<OwnerStep> {
  if (!memberCan(member, "products:write")) return { ok: false, problem: NO_ACCESS };
  if (!UUID.test(supplierOrderId) || (answer !== "resend" && answer !== "cancel")) return { ok: false, problem: "This supplier order is not in this store." };
  const storeId = member.store.id;
  const row = await typedRow(
    z.object({ id: col.uuid, order_id: col.uuid }),
    answer === "resend"
      ? sql`update commerce.supplier_orders set state = 'waiting', send_after = now(), token_hash = null, token_expires_at = null, problem = null,
              problem_notified_at = null, reminded_at = null, updated_at = now()
            where store_id = ${storeId}::uuid and id = ${supplierOrderId}::uuid and state in ('sent', 'problem') returning id, order_id`
      : sql`update commerce.supplier_orders set state = 'cancelled', token_hash = null, token_expires_at = null, updated_at = now()
            where store_id = ${storeId}::uuid and id = ${supplierOrderId}::uuid and state in ('waiting', 'sent', 'problem') returning id, order_id`,
  );
  if (!row) return { ok: false, problem: "This supplier order has been sent or cancelled already." };
  await audit(member.account.id, storeId, answer === "resend" ? "order.supplier_resent" : "order.supplier_cancelled", {}, { area: "orders", target: { type: "order", id: row.order_id } }).catch((error) =>
    log("error", "supplier_orders.answer_audit_failed", {}, error),
  );
  if (answer === "resend") await sendDueSupplierOrders({ storeId, limit: 20 });
  return { ok: true };
}

export type OwedRow = { orderId: string; number: string; shippedAt: string; units: number; costMinor: number; missingCost: boolean };

/**
 * What the shop owes a supplier for the parcels it sent in a month (the store's main currency, without VAT): each shipped supplier order's units
 * at the cost the order line froze when it was sold (D152). A line sold without a cost is counted at 0 and marked, so the owner sees what is
 * missing. Paying it stays outside Kaizena Flow.
 */
export async function owedToSupplier(storeId: string, supplierId: string, month: string): Promise<{ rows: OwedRow[]; totalMinor: number }> {
  if (!UUID.test(supplierId) || !/^\d{4}-\d{2}$/.test(month)) return { rows: [], totalMinor: 0 };
  const rows = await typedRows(
    z.object({ order_id: col.uuid, number: col.text, shipped_at: col.timestamp, units: col.int, cost_minor: col.minor, missing: col.bool }),
    sql`select so.order_id, o.number, so.shipped_at, sum(l.quantity)::int as units,
               coalesce(sum(l.quantity * coalesce(ol.unit_cost_minor, 0)), 0)::bigint as cost_minor,
               bool_or(ol.unit_cost_minor is null) as missing
        from commerce.supplier_orders so
        join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
        join commerce.supplier_order_lines l on l.store_id = so.store_id and l.supplier_order_id = so.id
        join commerce.order_lines ol on ol.store_id = l.store_id and ol.id = l.order_line_id
        where so.store_id = ${storeId}::uuid and so.supplier_id = ${supplierId}::uuid and so.state = 'shipped'
          and so.shipped_at >= ${`${month}-01`}::date and so.shipped_at < (${`${month}-01`}::date + interval '1 month')
        group by so.id, so.order_id, o.number, so.shipped_at
        order by so.shipped_at`,
  );
  const out = rows.map((r) => ({ orderId: r.order_id, number: r.number, shippedAt: r.shipped_at, units: r.units, costMinor: r.cost_minor, missingCost: r.missing }));
  return { rows: out, totalMinor: out.reduce((sum, r) => sum + r.costMinor, 0) };
}

export type SupplierPerformance = { supplierId: string; shipped: number; onTime: number; late: number; open: number; problems: number };

/** How each supplier sends, over the last 90 days (step 5): parcels sent, sent within its dispatch days, late ones still open, problems. */
export async function supplierPerformance(storeId: string): Promise<SupplierPerformance[]> {
  const rows = await typedRows(
    z.object({ supplier_id: col.uuid, shipped: col.int, on_time: col.int, late: col.int, open: col.int, problems: col.int }),
    sql`select s.id as supplier_id,
               count(*) filter (where so.state = 'shipped')::int as shipped,
               count(*) filter (where so.state = 'shipped' and so.shipped_at <= so.sent_at + make_interval(days => (ceil(s.dispatch_days * 7 / 5.0) + 1)::int))::int as on_time,
               count(*) filter (where so.state = 'sent' and so.sent_at < now() - make_interval(days => (ceil(s.dispatch_days * 7 / 5.0) + 1)::int))::int as late,
               count(*) filter (where so.state in ('waiting', 'sent'))::int as open,
               count(*) filter (where so.state = 'problem')::int as problems
        from commerce.suppliers s
        left join commerce.supplier_orders so on so.store_id = s.store_id and so.supplier_id = s.id and so.created_at > now() - interval '90 days'
        where s.store_id = ${storeId}::uuid and s.drop_ships
        group by s.id`,
  );
  return rows.map((r) => ({ supplierId: r.supplier_id, shipped: r.shipped, onTime: r.on_time, late: r.late, open: r.open, problems: r.problems }));
}
