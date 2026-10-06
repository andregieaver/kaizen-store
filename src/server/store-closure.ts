import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { siteUrl } from "@/lib/site";
import {
  closureBlockers,
  confirmationMatches,
  ownerMayReopen,
  reopenDeadline,
  type Obligations,
  type StoreStatus,
} from "@/lib/store-closure";
import { statusEmail } from "@/lib/store-closure-emails";

import { audit, type Account } from "./auth";
import { cancelPlan } from "./billing";
import { closeSession, completeOrderPayment } from "./checkout";
import { listStoreDomains, removeStoreDomain } from "./domains";
import { sendEmail } from "./email";
import { refreshTag } from "./refresh";
import { getCheckoutAccount } from "./settings";
import { platformStripe } from "./stripe";
import { storeTag } from "./stores";

/**
 * Closing, suspending and reopening a store (D171, `docs/store-closure.md`). Authorisation is the caller's (the owner's action asks `checkOwnerRole()`, the
 * platform's asks a platform admin); the rules of the steps a status may take and of refusing orders in a store that is not open are the database's
 * (`commerce.stores_status_rules()`, `orders_store_open()`), so nothing here can sell in a closed store or skip a step. Nothing is deleted: a store with
 * sales is kept for the bookkeeping period, and the retention job anonymises it when that is over.
 */

type Row = Record<string, unknown>;
type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Executor = Pick<ReturnType<typeof db>, "execute"> | Tx;

export type ClosureResult = { ok: true; warnings: string[] } | { ok: false; problems: string[] };

export type StoreStateInfo = {
  id: string;
  slug: string;
  name: string;
  status: StoreStatus;
  reason: string | null;
  closedAt: Date | null;
  isTemplate: boolean;
};

const fail = (...problems: string[]): ClosureResult => ({ ok: false, problems });

/** A store's status, read now (never the cached store), or null. */
export async function storeState(storeId: string, executor: Executor = db()): Promise<StoreStateInfo | null> {
  const [row] = await executor.execute<Row>(sql`
    select id, slug, name, status, status_reason, closed_at, is_template from commerce.stores where id = ${storeId}::uuid
  `);
  if (!row) return null;
  return {
    id: String(row.id),
    slug: String(row.slug),
    name: String(row.name),
    status: row.status as StoreStatus,
    reason: row.status_reason ? String(row.status_reason) : null,
    closedAt: row.closed_at ? new Date(String(row.closed_at)) : null,
    isTemplate: Boolean(row.is_template),
  };
}

/**
 * What a store still has open, counted now. A paid order is *to send* while it holds goods and its payment is a real one (a test payment is no
 * obligation); a subscription or a weekly list is running while customers expect the next delivery.
 */
export async function storeObligations(storeId: string, executor: Executor = db()): Promise<Obligations> {
  const [row] = await executor.execute<Row>(sql`
    select
      (select count(*)::int from commerce.orders o
        where o.store_id = ${storeId}::uuid and o.status = 'paid' and o.copied_from is null
          and exists (select 1 from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.delivery = 'physical' and not l.gift)
          and not coalesce((select bool_and(p.test_mode) from commerce.payments p where p.store_id = o.store_id and p.order_id = o.id), false)
      ) as paid_unshipped,
      (select count(*)::int from commerce.subscriptions s where s.store_id = ${storeId}::uuid and s.status in ('active', 'past_due', 'paused')) as subscriptions,
      (select count(*)::int from commerce.standing_orders d where d.store_id = ${storeId}::uuid and d.status in ('active', 'paused')) as deliveries,
      (select count(*)::int from commerce.orders o where o.store_id = ${storeId}::uuid and o.status = 'pending_payment' and o.copied_from is null) as checkouts,
      (select count(*)::int from commerce.bookings b where b.store_id = ${storeId}::uuid and b.status in ('held', 'confirmed') and b.starts_at > now()) as bookings,
      (select count(*)::int from commerce.returns r where r.store_id = ${storeId}::uuid and r.status in ('requested', 'approved', 'in_transit', 'received', 'inspected')) as returns,
      exists (select 1 from commerce.store_billing b where b.store_id = ${storeId}::uuid and b.subscription_id is not null
        and coalesce(b.status, '') not in ('canceled', 'incomplete_expired') and not b.cancel_at_period_end) as live_plan,
      (select count(*)::int from commerce.store_domains d where d.store_id = ${storeId}::uuid) as domains
  `);
  return {
    paidUnshipped: Number(row?.paid_unshipped ?? 0),
    runningSubscriptions: Number(row?.subscriptions ?? 0),
    runningDeliveries: Number(row?.deliveries ?? 0),
    openCheckouts: Number(row?.checkouts ?? 0),
    futureBookings: Number(row?.bookings ?? 0),
    openReturns: Number(row?.returns ?? 0),
    livePlan: Boolean(row?.live_plan),
    domains: Number(row?.domains ?? 0),
  };
}

