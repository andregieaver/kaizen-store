import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { ADDRESSES_MAX } from "@/lib/customer-addresses";
import type { MergeCounts, MergeRefusal } from "@/lib/customer-staff";
import { TAGS_PER_PERSON } from "@/lib/segments";

import { audit, type Membership } from "./auth";
import { addressCount, moveAddresses } from "./customer-addresses";
import { memberCan } from "./permissions";
import { moveTags, tagsTogether } from "./segments";
import { normaliseEmail } from "@/lib/email-address";

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/**
 * Merging two customers of a store (wave 10 unit C, D366): staff keep one account and fold another into it. What is the person's moves to
 * the account kept: orders (copied ones are history and only lose the removed account), subscriptions, open draft orders, carts, wishlists,
 * saved addresses, support conversations, Work clients, the tags and notes of the other address, custom field values the kept account has
 * none of, and the bonus balance as an entry granted to the kept account (never an edit of the ledger; the removed account's entries
 * go with it). The removed account is then deleted, which signs it out everywhere. A merge that would lose something is refused before anything changes, with a reason
 * staff read (`MergeRefusal`): a company, standing lists, reviews, the referral program, gift cards, credits still pending, or more
 * addresses or tags than one person may hold. The only writer of a merge; audited `customer.merged` with the counts, never a name or email.
 */

export type MergePlan = { ok: true; keep: string; remove: string; counts: MergeCounts } | { ok: false; refusal: MergeRefusal };

const count = (row: Row | undefined, key: string): number => Number(row?.[key] ?? 0);

/** The two accounts, locked in a fixed order so two merges never wait on each other the other way round. */
async function lockPair(tx: Tx, storeId: string, keep: string, remove: string): Promise<Map<string, Row>> {
  const rows = await tx.execute<Row>(sql`
    select id, lower(email) as email, company_id from commerce.customers
    where store_id = ${storeId}::uuid and id in (${keep}::uuid, ${remove}::uuid)
    order by id for update
  `);
  return new Map(rows.map((r) => [String(r.id), r]));
}

