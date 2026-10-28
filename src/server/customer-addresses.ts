import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ADDRESSES_MAX, cleanLabel, type SavedAddress, type SavedAddressFields } from "@/lib/customer-addresses";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * A shopper's saved addresses (wave 5 unit J1, D304, `docs/wave-5-marketing.md` 11.1). The only writer of `commerce.customer_addresses`: every
 * function takes the store and the signed-in customer, so another customer's address is `not_found`, never a different answer. After each change
 * `customers.address` is set to the default shipping address (empty without one), for the readers that still read it.
 */

export type AddressOutcome = { ok: true; id: string } | { ok: false; reason: "not_found" | "too_many" };

const toSaved = (row: Row): SavedAddress => {
  const a = (row.address ?? {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === "string" ? v : "");
  return {
    id: String(row.id),
    label: String(row.label ?? ""),
    address: { name: s(a.name), line1: s(a.line1), line2: s(a.line2) || null, postalCode: s(a.postalCode), city: s(a.city), country: String(row.country) },
    isDefaultShipping: Boolean(row.is_default_shipping),
    isDefaultBilling: Boolean(row.is_default_billing),
  };
};

/** The customer's saved addresses, the default shipping one first, then the newest. */
export async function listAddresses(storeId: string, customerId: string): Promise<SavedAddress[]> {
  const rows = await db().execute<Row>(sql`
    select id, label, address, country, is_default_shipping, is_default_billing from commerce.customer_addresses
    where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
    order by is_default_shipping desc, is_default_billing desc, created_at desc, id
  `);
  return rows.map(toSaved);
}

/** Locks the customer, so two saves cannot both become the default or pass the limit together. */
async function lockCustomer(tx: Tx, storeId: string, customerId: string): Promise<boolean> {
  const rows = await tx.execute(sql`select 1 from commerce.customers where store_id = ${storeId}::uuid and id = ${customerId}::uuid for update`);
  return rows.length > 0;
}

/** Keeps `customers.address` equal to the default shipping address; a customer with addresses but no default gets the newest as both. */
async function settle(tx: Tx, storeId: string, customerId: string): Promise<void> {
  for (const kind of ["shipping", "billing"] as const) {
    const column = kind === "shipping" ? sql`is_default_shipping` : sql`is_default_billing`;
    await tx.execute(sql`
      update commerce.customer_addresses set ${column} = true, updated_at = now()
      where id = (select id from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid order by created_at desc, id limit 1)
        and not exists (select 1 from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and ${column})
    `);
  }
  await tx.execute(sql`
    update commerce.customers c set address = coalesce(
      (select a.address from commerce.customer_addresses a where a.store_id = c.store_id and a.customer_id = c.id and a.is_default_shipping), '{}'::jsonb),
      updated_at = now()
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
}

async function clearDefault(tx: Tx, storeId: string, customerId: string, kind: "shipping" | "billing"): Promise<void> {
  await tx.execute(
    kind === "shipping"
      ? sql`update commerce.customer_addresses set is_default_shipping = false, updated_at = now() where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and is_default_shipping`
      : sql`update commerce.customer_addresses set is_default_billing = false, updated_at = now() where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and is_default_billing`,
  );
}

export type AddressInput = {
  /** An address of the customer's to change; absent adds one. */
  id?: string;
  label?: string;
  address: SavedAddressFields;
  defaultShipping?: boolean;
  defaultBilling?: boolean;
};

/** Adds or changes one of the customer's addresses (the first one is the default for both). */
export async function saveAddress(storeId: string, customerId: string, input: AddressInput): Promise<AddressOutcome> {
  return db().transaction((tx) => saveAddressIn(tx, storeId, customerId, input));
}

async function saveAddressIn(tx: Tx, storeId: string, customerId: string, input: AddressInput): Promise<AddressOutcome> {
  if (!(await lockCustomer(tx, storeId, customerId))) return { ok: false, reason: "not_found" };
  const label = cleanLabel(input.label ?? "");
  const json = JSON.stringify(input.address);
  let id = input.id;
  if (id) {
    const [found] = await tx.execute<Row>(sql`
      select id from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and id = ${id}::uuid
    `);
    if (!found) return { ok: false, reason: "not_found" };
  } else {
    const [count] = await tx.execute<Row>(sql`
      select count(*)::int as n from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
    `);
    if (Number(count?.n ?? 0) >= ADDRESSES_MAX) return { ok: false, reason: "too_many" };
  }
  if (input.defaultShipping) await clearDefault(tx, storeId, customerId, "shipping");
  if (input.defaultBilling) await clearDefault(tx, storeId, customerId, "billing");
  if (id) {
    await tx.execute(sql`
      update commerce.customer_addresses set label = ${input.label === undefined ? sql`label` : sql`${label}`}, address = ${json}::jsonb, country = ${input.address.country},
        is_default_shipping = is_default_shipping or ${Boolean(input.defaultShipping)},
        is_default_billing = is_default_billing or ${Boolean(input.defaultBilling)}, updated_at = now()
      where store_id = ${storeId}::uuid and id = ${id}::uuid
    `);
  } else {
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.customer_addresses (store_id, customer_id, label, address, country, is_default_shipping, is_default_billing)
      values (${storeId}::uuid, ${customerId}::uuid, ${label}, ${json}::jsonb, ${input.address.country},
        ${Boolean(input.defaultShipping)}, ${Boolean(input.defaultBilling)})
      returning id
    `);
    id = String(row.id);
  }
  await settle(tx, storeId, customerId);
  return { ok: true, id };
}