export type CloseOptions = {
  by: "owner" | "platform";
  /** What the owner typed to confirm (the store's address): checked for an owner's closing. */
  typed?: string;
  /** Why, for a closing by the platform. */
  reason?: string | null;
  /** The platform may close a store whatever is open; an owner never. */
  force?: boolean;
};

/**
 * Closes a store: sales stop at once (the status), the Kaizen plan ends at the end of the period paid for, orders waiting for payment are cancelled, the
 * store's own domains are released, and the owners are told. An owner's closing is refused while paid goods are still to send or customers have
 * running subscriptions or weekly deliveries; the platform may force it. Safe to repeat: a store already closed is refused, nothing half-done is left
 * that a second try cannot finish.
 */
export async function closeStore(actor: Account, storeId: string, options: CloseOptions): Promise<ClosureResult> {
  const state = await storeState(storeId);
  if (!state) return fail("That store is gone.");
  if (state.isTemplate) return fail("The template store cannot be closed.");
  if (state.status === "closed") return fail("The store is already closed.");
  if (options.by === "platform" && !actor.platformAdmin) return fail("Only the platform can do this.");
  if (options.by === "owner" && state.status !== "active") return fail("Kaizen has suspended this store: write to Kaizen about it.");
  if (options.by === "owner" && !confirmationMatches(options.typed ?? "", state.slug)) return fail("Type the store's address to confirm.");

  const obligations = await storeObligations(storeId);
  const blockers = closureBlockers(obligations);
  if (blockers.length > 0 && !(options.by === "platform" && options.force)) return fail(...blockers);

  // The plan first: if Stripe cannot end it, nothing is closed, so a store is never closed and still billed.
  let planEnded = false;
  if (obligations.livePlan) {
    const ended = await cancelPlan(actor, storeId, "period_end");
    if (!ended.ok) return fail(`Kaizen could not end the plan (${ended.problems.join(" ")}). Nothing was closed. Try again in a moment.`);
    planEnded = true;
  }

  const closed = await db().transaction(async (tx): Promise<string[] | null> => {
    // The store row is locked and what is open is counted again under the lock, so an order paid a second ago cannot slip past the check.
    await tx.execute(sql`select 1 from commerce.stores where id = ${storeId}::uuid for update`);
    const again = closureBlockers(await storeObligations(storeId, tx));
    if (again.length > 0 && !(options.by === "platform" && options.force)) return again;
    await tx.execute(sql`
      update commerce.stores set status = 'closed', status_reason = ${options.reason ?? null}, status_changed_by = ${actor.id}::uuid
      where id = ${storeId}::uuid and status <> 'closed'
    `);
    return null;
  });
  if (closed) {
    if (planEnded) await cancelPlan(actor, storeId, "undo").catch(() => {});
    return fail(...closed);
  }

  const warnings: string[] = [];
  const checkouts = await cancelOpenCheckouts(storeId);
  if (checkouts.failed > 0) warnings.push(`${checkouts.failed} order${checkouts.failed === 1 ? "" : "s"} waiting for payment could not be cancelled and will be cancelled by the daily clean-up.`);

  for (const domain of await listStoreDomains(storeId)) {
    const removed = await removeStoreDomain(actor, storeId, domain.id).catch(() => ({ ok: false as const, problems: ["failed"] }));
    if (!removed.ok) warnings.push(`The domain ${domain.hostname} could not be released: remove it under Settings, Domains.`);
  }

  await audit(
    actor.id,
    storeId,
    "store.closed",
    { by: options.by, reason: options.reason ?? null, force: Boolean(options.force && blockers.length > 0), planEnded, checkoutsCancelled: checkouts.cancelled },
    { target: { type: "store", id: storeId } },
  );
  refreshTag(storeTag(state.slug));
  await notifyOwners(state, "closed", options.by, options.reason ?? null, actor.id);
  return { ok: true, warnings };
}

