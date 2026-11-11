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
  SUPPLIER_LINK_DAYS,
  SUPPLIER_PROBLEM_MAX,
  isTrackingNumber,
  supplierLines,
  supplierWords,
  type SupplierOrderState,
} from "@/lib/supplier-orders";

import { audit } from "./auth";
import { sendEmail } from "./email";
import { log } from "./log";
import { markSent } from "./order-admin";
import { sendShipped } from "./shopper-emails";
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
             o.shipping_address
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

export type SupplierOrderRow = { id: string; orderId: string; number: string; state: SupplierOrderState; sendAfter: string; sentAt: string | null; shippedAt: string | null; problem: string | null; units: number };

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
    }),
    sql`select so.id, so.order_id, o.number, so.state, so.send_after, so.sent_at, so.shipped_at, so.problem,
               coalesce((select sum(l.quantity) from commerce.supplier_order_lines l where l.store_id = so.store_id and l.supplier_order_id = so.id), 0)::int as units
        from commerce.supplier_orders so join commerce.orders o on o.store_id = so.store_id and o.id = so.order_id
        where so.store_id = ${storeId}::uuid and so.supplier_id = ${supplierId}::uuid
        order by so.created_at desc limit ${Math.min(Math.max(limit, 1), 200)}`,
  );
  return rows.map((r) => ({ id: r.id, orderId: r.order_id, number: r.number, state: r.state, sendAfter: r.send_after, sentAt: r.sent_at, shippedAt: r.shipped_at, problem: r.problem, units: r.units }));
}

/** The five-minute job: new supplier orders made, then those whose wait is over sent. */
export async function runSupplierOrders(): Promise<{ made: number; sent: number; cancelled: number }> {
  const made = await collectSupplierOrders();
  const { sent, cancelled } = await sendDueSupplierOrders();
  return { made, sent, cancelled };
}
