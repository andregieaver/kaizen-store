import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { normaliseEmail } from "@/lib/email-address";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";
import { col, typedRows } from "./typed-rows";

/**
 * Deleting customers (`customers:write`): from a customer's page, or the people ticked on the list, such as test sign-ups (the Dream Factory's
 * drills on Kaizena Flow's own store). A customer with orders, a subscription, a subscription box or a creator profile is kept: those are the
 * business's records, and a person who wants to be forgotten asks under Privacy requests, which erases them properly. Of the others, the
 * customer row goes, with their own deals (those about them and no company), their notes and their tags; carts and their marketing and text
 * consents are kept without them (a consent is the store's proof); everything else that names them goes with them or forgets them, as the
 * database's keys say.
 */

/** How many customers one delete takes: one page of the list. */
export const DELETE_CUSTOMERS_MAX = 100;

export type DeleteCustomersResult =
  | { ok: true; deleted: number; deals: number; kept: { email: string; why: "records" }[] }
  | { ok: false; problem: "forbidden" | "none" | "too_many" };

export async function deleteCustomers(member: Membership, rawEmails: readonly string[]): Promise<DeleteCustomersResult> {
  if (!memberCan(member, "customers:write")) return { ok: false, problem: "forbidden" };
  const emails = [...new Set(rawEmails.map((email) => normaliseEmail(String(email))).filter(Boolean))];
  if (emails.length === 0) return { ok: false, problem: "none" };
  if (emails.length > DELETE_CUSTOMERS_MAX) return { ok: false, problem: "too_many" };
  const storeId = member.store.id;
  const list = JSON.stringify(emails);
  const result = await db().transaction(async (tx) => {
    const found = await typedRows(
      z.object({ id: col.uuid, email: col.text, records: col.bool }),
      sql`
        select c.id, lower(c.email) as email,
          (exists (select 1 from commerce.orders o where o.store_id = c.store_id and o.customer_id = c.id)
            or exists (select 1 from commerce.subscriptions s where s.store_id = c.store_id and s.customer_id = c.id)
            or exists (select 1 from commerce.standing_orders so where so.store_id = c.store_id and so.customer_id = c.id)
            or exists (select 1 from commerce.creators cr where cr.store_id = c.store_id and cr.customer_id = c.id)) as records
        from commerce.customers c
        where c.store_id = ${storeId}::uuid and lower(c.email) in (select jsonb_array_elements_text(${list}::jsonb))
        for update of c
      `,
      tx,
    );
    const going = found.filter((c) => !c.records);
    const kept = found.filter((c) => c.records).map((c) => ({ email: c.email, why: "records" as const }));
    if (going.length === 0) return { deleted: 0, deals: 0, kept, ids: [] as string[] };
    const ids = JSON.stringify(going.map((c) => c.id));
    const goingEmails = JSON.stringify(going.map((c) => c.email));
    const inIds = sql`(select (jsonb_array_elements_text(${ids}::jsonb))::uuid)`;
    // Their own deals: about them and no company. A deal with a company stays, without them (the key forgets them).
    const deals = await typedRows(
      z.object({ id: col.uuid }),
      sql`delete from commerce.deals where store_id = ${storeId}::uuid and customer_id in ${inIds} and company_id is null returning id`,
      tx,
    );
    // Kept without them: a cart, and the consents to marketing and texts (the store's proof of what was agreed).
    await tx.execute(sql`update commerce.carts set customer_id = null where store_id = ${storeId}::uuid and customer_id in ${inIds}`);
    await tx.execute(sql`update commerce.marketing_subscribers set customer_id = null where store_id = ${storeId}::uuid and customer_id in ${inIds}`);
    await tx.execute(sql`update commerce.sms_subscribers set customer_id = null where store_id = ${storeId}::uuid and customer_id in ${inIds}`);
    // Notes and tags are kept by address: theirs go with them.
    const byEmail = sql`(select jsonb_array_elements_text(${goingEmails}::jsonb))`;
    await tx.execute(sql`delete from commerce.customer_notes where store_id = ${storeId}::uuid and email in ${byEmail}`);
    await tx.execute(sql`delete from commerce.customer_tags where store_id = ${storeId}::uuid and email in ${byEmail}`);
    await tx.execute(sql`delete from commerce.customers where store_id = ${storeId}::uuid and id in ${inIds}`);
    return { deleted: going.length, deals: deals.length, kept, ids: going.map((c) => c.id) };
  });
  for (const id of result.ids) {
    await audit(member.account.id, storeId, "customer.deleted", { deals: result.deals }, { area: "customers", target: { type: "customer", id } });
  }
  return { ok: true, deleted: result.deleted, deals: result.deals, kept: result.kept };
}