/**
 * Orders waiting for payment in a store that has just closed: the Stripe session is expired (a payment that landed in the meantime completes its order, which
 * then simply is a paid order of the closed store, and appears in its orders), the rest are cancelled with their stock, and a subscription that never started
 * is expired. Each order on its own: one that fails is counted and left to the next try.
 */
export async function cancelOpenCheckouts(storeId: string): Promise<{ cancelled: number; failed: number }> {
  const waiting = await db().execute<Row>(sql`
    select o.id, p.provider_reference, p.provider_account
    from commerce.orders o
    left join commerce.payments p on p.store_id = o.store_id and p.order_id = o.id and p.provider = 'stripe' and p.status = 'pending'
      and starts_with(p.provider_reference, 'cs_') and p.provider_account is not null
    where o.store_id = ${storeId}::uuid and o.status = 'pending_payment' and o.copied_from is null
  `);
  if (waiting.length === 0) return { cancelled: 0, failed: 0 };
  const account = await getCheckoutAccount(storeId);
  const stripe = account ? platformStripe(account.mode) : null;
  let cancelled = 0;
  let failed = 0;
  for (const row of waiting) {
    const id = String(row.id);
    try {
      if (stripe && row.provider_reference && row.provider_account) {
        const outcome = await closeSession(stripe, String(row.provider_account), String(row.provider_reference));
        if (outcome === "paid") {
          await completeOrderPayment(id, String(row.provider_reference));
          continue;
        }
        if (outcome === "processing") {
          failed++;
          continue;
        }
      }
      await db().transaction(async (tx) => {
        const [done] = await tx.execute<Row>(sql`select commerce.cancel_unpaid_order(${id}::uuid, 'the store was closed') as cancelled`);
        if (done?.cancelled) cancelled++;
        await tx.execute(sql`
          update commerce.payments set status = 'cancelled', updated_at = now()
          where store_id = ${storeId}::uuid and order_id = ${id}::uuid and status = 'pending'
        `);
        await tx.execute(sql`
          update commerce.subscriptions set status = 'expired', updated_at = now()
          where store_id = ${storeId}::uuid and first_order_id = ${id}::uuid and status = 'pending'
        `);
      });
    } catch (error) {
      failed++;
      console.error("[store-closure] an open checkout could not be cancelled", id, error);
    }
  }
  return { cancelled, failed };
}

/** Suspends a store (the platform only): sales stop and the shop cannot be changed, nothing else is touched. The owner is told why. */
export async function suspendStore(actor: Account, storeId: string, reason: string): Promise<ClosureResult> {
  if (!actor.platformAdmin) return fail("Only the platform can do this.");
  const state = await storeState(storeId);
  if (!state) return fail("That store is gone.");
  if (state.isTemplate) return fail("The template store cannot be suspended.");
  if (state.status !== "active") return fail(`The store is already ${state.status === "closed" ? "closed" : "suspended"}.`);
  const [changed] = await db().execute<Row>(sql`
    update commerce.stores set status = 'suspended', status_reason = ${reason}, status_changed_by = ${actor.id}::uuid
    where id = ${storeId}::uuid and status = 'active' returning id
  `);
  if (!changed) return fail("The store is no longer open.");
  await audit(actor.id, storeId, "store.suspended", { reason }, { target: { type: "store", id: storeId } });
  refreshTag(storeTag(state.slug));
  await notifyOwners(state, "suspended", "platform", reason, actor.id);
  return { ok: true, warnings: [] };
}

