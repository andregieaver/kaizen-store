import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { pickupBlock, type PickupAction, type PickupBlock } from "@/lib/pickup";
import { pickupOptionInput } from "@/lib/shipping-methods-schema";
import { dayIn, noonOf } from "@/lib/work-dates";

import { audit } from "./auth";
import { catalogTag } from "./catalog";
import { orderFulfilment } from "./fulfilment";
import { markSentWithin as sendWithin, type SendOutcome } from "./order-admin";
import { refreshTag } from "./refresh";
import { shippingGuard, type ShippingRefused } from "./shipping-errors";
import { sendReadyForPickup } from "./shopper-emails";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Local pickup (D237, `docs/wave-3-shipping-methods.md` 2.2 and 4.4): the store's places where customers may collect (`pickup_options`, one per place of
 * kind `shop` or `pickup`, priced in the currency of the market of the place's country), and the two buttons of a pickup order: *Ready for pickup*
 * (recorded once, `orders.ready_for_pickup_at`, and one email per order) and *Collected* (a handover of method `pickup` through `markSent()`'s work and the
 * receipt, `delivered_at`, in ONE transaction: collecting is the day the consumer acquires physical possession, CRD Art. 9(2)(b)). A mistaken *Collected*
 * is taken back with D174's undo, which clears the receipt and returns the order to `paid`. Every query names the store.
 */

// ---------------------------------------------------------------------------
// Setting it up (settings:write)
// ---------------------------------------------------------------------------

export type PickupPlaceRow = {
  locationId: string;
  name: string;
  kind: "shop" | "pickup";
  street: string;
  postalCode: string;
  city: string;
  country: string;
  /** The store sells in the place's country (else the switch cannot be turned on: "not a country you sell to"). */
  sellsThere: boolean;
  /** The market's own currency, which the price is in; null when the store does not sell there. */
  currency: string | null;
  option: {
    id: string;
    active: boolean;
    amountMinor: number;
    readyInHours: number;
    instructions: string;
    instructionsT: Record<string, string>;
  } | null;
};

/** Every place of kind `shop` or `pickup`, with its pickup option when it has one, in the places' order. */
export async function listPickupPlaces(storeId: string): Promise<PickupPlaceRow[]> {
  const rows = await db().execute<Row>(sql`
    select l.id, l.name, l.kind, l.street, l.postal_code, l.city, l.country, m.currency,
      po.id as option_id, po.active, po.amount_minor, po.ready_in_hours, po.instructions, po.instructions_t
    from commerce.store_locations l
    left join commerce.markets m on m.store_id = l.store_id and m.code = l.country
    left join commerce.pickup_options po on po.store_id = l.store_id and po.location_id = l.id
    where l.store_id = ${storeId}::uuid and l.kind in ('shop', 'pickup')
    order by l.position, l.name, l.id
  `);
  return rows.map((r) => ({
    locationId: String(r.id),
    name: String(r.name ?? ""),
    kind: r.kind === "pickup" ? "pickup" : "shop",
    street: String(r.street ?? ""),
    postalCode: String(r.postal_code ?? ""),
    city: String(r.city ?? ""),
    country: String(r.country ?? "").trim(),
    sellsThere: r.currency !== null && r.currency !== undefined,
    currency: r.currency ? String(r.currency).trim() : null,
    option: r.option_id
      ? {
          id: String(r.option_id),
          active: Boolean(r.active),
          amountMinor: Number(r.amount_minor),
          readyInHours: Number(r.ready_in_hours),
          instructions: String(r.instructions ?? ""),
          instructionsT: (r.instructions_t ?? {}) as Record<string, string>,
        }
      : null,
  }));
}

export type PickupSaved = { ok: true; id: string } | { ok: false; problem: "invalid" | "not_found" | "not_market"; message: string } | ShippingRefused;

/**
 * Saves a place's pickup option (`pickupOptionInput`): created on first save, the market and currency taken from the place's country (a place in a country
 * the store does not sell to is refused, `not_market`; the database refuses an office, `pickup_options.place_kind`). Audit `shipping.pickup_saved` (ids,
 * the switch, the price in minor units; never the instructions), and the catalogue's tag (structured data and the chat read shipping).
 */
