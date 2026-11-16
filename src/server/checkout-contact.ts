import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isContactMode, type CheckoutContactSettings } from "@/lib/checkout-contact";

import { auditChange } from "./audit";
import type { Membership } from "./auth";
import { memberCan } from "./permissions";
import { refreshTag } from "./refresh";
import { storeTag } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * Contact details at checkout (task 1 of `docs/checkout-fields-tasks.md`, D357): the only writer of `stores.checkout_phone` and
 * `stores.checkout_name` (`saveCheckoutContact()`, `settings:write`, audited `store.checkout_contact`), and of what a shopper typed for them on
 * an order waiting for payment (`saveOrderContact()`, into `orders.billing_address`, which a paid session then keeps where it gives none).
 */

const settingsRow = z.object({ checkout_phone: col.text, checkout_name: col.text });

export async function saveCheckoutContact(member: Membership, raw: { phone?: unknown; name?: unknown }): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  if (!memberCan(member, "settings:write")) return { ok: false, problems: ["Not allowed."] };
  const { phone, name } = raw;
  if (!isContactMode(phone) || !isContactMode(name)) return { ok: false, problems: ["Choose off, optional or required."] };
  const { store } = member;
  const was = await db().transaction(async (tx) => {
    const row = await typedRow(settingsRow, sql`select checkout_phone, checkout_name from commerce.stores where id = ${store.id}::uuid for update`, tx);
    await tx.execute(sql`update commerce.stores set checkout_phone = ${phone}, checkout_name = ${name} where id = ${store.id}::uuid`);
    return { phone: row?.checkout_phone ?? "off", name: row?.checkout_name ?? "off" };
  });
  const now: CheckoutContactSettings = { phone, name };
  if (was.phone !== now.phone || was.name !== now.name) {
    await auditChange(
      member,
      "store.checkout_contact",
      { type: "store", id: store.id, label: store.name },
      { checkoutPhone: was.phone, checkoutName: was.name },
      { checkoutPhone: now.phone, checkoutName: now.name },
      "store",
    );
  }
  refreshTag(storeTag(store.slug));
  return { ok: true };
}

/** Whether the store requires a phone of every order (Mollie's cart form and its check read it; our checkout page reads the store). */
export async function checkoutPhoneRequired(storeId: string): Promise<boolean> {
  const row = await typedRow(z.object({ checkout_phone: col.text }), sql`select checkout_phone from commerce.stores where id = ${storeId}::uuid`);
  return row?.checkout_phone === "required";
}

/**
 * What the shopper typed for the phone and the name on an order still waiting for payment, laid over its `billing_address` (a field left
 * empty keeps what is there). Already checked against what was asked (`cleanContact()`). False when the order is not this store's or not
 * waiting any more.
 */
export async function saveOrderContact(storeId: string, orderId: string, contact: { name: string | null; phone: string | null }): Promise<boolean> {
  const done = await db().execute(sql`
    update commerce.orders set
      billing_address = coalesce(billing_address, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('name', ${contact.name}::text, 'phone', ${contact.phone}::text))
    where store_id = ${storeId}::uuid and id = ${orderId}::uuid and status = 'pending_payment' and anonymised_at is null
    returning id
  `);
  return done.length > 0;
}