export type ReopenOptions = { by: "owner" | "platform" };

/**
 * Opens a closed or suspended store again. The owner may reopen a store they closed for thirty days; a suspension and anything later is the platform's.
 * A plan that was set to end at the end of its period is kept (if that period is not over); a domain that was released is not restored.
 */
export async function reopenStore(actor: Account, storeId: string, options: ReopenOptions, now: Date = new Date()): Promise<ClosureResult> {
  const state = await storeState(storeId);
  if (!state) return fail("That store is gone.");
  if (state.status === "active") return fail("The store is already open.");
  if (options.by === "platform") {
    if (!actor.platformAdmin) return fail("Only the platform can do this.");
  } else if (!ownerMayReopen(state.status, state.closedAt, now)) {
    return fail(state.status === "suspended" ? "Kaizen suspended this store: write to Kaizen to have it reopened." : "The thirty days for reopening have passed: ask Kaizen to reopen the store.");
  }
  const [changed] = await db().execute<Row>(sql`
    update commerce.stores set status = 'active', status_changed_by = ${actor.id}::uuid
    where id = ${storeId}::uuid and status = ${state.status}::commerce.store_status returning id
  `);
  if (!changed) return fail("The store changed while you were reopening it. Look again.");

  const warnings: string[] = [];
  if (state.status === "closed") {
    // A plan set to end with its period is kept going; one that has ended is for the owner to choose again.
    const [plan] = await db().execute<Row>(sql`
      select (b.subscription_id is not null and coalesce(b.status, '') not in ('canceled', 'incomplete_expired') and b.cancel_at_period_end) as ending
      from commerce.store_billing b where b.store_id = ${storeId}::uuid
    `);
    if (plan?.ending) {
      const undone = await cancelPlan(actor, storeId, "undo").catch(() => ({ ok: false as const, problems: [] as string[] }));
      if (!undone.ok) warnings.push("The store's Kaizen plan could not be kept going: check it under Billing.");
    } else if (plan) warnings.push("The store's Kaizen plan has ended: choose a plan under Billing.");
  }
  await audit(actor.id, storeId, "store.reopened", { by: options.by, from: state.status }, { target: { type: "store", id: storeId } });
  refreshTag(storeTag(state.slug));
  await notifyOwners(state, "reopened", options.by, null, actor.id);
  return { ok: true, warnings };
}

/** The date an owner may reopen until, for the page and the email. */
export const reopenUntil = (closedAt: Date | null): Date | null => (closedAt ? reopenDeadline(closedAt) : null);

/** Tells the store's owners, once each, never throwing: a failure to send changes nothing about the status. */
async function notifyOwners(state: StoreStateInfo, change: "closed" | "suspended" | "reopened", by: "owner" | "platform", reason: string | null, actorId: string): Promise<void> {
  try {
    const people = await db().execute<Row>(sql`
      select distinct on (a.id) a.id, a.email
      from commerce.store_members m
      join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
      where m.store_id = ${state.id}::uuid and m.role = 'owner' and m.disabled_at is null and a.email <> ''
    `);
    const closedAt = change === "closed" ? ((await storeState(state.id))?.closedAt ?? null) : null;
    const email = renderEmail(
      statusEmail({ storeName: state.name, change, by, reason, url: `${siteUrl()}/admin/${state.slug}`, reopenUntil: reopenUntil(closedAt) }),
    );
    for (const person of people) {
      await sendEmail({
        storeId: state.id,
        kind: "store.status",
        to: String(person.email),
        email,
        fromName: "Kaizen",
        idempotencyKey: `store.status:${state.id}:${change}:${actorId}:${Date.now()}:${String(person.id)}`,
      });
    }
  } catch (error) {
    console.error("[store-closure] the owners' email could not be sent", state.id, error);
  }
}