/** What a merge of `remove` into `keep` would do, or why it cannot, read inside the caller's transaction. */
async function planIn(tx: Tx, storeId: string, keep: string, remove: string): Promise<MergePlan> {
  if (keep === remove) return { ok: false, refusal: "same" };
  const pair = await lockPair(tx, storeId, keep, remove);
  const kept = pair.get(keep);
  const removed = pair.get(remove);
  if (!kept || !removed) return { ok: false, refusal: "not_found" };
  if (removed.company_id && String(removed.company_id) !== String(kept.company_id ?? "")) return { ok: false, refusal: "companies" };
  const [f] = await tx.execute<Row>(sql`
    select
      (select count(*)::int from commerce.standing_orders where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid and status <> 'cancelled') as deliveries,
      (select count(*)::int from commerce.product_reviews where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid) as reviews,
      (select count(*)::int from commerce.gift_cards where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid) as gift_cards,
      (select (exists (select 1 from commerce.affiliates where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid)
           -- A creator (D386) applied as this customer: their record is not moved to another.
           or exists (select 1 from commerce.creators where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid)
           or exists (select 1 from commerce.affiliate_attributions where store_id = ${storeId}::uuid
                        and (friend_customer_id = ${remove}::uuid or affiliate_customer_id = ${remove}::uuid))
           or exists (select 1 from commerce.customers where store_id = ${storeId}::uuid
                        and (referred_by_customer_id = ${remove}::uuid or (id = ${remove}::uuid and referred_by_customer_id is not null))))) as referrals,
      (select coalesce(b.pending_minor, 0) from commerce.bonus_balance(${storeId}::uuid, ${remove}::uuid) b) as bonus_pending,
      (select coalesce(b.available_minor, 0) from commerce.bonus_balance(${storeId}::uuid, ${remove}::uuid) b) as bonus_minor,
      (select count(*)::int from commerce.orders where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid) as orders,
      (select count(*)::int from commerce.subscriptions where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid) as subscriptions,
      (select count(*)::int from commerce.wishlists where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid) as wishlists,
      (select count(*)::int from commerce.customer_notes where store_id = ${storeId}::uuid and email = ${String(removed.email)}) as notes,
      (select count(*)::int from commerce.field_values where store_id = ${storeId}::uuid and entity = 'customer' and entity_id = ${remove}::uuid) as fields
  `);
  if (count(f, "deliveries") > 0) return { ok: false, refusal: "deliveries" };
  if (count(f, "reviews") > 0) return { ok: false, refusal: "reviews" };
  if (count(f, "gift_cards") > 0) return { ok: false, refusal: "gift_cards" };
  if (f?.referrals) return { ok: false, refusal: "referrals" };
  if (count(f, "bonus_pending") > 0) return { ok: false, refusal: "bonus_pending" };
  const addresses = await addressCount(tx, storeId, remove);
  if (addresses + (await addressCount(tx, storeId, keep)) > ADDRESSES_MAX) return { ok: false, refusal: "addresses" };
  if ((await tagsTogether(tx, storeId, String(kept.email), String(removed.email))) > TAGS_PER_PERSON) return { ok: false, refusal: "tags" };
  const [tags] = await tx.execute<Row>(sql`
    select count(*)::int as n from commerce.customer_tags where store_id = ${storeId}::uuid and email = ${String(removed.email)}
  `);
  return {
    ok: true,
    keep,
    remove,
    counts: {
      orders: count(f, "orders"),
      subscriptions: count(f, "subscriptions"),
      wishlists: count(f, "wishlists"),
      addresses,
      tags: count(tags, "n"),
      notes: count(f, "notes"),
      fields: count(f, "fields"),
      bonusMinor: count(f, "bonus_minor"),
    },
  };
}