/**
 * My account's details form (D28) edits the default shipping address: it changes that one, or adds the first. An emptied address leaves the
 * saved ones as they are (the Addresses page removes one).
 */
export async function saveDefaultAddress(storeId: string, customerId: string, address: SavedAddressFields): Promise<AddressOutcome> {
  return db().transaction((tx) => saveDefaultAddressIn(tx, storeId, customerId, address));
}

/** `saveDefaultAddress()` inside a transaction of the caller's (staff's edit of a customer, D366, writes the customer and the address together). */
export async function saveDefaultAddressIn(tx: Tx, storeId: string, customerId: string, address: SavedAddressFields): Promise<AddressOutcome> {
  if (!(await lockCustomer(tx, storeId, customerId))) return { ok: false, reason: "not_found" } as const;
  const [current] = await tx.execute<Row>(sql`
    select id from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and is_default_shipping
  `);
  return saveAddressIn(tx, storeId, customerId, current ? { id: String(current.id), address } : { address, defaultShipping: true, defaultBilling: true });
}

/** How many addresses a customer has saved (a merge checks the two together against `ADDRESSES_MAX` before it starts). */
export async function addressCount(tx: Tx, storeId: string, customerId: string): Promise<number> {
  const [row] = await tx.execute<Row>(sql`
    select count(*)::int as n from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid
  `);
  return Number(row?.n ?? 0);
}

/**
 * A merge (D366) moves one customer's saved addresses to another of the same store, in the merge's transaction: they come as the kept
 * customer's other addresses (never the defaults the kept one has; the newest becomes the default only when it had none), and both
 * customers' `customers.address` follow. Refused as `too_many` when the two would hold more than `ADDRESSES_MAX`. The number moved.
 */
export async function moveAddresses(tx: Tx, storeId: string, fromCustomerId: string, toCustomerId: string): Promise<{ ok: true; moved: number } | { ok: false; reason: "too_many" }> {
  const [from, to] = [await addressCount(tx, storeId, fromCustomerId), await addressCount(tx, storeId, toCustomerId)];
  if (from + to > ADDRESSES_MAX) return { ok: false, reason: "too_many" };
  if (from === 0) return { ok: true, moved: 0 };
  await tx.execute(sql`
    update commerce.customer_addresses set customer_id = ${toCustomerId}::uuid, is_default_shipping = false, is_default_billing = false, updated_at = now()
    where store_id = ${storeId}::uuid and customer_id = ${fromCustomerId}::uuid
  `);
  await settle(tx, storeId, toCustomerId);
  await settle(tx, storeId, fromCustomerId);
  return { ok: true, moved: from };
}

/** Takes one of the customer's addresses away; a default it was passes to the newest left. */
export async function removeAddress(storeId: string, customerId: string, id: string): Promise<AddressOutcome> {
  return db().transaction(async (tx) => {
    if (!(await lockCustomer(tx, storeId, customerId))) return { ok: false, reason: "not_found" } as const;
    const gone = await tx.execute(sql`
      delete from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and id = ${id}::uuid returning id
    `);
    if (!gone.length) return { ok: false, reason: "not_found" } as const;
    await settle(tx, storeId, customerId);
    return { ok: true, id } as const;
  });
}

/** Makes one of the customer's addresses the default for shipping or billing. */
export async function setDefaultAddress(storeId: string, customerId: string, id: string, kind: "shipping" | "billing"): Promise<AddressOutcome> {
  return db().transaction(async (tx) => {
    if (!(await lockCustomer(tx, storeId, customerId))) return { ok: false, reason: "not_found" } as const;
    const [found] = await tx.execute<Row>(sql`
      select id from commerce.customer_addresses where store_id = ${storeId}::uuid and customer_id = ${customerId}::uuid and id = ${id}::uuid
    `);
    if (!found) return { ok: false, reason: "not_found" } as const;
    await clearDefault(tx, storeId, customerId, kind);
    await tx.execute(
      kind === "shipping"
        ? sql`update commerce.customer_addresses set is_default_shipping = true, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`
        : sql`update commerce.customer_addresses set is_default_billing = true, updated_at = now() where store_id = ${storeId}::uuid and id = ${id}::uuid`,
    );
    await settle(tx, storeId, customerId);
    return { ok: true, id } as const;
  });
}
