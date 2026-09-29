import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { memberDiscount, tierInput, type MemberDiscount, type TierInput } from "@/lib/customer-tiers";

import { audit, type Membership } from "./auth";
import { preRegisterCustomer } from "./customers";
import type { SaveResult } from "./settings";

type Row = Record<string, unknown>;
type Runner = Pick<ReturnType<typeof db>, "execute">;

/**
 * Discount groups (D108): what staff make (a name and a fixed percentage off),
 * who is in them, and what a customer's discount comes to when they buy.
 * A customer's discount is the better of their own group's and their
 * company's (`memberDiscount()`); a group or company switched off gives none.
 */

export type Tier = {
  id: string;
  name: string;
  percent: number;
  note: string;
  active: boolean;
  /** Customers put in it directly. */
  customers: number;
  /** Companies whose members get its discount. */
  companies: number;
};

const toTier = (row: Row): Tier => ({
  id: String(row.id),
  name: String(row.name),
  percent: Number(row.percent),
  note: String(row.note ?? ""),
  active: Boolean(row.active),
  customers: Number(row.customers ?? 0),
  companies: Number(row.companies ?? 0),
});

const tierQuery = (where: ReturnType<typeof sql>) => sql`
  select t.*,
    (select count(*)::int from commerce.customers c where c.store_id = t.store_id and c.tier_id = t.id) as customers,
    (select count(*)::int from commerce.customer_companies co where co.store_id = t.store_id and co.tier_id = t.id) as companies
  from commerce.customer_tiers t
  where ${where}
  order by t.active desc, t.percent desc, lower(t.name)
`;

export async function listTiers(storeId: string): Promise<Tier[]> {
  return (await db().execute<Row>(tierQuery(sql`t.store_id = ${storeId}::uuid`))).map(toTier);
}

export async function getTier(storeId: string, id: string): Promise<Tier | null> {
  const [row] = await db().execute<Row>(tierQuery(sql`t.store_id = ${storeId}::uuid and t.id = ${id}::uuid`));
  return row ? toTier(row) : null;
}

/** Creates a group (id null) or changes one. Orders already placed keep what they got. */
export async function saveTier({ account, store }: Membership, id: string | null, input: TierInput): Promise<SaveResult & { id?: string }> {
  const parsed = tierInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const d = parsed.data;
  if (id && !(await getTier(store.id, id))) return { ok: false, problems: ["The group no longer exists."] };
  try {
    const [row] = id
      ? await db().execute<Row>(sql`
          update commerce.customer_tiers set name = ${d.name}, percent = ${d.percent}, note = ${d.note}, active = ${d.active}, updated_at = now()
          where store_id = ${store.id}::uuid and id = ${id}::uuid returning id
        `)
      : await db().execute<Row>(sql`
          insert into commerce.customer_tiers (store_id, name, percent, note, active)
          values (${store.id}::uuid, ${d.name}, ${d.percent}, ${d.note}, ${d.active}) returning id
        `);
    await audit(account.id, store.id, id ? "tier.updated" : "tier.created", { name: d.name, percent: d.percent });
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const code = (error as { cause?: { code?: string }; code?: string }).cause?.code ?? (error as { code?: string }).code;
    if (code === "23505") return { ok: false, problems: [`The store already has a group called ${d.name}.`] };
    throw error;
  }
}

/** Deletes a group nobody is in; one in use is switched off instead, so no one loses a discount by mistake. */
export async function deleteTier({ account, store }: Membership, id: string): Promise<SaveResult> {
  const tier = await getTier(store.id, id);
  if (!tier) return { ok: true };
  if (tier.customers + tier.companies > 0) {
    return { ok: false, problems: ["Customers or companies are in this group. Move them out first, or switch the group off."] };
  }
  await db().execute(sql`delete from commerce.customer_tiers where store_id = ${store.id}::uuid and id = ${id}::uuid`);
  await audit(account.id, store.id, "tier.deleted", { name: tier.name });
  return { ok: true };
}

export type TierMember = { id: string; email: string; name: string; companyName: string | null };

/** The customers put in a group directly. */
export async function tierMembers(storeId: string, tierId: string): Promise<TierMember[]> {
  const rows = await db().execute<Row>(sql`
    select c.id, c.email, c.name, co.name as company_name
    from commerce.customers c
    left join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id
    where c.store_id = ${storeId}::uuid and c.tier_id = ${tierId}::uuid
    order by lower(c.email)
    limit 500
  `);
  return rows.map((r) => ({ id: String(r.id), email: String(r.email), name: String(r.name), companyName: r.company_name ? String(r.company_name) : null }));
}

