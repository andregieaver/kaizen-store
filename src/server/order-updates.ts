import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { UPDATE_PHASE, UPDATE_WORDS, type OrderUpdate } from "@/lib/order-update-email";
import type { OwnerToolInput } from "@/lib/owner-tools";

import { audit, type Account } from "./auth";
import { OwnerToolError } from "./owner-tool-error";
import { sendOrderUpdate } from "./shopper-emails";
import type { Store } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * Telling a customer how their order stands (`docs/100-day-challenge.md` C, D635): `tell_customer_about_order` sends one of the store's fixed
 * updates (`src/lib/order-update-email.ts`), never words a model wrote, and only when the store's own records say it is so: a delay only for a
 * paid order with goods still to send and not held (a held order is a person's), a parcel's update only while its tracking is in that phase.
 * Each update goes once per order. The order events' turns may use it, within the customer emails a week the owner allows the autopilot.
 */

type Ctx = { account: Account; store: Store };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const ORDER = z.object({ id: col.uuid, number: col.text, email: col.text, status: col.text, held: col.bool, to_send: col.int, copied: col.bool, gone: col.bool });
const PARCEL = z.object({ shipment_id: col.uuid });
const TOLD = z.object({ told: col.bool });

const keyOf = (orderId: string, update: OrderUpdate) => `order-update:${orderId}:${update}`;

/** What the store's records say for the update, or why it cannot be sent: the order, and for a parcel the shipment whose tracking says so. */
async function factsFor(store: Store, ref: string, update: OrderUpdate): Promise<{ orderId: string; number: string; shipmentId: string | null }> {
  const byId = /^[0-9a-f-]{36}$/i.test(ref);
  const order = await typedRow(
    ORDER,
    sql`
      select o.id, o.number, coalesce(o.email, '') as email, o.status, o.held_at is not null as held, o.copied_from is not null as copied,
        (o.restricted_at is not null or o.anonymised_at is not null) as gone,
        (select coalesce(sum(commerce.line_to_send(l.id)), 0)::int from commerce.order_lines l
         where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical') as to_send
      from commerce.orders o
      where o.store_id = ${store.id}::uuid and ${byId ? sql`o.id = ${ref}::uuid` : sql`o.number = ${ref.replace(/^#/, "")}`}
    `,
  );
  if (!order) return fail(`No order ${ref} in this store.`);
  if (order.copied) return fail(`Order ${ref} is history copied from another store: nothing is sent about it.`);
  if (order.gone || !order.email) return fail(`Order ${ref} has no email to write to.`);
  const told = await typedRow(TOLD, sql`select exists (select 1 from commerce.email_messages where idempotency_key = ${keyOf(order.id, update)}) as told`);
  if (told?.told) return fail(`The customer of order ${order.number} has already been told that ${UPDATE_WORDS[update]}.`);
  if (update === "delayed") {
    if (order.held) return fail(`Order ${order.number} is held: a person decides about it, and what its customer hears.`);
    if (!["paid", "authorized"].includes(order.status) || order.to_send <= 0) return fail(`Order ${order.number} has nothing left to send, so it is not delayed.`);
    return { orderId: order.id, number: order.number, shipmentId: null };
  }
  const parcel = await typedRow(
    PARCEL,
    sql`
      select t.shipment_id from commerce.shipment_tracking t
      join commerce.shipments sh on sh.store_id = t.store_id and sh.id = t.shipment_id and sh.undone_at is null
      where t.store_id = ${store.id}::uuid and t.order_id = ${order.id}::uuid and t.phase = ${UPDATE_PHASE[update]}
      order by t.checked_at desc nulls last limit 1
    `,
  );
  if (!parcel) return fail(`No parcel of order ${order.number} has tracking that says so: read it with get_order.`);
  return { orderId: order.id, number: order.number, shipmentId: parcel.shipment_id };
}

/** Checks an update before it is kept for a yes: the facts hold, and the customer was not told it before. */
export async function preflightTellCustomer({ store }: Ctx, input: OwnerToolInput<"tell_customer_about_order">): Promise<void> {
  await factsFor(store, input.order, input.about);
}

/** Sends the update on the owner's yes (or within the autopilot's emails a week), the facts read again first. */
export async function tellCustomerTool({ account, store }: Ctx, input: OwnerToolInput<"tell_customer_about_order">) {
  const facts = await factsFor(store, input.order, input.about);
  const outcome = await sendOrderUpdate(store.id, facts.orderId, input.about, facts.shipmentId);
  if (outcome === "duplicate") return fail(`The customer of order ${facts.number} has already been told that ${UPDATE_WORDS[input.about]}.`);
  if (outcome === null || outcome === "failed" || outcome === "suppressed") return fail("The email could not be sent. Try again later.");
  await audit(account.id, store.id, "order.customer_updated", { update: input.about }, { area: "orders", target: { type: "order", id: facts.orderId } });
  return {
    done: `${outcome === "logged" ? "Written (email is not set up here, so it was only logged)" : "Emailed"}: the customer of order ${facts.number} was told, in the store's own words and their language, that ${UPDATE_WORDS[input.about]}.`,
  };
}
