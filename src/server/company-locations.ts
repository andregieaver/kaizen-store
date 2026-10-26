import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { BUYER_ROLES, cleanLocation, cleanPoNumber, LOCATIONS_MAX, type BuyerRole } from "@/lib/company-locations";
import type { SavedAddressFields } from "@/lib/customer-addresses";
import { toRates, type Rates } from "@/lib/currency";

import { audit, type Membership } from "./auth";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Company locations and buyer roles (wave 6 unit C2, D321, `docs/wave-6-catalogue.md` C.2): the only writer of `company_locations` and
 * `company_location_buyers`, and the reader of where a company member may buy and in what role. Staff edit locations and who buys at them on the
 * company's page; the company's main account is an approver at every location of its company without a row. Approvals are
 * `src/server/company-approvals.ts`.
 */

export type SaveResult = { ok: true; id?: string } | { ok: false; problems: string[] };

type Account = Membership["account"];
const wordsOf = (account: Account) => adminText(adminLangOf(account.adminLocale), "customers").locations;

const ADDRESS = z
  .object({ name: z.string(), line1: z.string(), line2: z.string().nullable(), postalCode: z.string(), city: z.string(), country: z.string() })
  .nullable();

const LOCATION_ROW = z.object({ id: col.uuid, name: col.text, billing_address: ADDRESS, shipping_address: ADDRESS });

export type LocationBuyer = { customerId: string; email: string; name: string; role: BuyerRole };
export type CompanyLocation = { id: string; name: string; billing: SavedAddressFields | null; shipping: SavedAddressFields | null; buyers: LocationBuyer[] };

/** A company's locations by name, each with who buys there (the main account is not listed: it approves everywhere). */
export async function listLocations(storeId: string, companyId: string): Promise<CompanyLocation[]> {
  const [locations, buyers] = await Promise.all([
    typedRows(LOCATION_ROW, sql`
      select id, name, billing_address, shipping_address from commerce.company_locations
      where store_id = ${storeId}::uuid and company_id = ${companyId}::uuid
      order by lower(name), id
    `),
    typedRows(z.object({ location_id: col.uuid, customer_id: col.uuid, email: col.text, name: col.text, role: z.enum(BUYER_ROLES) }), sql`
      select b.location_id, b.customer_id, c.email, c.name, b.role
      from commerce.company_location_buyers b
      join commerce.company_locations l on l.store_id = b.store_id and l.id = b.location_id
      join commerce.customers c on c.store_id = b.store_id and c.id = b.customer_id
      where b.store_id = ${storeId}::uuid and l.company_id = ${companyId}::uuid
      order by lower(c.email)
    `),
  ]);
  return locations.map((l) => ({
    id: l.id,
    name: l.name,
    billing: l.billing_address,
    shipping: l.shipping_address,
    buyers: buyers.filter((b) => b.location_id === l.id).map((b) => ({ customerId: b.customer_id, email: b.email, name: b.name, role: b.role })),
  }));
}