/** Puts a customer in a group, or takes them out (null). */
export async function setCustomerTier({ account, store }: Membership, customerId: string, tierId: string | null): Promise<SaveResult> {
  if (tierId && !(await getTier(store.id, tierId))) return { ok: false, problems: ["The group no longer exists."] };
  const [row] = await db().execute<Row>(sql`
    update commerce.customers set tier_id = ${tierId}::uuid, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${customerId}::uuid returning email
  `);
  if (!row) return { ok: false, problems: ["The customer no longer exists."] };
  await audit(account.id, store.id, "customer.tier", { customerId, tierId });
  return { ok: true };
}

/**
 * Puts the customer with this email in a group. Someone with no account yet
 * gets one made ahead of them, with the email not proven: they prove it the
 * first time they sign in, and the group's discount is waiting.
 */
export async function addToTierByEmail(member: Membership, tierId: string, email: string): Promise<SaveResult> {
  const address = email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address) || address.length > 254) return { ok: false, problems: ["That is not an email address."] };
  if (!(await getTier(member.store.id, tierId))) return { ok: false, problems: ["The group no longer exists."] };
  const customerId = await preRegisterCustomer(member.store.id, address);
  return setCustomerTier(member, customerId, tierId);
}

/**
 * What a customer's group and company give them (D108), read from the
 * store's data: null for a guest, someone in no group, or a group or company
 * that is switched off. Checkout reads it inside its transaction, the cart
 * outside it, so both work out the same discount.
 */
export async function memberDiscountFor(runner: Runner, storeId: string, customerId: string | null): Promise<MemberDiscount | null> {
  if (!customerId) return null;
  const [row] = await runner.execute<Row>(sql`
    select t.name as tier_name, t.percent as tier_percent, t.active as tier_active,
           co.name as company_name, co.active as company_active, co.employee_share_percent, c.company_role,
           ct.percent as company_tier_percent, ct.active as company_tier_active
    from commerce.customers c
    left join commerce.customer_tiers t on t.store_id = c.store_id and t.id = c.tier_id
    left join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id
    left join commerce.customer_tiers ct on ct.store_id = co.store_id and ct.id = co.tier_id
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
  if (!row) return null;
  return memberDiscount({
    own: row.tier_name && row.tier_active ? { name: String(row.tier_name), percent: Number(row.tier_percent) } : null,
    company:
      row.company_name && (row.company_role === "owner" || row.company_role === "employee")
        ? {
            name: String(row.company_name),
            active: Boolean(row.company_active),
            tier: row.company_tier_percent !== null && row.company_tier_active ? { percent: Number(row.company_tier_percent) } : null,
            sharePercent: Number(row.employee_share_percent),
            role: row.company_role,
          }
        : null,
  });
}

/**
 * The customer groups a customer is in: their own, and their company's while
 * the company is switched on (D108). What a campaign for chosen groups reads
 * (D115); like the discount, it follows the membership, so leaving stops it.
 */
export async function customerTierIds(runner: Runner, storeId: string, customerId: string | null): Promise<string[]> {
  if (!customerId) return [];
  const [row] = await runner.execute<Row>(sql`
    select t.id as own, t.active as own_active, ct.id as company, ct.active as company_tier_active, co.active as company_active
    from commerce.customers c
    left join commerce.customer_tiers t on t.store_id = c.store_id and t.id = c.tier_id
    left join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id
    left join commerce.customer_tiers ct on ct.store_id = co.store_id and ct.id = co.tier_id
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
  if (!row) return [];
  return [
    row.own && row.own_active ? String(row.own) : null,
    row.company && row.company_tier_active && row.company_active ? String(row.company) : null,
  ].filter((id): id is string => id !== null);
}

/** A customer's group and company, for their page in the admin. */
export async function customerAccess(storeId: string, customerId: string): Promise<{ tierId: string | null; companyId: string | null; companyName: string | null; role: string | null } | null> {
  const [row] = await db().execute<Row>(sql`
    select c.tier_id, c.company_id, co.name as company_name, c.company_role
    from commerce.customers c
    left join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id
    where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
  `);
  return row
    ? { tierId: row.tier_id ? String(row.tier_id) : null, companyId: row.company_id ? String(row.company_id) : null, companyName: row.company_name ? String(row.company_name) : null, role: row.company_role ? String(row.company_role) : null }
    : null;
}
