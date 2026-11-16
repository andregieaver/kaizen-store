import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { OwnerToolInput } from "@/lib/owner-tools";
import type { PermissionHolder } from "@/lib/permissions";
import { requestAddress } from "@/lib/support-actions";

import type { Account } from "./auth";
import { log } from "./log";
import { updateOrderContact } from "./order-admin";
import { OwnerToolError } from "./owner-tool-error";
import type { Store } from "./stores";
import { decideRequest } from "./support-actions";
import { managerStaffDesk } from "./support-desk";
import { sendRequestDecisionEmail } from "./support-email";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A customer's requests to staff carried out by code (`docs/100-day-challenge.md` B3, D640). A request the support chat passed to a person
 * (`request_staff_action`) is done by code only when the person asking is the order's own customer, signed in on the store's chat, or wrote
 * by email and confirmed it from the one-time link sent to the order's own address (D685, `src/server/request-confirm.ts`; never a visitor who
 * typed an order number, never an email on its own, whose sender can be anyone), and only before anything of the order is sent:
 *
 * - an address change, with the new address the customer gave as fields (`carry_out_address_change`), through the order page's own
 *   `updateOrderContact()`;
 * - a cancellation, through `cancel_order`, which refunds and so waits for the owner's yes (the refund queue in the challenge); the
 *   request is marked done when the order is cancelled (`closeCancelRequests()`).
 *
 * The request is decided through `decideRequest()`, so the customer is told in the conversation and by email as when a person decides it.
 */

type Ctx = { account: Account; store: Store; holder?: PermissionHolder };

const fail = (message: string): never => {
  throw new OwnerToolError(message);
};

const REQUEST = z.object({
  id: col.uuid,
  kind: col.text,
  status: col.text,
  args: z.unknown(),
  conversation_id: col.uuid,
  source: col.text,
  verified: col.bool,
  order_id: col.uuid.nullable(),
  order_number: col.textOrNull,
  order_status: col.textOrNull,
  sent: col.bool,
  held: col.bool,
});
type Request = z.output<typeof REQUEST>;

/** A request of the store with what code needs to judge it: its order by the number the customer gave, and whether the asker owns it. */
async function requestOf(store: Store, id: string): Promise<Request> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return fail("Give the request's id, from the support event or list_support_conversations.");
  const row = await typedRow(
    REQUEST,
    sql`
      select a.id, a.kind, a.status, a.args, a.conversation_id, c.source,
        coalesce((c.source = 'site' and c.customer_id is not null and o.id is not null and (
          o.customer_id = c.customer_id
          or exists (select 1 from commerce.customers cu where cu.store_id = c.store_id and cu.id = c.customer_id and lower(cu.email) = lower(o.email))
        )) or (c.source = 'email' and a.customer_confirmed_at is not null and o.id is not null and lower(c.contact_email) = lower(o.email)), false) as verified,
        o.id as order_id, o.number as order_number, o.status::text as order_status,
        exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id and sh.undone_at is null) as sent,
        coalesce(o.held_at is not null, false) as held
      from commerce.support_actions a
      join commerce.support_conversations c on c.id = a.conversation_id and c.store_id = a.store_id
      left join commerce.orders o on o.store_id = a.store_id and o.number = a.args ->> 'orderNumber' and o.copied_from is null
        and o.restricted_at is null and o.anonymised_at is null
      where a.store_id = ${store.id}::uuid and a.id = ${id}::uuid and a.confirmer = 'staff'
    `,
  );
  if (!row) return fail(`No support request ${id} in this store.`);
  return row;
}