/** The account a staff member names by email in the merge form, if it is another customer of the store. */
export async function customerIdByEmail(storeId: string, email: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select id from commerce.customers where store_id = ${storeId}::uuid and lower(email) = ${normaliseEmail(email)}
  `);
  return row ? String(row.id) : null;
}

/** Carries a preview's plan out of the transaction it was read in, which it rolls back. */
class Previewed extends Error {
  constructor(readonly plan: MergePlan) {
    super("customer_merge.preview");
  }
}

/** The preview staff read before they confirm: what would move, or why the merge is refused. Changes nothing (its transaction rolls back). */
export async function mergePreview(member: Membership, keep: string, remove: string): Promise<MergePlan> {
  if (!memberCan(member, "customers:write")) return { ok: false, refusal: "not_found" };
  if (!z.uuid().safeParse(keep).success || !z.uuid().safeParse(remove).success) return { ok: false, refusal: "not_found" };
  try {
    await db().transaction(async (tx) => {
      throw new Previewed(await planIn(tx, member.store.id, keep, remove));
    });
  } catch (error) {
    if (error instanceof Previewed) return error.plan;
    throw error;
  }
  return { ok: false, refusal: "not_found" };
}

/**
 * Folds `remove` into `keep` (`customers:write`), in one transaction under both accounts' row locks: the plan is read again there, so a
 * refusal found then changes nothing.
 */
export async function mergeCustomers(member: Membership, keep: string, remove: string): Promise<MergePlan> {
  if (!memberCan(member, "customers:write")) return { ok: false, refusal: "not_found" };
  if (!z.uuid().safeParse(keep).success || !z.uuid().safeParse(remove).success) return { ok: false, refusal: "not_found" };
  const storeId = member.store.id;
  const plan = await db().transaction(async (tx) => {
    const plan = await planIn(tx, storeId, keep, remove);
    if (!plan.ok) return plan;
    const [pair] = await tx.execute<Row>(sql`
      select (select lower(email) from commerce.customers where id = ${keep}::uuid) as keep_email,
             (select lower(email) from commerce.customers where id = ${remove}::uuid) as remove_email
    `);
    const keepEmail = String(pair.keep_email);
    const removeEmail = String(pair.remove_email);
    // The subscriber row of the removed account keeps its address and consent, and is cut loose from the account (the rules allow it here only).
    await tx.execute(sql`select set_config('kaizen.customer_merge', ${remove}, true)`);
    await tx.execute(sql`update commerce.marketing_subscribers set customer_id = null where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    // A copied order is history (D129): it may only lose its account.
    await tx.execute(sql`update commerce.orders set customer_id = null where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid and copied_from is not null`);
    await tx.execute(sql`update commerce.orders set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    await tx.execute(sql`update commerce.subscriptions set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    // Subscription box lists that are still open refuse the merge (the plan); cancelled ones are history and move with the person.
    await tx.execute(sql`update commerce.standing_orders set customer_id = ${keep}::uuid, updated_at = now() where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid and status = 'cancelled'`);
    await tx.execute(sql`update commerce.draft_orders set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid and status = 'open'`);
    await tx.execute(sql`update commerce.carts set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    await tx.execute(sql`update commerce.wishlists set customer_id = ${keep}::uuid, updated_at = now() where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    await tx.execute(sql`update commerce.wishlist_cart_adds set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    await tx.execute(sql`update commerce.support_conversations set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    await tx.execute(sql`update commerce.work_clients set customer_id = ${keep}::uuid where store_id = ${storeId}::uuid and customer_id = ${remove}::uuid`);
    // A code for named customers (a jsonb array of ids) names the kept one in the removed one's place, once.
    await tx.execute(sql`
      update commerce.discount_codes set customer_ids = (
        select coalesce(jsonb_agg(distinct v), '[]'::jsonb)
        from (select case when e = ${remove} then ${keep} else e end as v from jsonb_array_elements_text(customer_ids) e) t
      )
      where store_id = ${storeId}::uuid and customer_ids ? ${remove}
    `);
    const moved = await moveAddresses(tx, storeId, remove, keep);
    if (!moved.ok) throw new Error("customer_merge.addresses");
    // Custom fields: a value the kept account has none of (per language) moves; the others go with the removed account.
    await tx.execute(sql`
      update commerce.field_values v set entity_id = ${keep}::uuid
      where v.store_id = ${storeId}::uuid and v.entity = 'customer' and v.entity_id = ${remove}::uuid
        and not exists (select 1 from commerce.field_values k where k.store_id = v.store_id and k.entity = 'customer' and k.entity_id = ${keep}::uuid and k.locale = v.locale)
    `);
    // The bonus balance as an entry granted to the kept account, once per merge. The removed account's own ledger goes with the account
    // (its entries are deleted with it, as an erasure's are); a taking entry there would lose its allocations to that delete before the
    // ledger's check at commit, so the balance is moved by this grant alone, from the figure read under the lock.
    if (plan.counts.bonusMinor > 0) {
      const note = "Moved by a merge of two customers";
      await tx.execute(sql`select commerce.bonus_adjust(${storeId}::uuid, ${keep}::uuid, ${plan.counts.bonusMinor}, ${note}, ${member.account.id}::uuid, ${`merge:${remove}:in`})`);
    }
    if (removeEmail !== keepEmail) {
      await moveTags(tx, storeId, removeEmail, keepEmail);
      await tx.execute(sql`update commerce.customer_notes set email = ${keepEmail} where store_id = ${storeId}::uuid and email = ${removeEmail}`);
    }
    await tx.execute(sql`delete from commerce.customers where store_id = ${storeId}::uuid and id = ${remove}::uuid`);
    return plan;
  });
  if (plan.ok) {
    await audit(member.account.id, storeId, "customer.merged", { kept: keep, removed: remove, ...plan.counts }, { area: "customers", target: { type: "customer", id: keep } });
  }
  return plan;
}