/** Makes a location (id null) or changes one, with its name and its billing and shipping addresses (each empty or whole). */
export async function saveLocation(
  { account, store }: Membership,
  companyId: string,
  id: string | null,
  raw: { name: unknown; billing: Record<string, unknown>; shipping: Record<string, unknown> },
): Promise<SaveResult> {
  const w = wordsOf(account);
  const cleaned = cleanLocation(raw);
  if (!cleaned.ok) return { ok: false, problems: [cleaned.missing === "name" ? w.problems.name : fillWords(w.problems.address, { field: w.fields[cleaned.missing] })] };
  const { name, billing, shipping } = cleaned.location;
  const company = await typedRow(z.object({ id: col.uuid, locations: col.int }), sql`
    select co.id, (select count(*)::int from commerce.company_locations l where l.store_id = co.store_id and l.company_id = co.id) as locations
    from commerce.customer_companies co where co.store_id = ${store.id}::uuid and co.id = ${companyId}::uuid
  `);
  if (!company) return { ok: false, problems: [w.problems.companyGone] };
  if (!id && company.locations >= LOCATIONS_MAX) return { ok: false, problems: [fillWords(w.problems.full, { max: LOCATIONS_MAX })] };
  const json = (address: SavedAddressFields | null) => (address ? JSON.stringify(address) : null);
  try {
    const row = id
      ? await typedRow(z.object({ id: col.uuid }), sql`
          update commerce.company_locations set name = ${name}, billing_address = ${json(billing)}::jsonb, shipping_address = ${json(shipping)}::jsonb, updated_at = now()
          where store_id = ${store.id}::uuid and company_id = ${companyId}::uuid and id = ${id}::uuid returning id
        `)
      : await typedRow(z.object({ id: col.uuid }), sql`
          insert into commerce.company_locations (store_id, company_id, name, billing_address, shipping_address)
          values (${store.id}::uuid, ${companyId}::uuid, ${name}, ${json(billing)}::jsonb, ${json(shipping)}::jsonb) returning id
        `);
    if (!row) return { ok: false, problems: [w.problems.gone] };
    await audit(account.id, store.id, id ? "company.location_updated" : "company.location_added", { company: companyId, location: row.id });
    return { ok: true, id: row.id };
  } catch (error) {
    const code = (error as { cause?: { code?: string } }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") return { ok: false, problems: [fillWords(w.problems.taken, { name })] };
    throw error;
  }
}

/** Deletes a location and who buys there; refused while an order waits for approval at it. Orders keep the location's name on themselves. */
export async function deleteLocation({ account, store }: Membership, companyId: string, id: string): Promise<SaveResult> {
  const w = wordsOf(account);
  const waiting = await typedRow(z.object({ n: col.int }), sql`
    select count(*)::int as n from commerce.orders
    where store_id = ${store.id}::uuid and company_location_id = ${id}::uuid and approval = 'waiting' and status = 'pending_payment'
  `);
  if ((waiting?.n ?? 0) > 0) return { ok: false, problems: [w.problems.waiting] };
  const gone = await typedRow(z.object({ id: col.uuid }), sql`
    delete from commerce.company_locations where store_id = ${store.id}::uuid and company_id = ${companyId}::uuid and id = ${id}::uuid returning id
  `);
  if (gone) await audit(account.id, store.id, "company.location_deleted", { company: companyId, location: id });
  return { ok: true };
}

/** Sets a member's role at a location (`orderer`, `approver`), or takes them off it (null). Only the company's own members; never its main account. */
export async function setBuyer({ account, store }: Membership, companyId: string, locationId: string, customerId: string, role: BuyerRole | null): Promise<SaveResult> {
  const w = wordsOf(account);
  const fits = await typedRow(z.object({ role: col.text.nullable() }), sql`
    select c.company_role as role
    from commerce.customers c
    join commerce.company_locations l on l.store_id = c.store_id and l.company_id = c.company_id and l.id = ${locationId}::uuid
    where c.store_id = ${store.id}::uuid and c.id = ${customerId}::uuid and c.company_id = ${companyId}::uuid
  `);
  if (!fits) return { ok: false, problems: [w.problems.notMember] };
  if (fits.role === "owner") return { ok: false, problems: [w.problems.mainAccount] };
  if (role === null) {
    await db().execute(sql`
      delete from commerce.company_location_buyers where store_id = ${store.id}::uuid and location_id = ${locationId}::uuid and customer_id = ${customerId}::uuid
    `);
  } else {
    await db().execute(sql`
      insert into commerce.company_location_buyers (store_id, location_id, customer_id, role) values (${store.id}::uuid, ${locationId}::uuid, ${customerId}::uuid, ${role})
      on conflict (location_id, customer_id) do update set role = excluded.role
    `);
  }
  await audit(account.id, store.id, "company.buyer_set", { company: companyId, location: locationId, role });
  return { ok: true };
}

/** Whether a company needs a PO number and the most an orderer's order may come to before it waits for approval (null: no limit). */
export async function saveCompanyRules(
  { account, store }: Membership,
  companyId: string,
  input: { poRequired: boolean; approvalLimitMinor: number | null; currency: string },
): Promise<SaveResult> {
  const w = wordsOf(account);
  if (input.approvalLimitMinor !== null && (!Number.isSafeInteger(input.approvalLimitMinor) || input.approvalLimitMinor <= 0)) return { ok: false, problems: [w.problems.limit] };
  const row = await typedRow(z.object({ id: col.uuid }), sql`
    update commerce.customer_companies set po_required = ${input.poRequired}, approval_limit_minor = ${input.approvalLimitMinor},
      approval_currency = ${input.approvalLimitMinor === null ? null : input.currency}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${companyId}::uuid returning id
  `);
  if (!row) return { ok: false, problems: [w.problems.companyGone] };
  await audit(account.id, store.id, "company.buying_rules_saved", { company: companyId, poRequired: input.poRequired, approvalLimitMinor: input.approvalLimitMinor });
  return { ok: true };
}

export type BuyerPlace = { id: string; name: string; role: BuyerRole; shipping: SavedAddressFields | null };
export type BuyerFacts = {
  companyId: string;
  companyName: string;
  poRequired: boolean;
  /** The company's approval limit, in its own currency; null for none. */
  limit: { minor: number; currency: string } | null;
  /** Where the member may buy and in what role: every location as an approver for the main account, else their rows. */
  places: BuyerPlace[];
  /** The store's exchange rates, to compare an order's total with the limit in its own currency. */
  rates: Rates;
};

/**
 * What a signed-in member's company asks of their orders (D321 C.2), or null for a customer who is not in an active company of a store that sells to
 * businesses. Read with a runner, so `placeOrder()` asks it inside its own transaction.
 */
export async function buyerFacts(storeId: string, customerId: string | null, run: Executor = db()): Promise<BuyerFacts | null> {
  if (!customerId) return null;
  const company = await typedRow(
    z.object({ id: col.uuid, name: col.text, po_required: col.bool, approval_limit_minor: col.minor.nullable(), approval_currency: col.currency.nullable(), role: col.text }),
    sql`
      select co.id, co.name, co.po_required, co.approval_limit_minor, co.approval_currency, c.company_role as role
      from commerce.customers c
      join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id and co.active
      where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid and c.company_role in ('owner', 'employee')
        and commerce.feature_on(c.store_id, 'business')
    `,
    run,
  );
  if (!company) return null;
  // The company's main account (its `company_role`, not a store membership) buys and approves at every location.
  const owner = company.role !== "employee";
  const currencies = await typedRows(z.object({ currency: col.currency, rate: z.union([z.number(), z.string()]).transform(Number).nullable() }), sql`
    select currency, rate from commerce.store_currencies where store_id = ${storeId}::uuid
  `, run);
  const places = await typedRows(z.object({ id: col.uuid, name: col.text, role: z.enum(BUYER_ROLES), shipping_address: ADDRESS }), sql`
    select l.id, l.name, ${owner ? sql`'approver'` : sql`b.role`} as role, l.shipping_address
    from commerce.company_locations l
    ${owner ? sql`` : sql`join commerce.company_location_buyers b on b.store_id = l.store_id and b.location_id = l.id and b.customer_id = ${customerId}::uuid`}
    where l.store_id = ${storeId}::uuid and l.company_id = ${company.id}::uuid
    order by lower(l.name), l.id
  `, run);
  return {
    companyId: company.id,
    companyName: company.name,
    poRequired: company.po_required,
    limit: company.approval_limit_minor !== null && company.approval_currency ? { minor: company.approval_limit_minor, currency: company.approval_currency } : null,
    places: places.map((p) => ({ id: p.id, name: p.name, role: p.role, shipping: p.shipping_address })),
    rates: toRates(currencies.map((c) => ({ currency: c.currency, rate: c.rate, roundTo: 1 }))),
  };
}

/**
 * Keeps a company member's choices on their cart: the location they buy for and the PO number. `placeOrder()` checks both again; this only refuses
 * what can never be right (a location not theirs, a PO number too long).
 */
export async function setCartCompanyPurchase(
  shop: { storeId: string },
  cartId: string,
  customerId: string | null,
  input: { locationId: string | null; poNumber: unknown },
): Promise<"ok" | "location" | "po_number" | "no_company"> {
  const facts = await buyerFacts(shop.storeId, customerId);
  if (!facts) return "no_company";
  if (input.locationId !== null && !facts.places.some((p) => p.id === input.locationId)) return "location";
  const po = cleanPoNumber(input.poNumber);
  if (!po.ok) return "po_number";
  await db().execute(sql`
    update commerce.carts set company_location_id = ${input.locationId}::uuid, po_number = ${po.po}, updated_at = now()
    where store_id = ${shop.storeId}::uuid and id = ${cartId}::uuid and status = 'open'
  `);
  return "ok";
}