/** Why code may not carry the request out, or null: open, the asker the order's own signed-in customer, nothing sent, not held. */
function refusal(r: Request, kind: "change_address" | "cancel_order"): string | null {
  if (r.kind !== kind) return `That request asks for something else (${r.kind}).`;
  if (r.status !== "proposed") return "That request has been decided already.";
  if (!r.order_id) return "The order the customer named is not one of the store's: a person answers it.";
  if (!r.verified) {
    return r.source === "site"
      ? "The person asking is not signed in as the order's customer, so code does not act on it: a person answers it."
      : "The request came by email and the customer has not confirmed it from the link sent to the order's own address, so code does not act on it: a person answers it.";
  }
  if (r.held) return `Order ${r.order_number} is held: a person decides about it.`;
  if (r.sent) return `Order ${r.order_number} has been sent already, so it cannot be changed: a person answers the customer.`;
  if (r.order_status !== "paid" && r.order_status !== "authorized") return `Order ${r.order_number} is ${r.order_status}, not a paid order waiting to be sent.`;
  return null;
}

/** The new address the customer gave, or why there is none to use. */
function addressOf(r: Request) {
  const raw = (r.args && typeof r.args === "object" ? (r.args as Record<string, unknown>).address : undefined) ?? null;
  const parsed = raw ? requestAddress.safeParse(raw) : null;
  return parsed?.success ? parsed.data : fail("The customer gave no full new address with the request: a person asks them for it.");
}

/** Checks an address change before it is kept for a yes. */
export async function preflightCarryOutAddressChange({ store }: Ctx, input: OwnerToolInput<"carry_out_address_change">): Promise<void> {
  const r = await requestOf(store, input.request);
  const why = refusal(r, "change_address");
  if (why) fail(why);
  addressOf(r);
}

/** Changes the order's delivery address to the one the customer asked for, then marks the request done and tells the customer. */
export async function carryOutAddressChangeTool({ account, store, holder }: Ctx, input: OwnerToolInput<"carry_out_address_change">) {
  const r = await requestOf(store, input.request);
  const why = refusal(r, "change_address");
  if (why) return fail(why);
  const address = addressOf(r);
  const email = await typedRow(z.object({ email: col.text }), sql`select email from commerce.orders where store_id = ${store.id}::uuid and id = ${r.order_id}::uuid`);
  const changed = await updateOrderContact(store.id, r.order_id!, {
    email: email?.email ?? "",
    shippingAddress: { name: address.name, line1: address.line1, line2: address.line2 || null, postalCode: address.postalCode, city: address.city, phone: address.phone || null },
  });
  if (!changed) return fail(`Order ${r.order_number}'s address could not be changed.`);
  const decided = await decideRequest(managerStaffDesk(account, store, holder ?? { role: "owner" }), r.id, "done", null);
  if (decided.ok) await sendRequestDecisionEmail(decided.conversationId, r.id).catch((error: unknown) => log("warn", "support.request_email_failed", { request: r.id }, error));
  return {
    done: `Order ${r.order_number} now goes to ${address.name}, ${address.line1}, ${address.postalCode} ${address.city}, as the customer asked. The customer is told in the conversation.`,
    admin: `/admin/${store.slug}/orders/${r.order_id}`,
  };
}

/** A request's refusal for a cancellation, for the event's turn and its checks (`cancel_order` itself checks the order). */
export async function cancelRequestRefusal(store: Store, id: string): Promise<string | null> {
  return refusal(await requestOf(store, id), "cancel_order");
}

/**
 * After an order is cancelled, its open cancellation requests are done (the customer told as when a person decides them). Never throws:
 * the cancellation stands whatever happens here.
 */
export async function closeCancelRequests(account: Account, store: Store, orderNumber: string, holder?: PermissionHolder): Promise<number> {
  try {
    const open = await typedRows(
      z.object({ id: col.uuid }),
      sql`select id from commerce.support_actions where store_id = ${store.id}::uuid and confirmer = 'staff' and kind = 'cancel_order' and status = 'proposed' and args ->> 'orderNumber' = ${orderNumber}`,
    );
    let closed = 0;
    for (const { id } of open) {
      const decided = await decideRequest(managerStaffDesk(account, store, holder ?? { role: "owner" }), id, "done", null);
      if (!decided.ok) continue;
      closed++;
      await sendRequestDecisionEmail(decided.conversationId, id).catch((error: unknown) => log("warn", "support.request_email_failed", { request: id }, error));
    }
    return closed;
  } catch (error) {
    log("error", "support.close_cancel_requests_failed", { store: store.id }, error);
    return 0;
  }
}