export async function savePickupOption(accountId: string, storeId: string, input: unknown): Promise<PickupSaved> {
  const parsed = pickupOptionInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "invalid", message: parsed.error.issues[0]?.message ?? "Check the fields and try again." };
  const p = parsed.data;
  const result = await shippingGuard(() =>
    db().transaction(async (tx): Promise<PickupSaved> => {
      const [place] = await tx.execute<Row>(sql`
        select l.id, l.country, m.currency from commerce.store_locations l
        left join commerce.markets m on m.store_id = l.store_id and m.code = l.country
        where l.store_id = ${storeId}::uuid and l.id = ${p.locationId}::uuid
      `);
      if (!place) return { ok: false, problem: "not_found", message: "This place no longer exists." };
      if (!place.currency) return { ok: false, problem: "not_market", message: "This place is not in a country you sell to." };
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.pickup_options (store_id, location_id, market_code, currency, amount_minor, ready_in_hours, instructions, instructions_t, active, position)
        values (${storeId}::uuid, ${p.locationId}::uuid, ${String(place.country).trim()}, ${String(place.currency).trim()}, ${p.amountMinor}, ${p.readyInHours},
                ${p.instructions}, ${JSON.stringify(p.instructionsT)}::jsonb, ${p.active},
                (select coalesce(max(position) + 1, 0) from commerce.pickup_options where store_id = ${storeId}::uuid))
        on conflict (store_id, location_id) do update set
          amount_minor = excluded.amount_minor, ready_in_hours = excluded.ready_in_hours, instructions = excluded.instructions,
          instructions_t = excluded.instructions_t, active = excluded.active, updated_at = now()
        returning id
      `);
      return { ok: true, id: String(row.id) };
    }),
  );
  if (result.ok) {
    await audit(accountId, storeId, "shipping.pickup_saved", { location: p.locationId, active: p.active, amountMinor: p.amountMinor, readyInHours: p.readyInHours }, {
      area: "settings",
      target: { type: "shipping", id: result.id },
    });
    refreshTag(catalogTag(storeId));
  }
  return result;
}

/**
 * How many orders still wait to be collected at a place: paid, not collected, not cancelled. Deleting the place is refused while any does
 * (`deleteLocation()`), because an order keeps its place's id without a foreign key (3.1).
 */
export async function pickupBlockers(runner: Runner, storeId: string, locationId: string): Promise<number> {
  const [row] = await runner.execute<Row>(sql`
    select count(*)::int as n from commerce.orders o
    where o.store_id = ${storeId}::uuid and o.pickup_location_id = ${locationId}::uuid and o.delivery_method = 'pickup'
      and o.status = 'paid' and o.copied_from is null
  `);
  return Number(row?.n ?? 0);
}

// ---------------------------------------------------------------------------
// The two buttons of a pickup order (orders:write)
// ---------------------------------------------------------------------------

/** The sentence staff read for each refusal (`pickupBlock()`'s codes and the server's own). */
export const PICKUP_REFUSALS: Record<PickupBlock | "not_found" | "changed" | "invalid" | "future" | "before_order" | "send", string> = {
  not_found: "This order no longer exists.",
  not_pickup: "This order is not collected at your place.",
  unpaid: "The order is not paid yet.",
  copied: "A copied order is history and is never handed over.",
  cancelled: "The order is cancelled.",
  closed: "The order is closed.",
  waiting_for_stock: "Part of this order is waiting for stock. When you have every item, confirm it and mark the order again.",
  edit_pending: "A change to this order waits for the customer's payment. Nothing is handed over until it is paid, cancelled or expired.",
  collected: "The order was collected already.",
  already_ready: "The order was marked ready already.",
  changed: "The order changed while you were looking at it. Look again.",
  invalid: "Check the day and try again.",
  future: "The order cannot have been collected in the future.",
  before_order: "The order cannot have been collected before it was placed.",
  send: "The handover could not be recorded.",
};
export type PickupRefusal = keyof typeof PICKUP_REFUSALS;
export type PickupRefused = { ok: false; reason: PickupRefusal; message: string };
const refused = (reason: PickupRefusal, message?: string): PickupRefused => ({ ok: false, reason, message: message ?? PICKUP_REFUSALS[reason] });

/** The facts `pickupBlock()` needs, read under the order's row lock. */
async function pickupFacts(tx: Runner, storeId: string, orderId: string, action: PickupAction, haveStock: boolean) {
  const [order] = await tx.execute<Row>(sql`
    select o.status, o.copied_from is not null as copied, o.delivery_method, o.ready_for_pickup_at, o.placed_at, s.time_zone,
      exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.method = 'pickup' and sh.undone_at is null) as collected,
      exists (select 1 from commerce.order_edits e where e.store_id = o.store_id and e.order_id = o.id and e.status = 'awaiting_payment') as edit_pending,
      exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.backorder_quantity > 0 and commerce.line_to_send(l.id) > 0) as waiting
    from commerce.orders o join commerce.stores s on s.id = o.store_id
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
    for update of o
  `);
  if (!order) return null;
  const block = pickupBlock(
    {
      deliveryMethod: order.delivery_method === "pickup" ? "pickup" : order.delivery_method === "local" ? "local" : "ship",
      status: String(order.status),
      copied: Boolean(order.copied),
      closed: order.status === "closed",
      // Units sold on backorder are still to send: staff confirm they have them before the order is handed over (`haveStock`).
      waitingForStock: Boolean(order.waiting) && !haveStock,
      editPending: Boolean(order.edit_pending),
      collected: Boolean(order.collected),
      readyForPickupAt: order.ready_for_pickup_at ? new Date(String(order.ready_for_pickup_at)).toISOString() : null,
    },
    action,
  );
  return { order, block };
}

const markInput = z.object({
  orderId: z.uuid(),
  /** The order's fulfilment as the screen saw it (D174's basis): another handover or a withdrawal in between answers `changed`. */
  seen: z.string().max(4000).nullish(),
  /** Staff confirm they have the units sold on backorder (D172): without it an order with such units waiting is refused `waiting_for_stock`. */
  haveStock: z.boolean().optional(),
});

export type ReadyDone =
  | { ok: true; readyAt: string; email: "sent" | "logged" | "failed" | "duplicate" | "suppressed" | null }
  | PickupRefused;

/**
 * *Ready for pickup* (2.2): under the order's lock, refused by `pickupBlock()` (unpaid, copied, cancelled, closed, waiting for stock, a change waiting for
 * payment, collected, marked already); sets `ready_for_pickup_at` once and writes `order.ready_for_pickup`; then the email, once per order (key
 * `order-ready:{order}`). A second press is `already_ready`; with `resend` it sends the email again only when the first one failed (or was never written),
 * under a key of its own for that failure, so a retry never doubles it.
 */
export async function markReadyForPickup(storeId: string, input: unknown, accountId: string | null, { resend = false }: { resend?: boolean } = {}): Promise<ReadyDone> {
  const parsed = markInput.safeParse(input);
  if (!parsed.success) return refused("not_found");
  const { orderId, seen, haveStock } = parsed.data;
  const marked = await db().transaction(async (tx): Promise<{ ok: true; readyAt: string } | PickupRefused> => {
    const facts = await pickupFacts(tx, storeId, orderId, "ready", haveStock === true);
    if (!facts) return refused("not_found");
    if (facts.block) return refused(facts.block);
    if (seen) {
      const found = await orderFulfilment(tx, storeId, orderId);
      if (found && found.basis !== seen) return refused("changed");
    }
    const [row] = await tx.execute<Row>(sql`
      update commerce.orders set ready_for_pickup_at = now()
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid and ready_for_pickup_at is null
      returning ready_for_pickup_at
    `);
    if (!row) return refused("already_ready");
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.ready_for_pickup', ${JSON.stringify({ by: accountId })}::jsonb, 'staff')
    `);
    return { ok: true, readyAt: new Date(String(row.ready_for_pickup_at)).toISOString() };
  });
  if (!marked.ok) {
    if (marked.reason !== "already_ready" || !resend) return marked;
    // *Send the email again*: only when the first did not go.
    const [first] = await db().execute<Row>(sql`
      select o.ready_for_pickup_at, e.id as email_id, e.status from commerce.orders o
      left join commerce.email_messages e on e.store_id = o.store_id and e.idempotency_key = ${`order-ready:${orderId}`}
      where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid
    `);
    if (!first?.ready_for_pickup_at) return marked;
    if (first.email_id && first.status !== "failed") return { ok: true, readyAt: new Date(String(first.ready_for_pickup_at)).toISOString(), email: "duplicate" };
    const key = first.email_id ? `order-ready:${orderId}:retry:${String(first.email_id)}` : `order-ready:${orderId}`;
    const email = await sendReadyForPickup(storeId, orderId, key).catch(() => "failed" as const);
    return { ok: true, readyAt: new Date(String(first.ready_for_pickup_at)).toISOString(), email };
  }
  const email = await sendReadyForPickup(storeId, orderId).catch(() => "failed" as const);
  return { ...marked, email };
}

const collectedInput = markInput.extend({
  /** The store day (`YYYY-MM-DD`) the customer collected; empty is today. */
  on: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Give the day as year-month-day.")
    .or(z.literal(""))
    .nullish()
    .transform((value) => value || null),
});

export type CollectedDone = { ok: true; deliveredAt: string; shipmentId: string } | PickupRefused;

/**
 * *Collected* (2.2, 4.4): in ONE transaction under the order's lock, the handover (`sendWithin()` with method `pickup`: every unit still to send, no
 * carrier, no tracking; the order `fulfilled` by `refresh_fulfilment()`), the receipt (`delivered_at` at noon of the day in the store's time zone, not in
 * the future, not before the order: `markDelivered()`'s rules) and `order.collected`. It does not need *Ready* first. No email (no *Picked up* email in this
 * run, and never the shipped one). A mistake is undone with `undoShipment()`.
 */
export async function markCollected(storeId: string, input: unknown, accountId: string | null, now = new Date()): Promise<CollectedDone> {
  const parsed = collectedInput.safeParse(input);
  if (!parsed.success) return refused("invalid", parsed.error.issues[0]?.message);
  const { orderId, seen, haveStock, on } = parsed.data;
  return db().transaction(async (tx): Promise<CollectedDone> => {
    const facts = await pickupFacts(tx, storeId, orderId, "collected", haveStock === true);
    if (!facts) return refused("not_found");
    if (facts.block) return refused(facts.block);
    const zone = String(facts.order.time_zone ?? "Europe/Oslo");
    const day = on ?? dayIn(now, zone);
    let at = noonOf(day, zone);
    if (at.getTime() > now.getTime()) {
      // Today's date (the order page's default) before noon is now; only a later day is in the future.
      if (day > dayIn(now, zone)) return refused("future");
      at = now;
    }
    if (day < dayIn(new Date(String(facts.order.placed_at)), zone)) return refused("before_order");
    const sent: SendOutcome = await sendWithin(tx, storeId, orderId, { carrier: "other", trackingNumber: "", trackingUrl: null }, accountId, null, { seen: seen ?? null }, "pickup");
    if (!sent.ok) {
      // Nothing is written: the transaction rolls back with the refusal.
      throw new HandoverRefused(sent);
    }
    await tx.execute(sql`
      update commerce.orders set delivered_at = ${at.toISOString()}::timestamptz
      where store_id = ${storeId}::uuid and id = ${orderId}::uuid
    `);
    await tx.execute(sql`
      insert into commerce.order_events (store_id, order_id, type, data, actor)
      values (${storeId}::uuid, ${orderId}::uuid, 'order.collected', ${JSON.stringify({ on: day, by: accountId, shipment: sent.shipment.id })}::jsonb, 'staff')
    `);
    return { ok: true, deliveredAt: at.toISOString(), shipmentId: sent.shipment.id };
  }).catch((error: unknown): CollectedDone => {
    if (error instanceof HandoverRefused) return handoverRefusal(error.outcome);
    throw error;
  });
}

/** A handover `sendWithin()` refused inside a transaction that also writes the receipt: thrown so nothing of it stays. */
export class HandoverRefused extends Error {
  constructor(readonly outcome: Extract<SendOutcome, { ok: false }>) {
    super(`handover refused: ${outcome.reason}`);
  }
}

/** A refusal of `sendWithin()` in a handover's words. */
export function handoverRefusal(outcome: Extract<SendOutcome, { ok: false }>): PickupRefused {
  switch (outcome.reason) {
    case "changed":
      return refused("changed");
    case "edit_pending":
      return refused("edit_pending");
    case "copied":
      return refused("copied");
    case "unpaid":
      return refused("unpaid");
    case "not_found":
      return refused("not_found");
    default:
      return refused("send", `${PICKUP_REFUSALS.send} ${outcome.reason === "nothing_to_send" || outcome.reason === "withdrawn_in_full" ? "Nothing of it is left to hand over." : ""}`.trim());
  }
}
