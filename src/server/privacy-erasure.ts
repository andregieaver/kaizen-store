import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { buildPlan, isEmptyPlan, summarisePlan, type ErasurePlan, type MoneyByCurrency, type PlanOrder, type PlanSummary, type PlanWarningKind } from "@/lib/erasure-plan";
import { EVIDENCE_EMAIL_KINDS } from "@/lib/personal-data";
import { erasedEmailKey } from "@/lib/privacy-request";
import { erasureConfirmationEmail, privacyLanguage } from "@/lib/privacy-text";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit } from "./auth";
import { sendEmail } from "./email";
import { removeAvatarFiles } from "./media";
import { notifyOwners } from "./privacy-notices";
import { privacyStore, resolveSubject, type PrivacyStore, type PrivacySubject, type SubjectRef } from "./privacy-subject";
import { retentionRules } from "./retention";
import { textList, uuidList } from "./sql-arrays";
import { platformStripe } from "./stripe";
import { closeSession, completeOrderPayment } from "./checkout";
import { getCheckoutAccount } from "./settings";
import { changeSubscription } from "./subscriptions";

type Row = Record<string, unknown>;

/**
 * Erasing a person (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.4). Per register entry: **delete** what no law needs, **anonymise** what
 * must stay as a row but not as a person, **restrict** what the bookkeeping duty requires (an order is never deleted, D141: it is cut
 * loose from the person, `restricted_at`, and anonymised by `commerce.anonymise_order()` when the seller's country's period ends), and
 * **keep** only what is not personal or is the person's own wish (the email opt-out).
 *
 * The order of a run, resumable and idempotent: plan; the outside world first (live subscriptions cancelled, saved cards detached, and a
 * failure there stops the run before the database changes: "Stripe did not answer; nothing was changed. Try again."); then one
 * transaction for the subject's rows; then the files (the picture) and the one email that survives (the confirmation, whose log row holds no
 * address); then the request is completed. `planErasure()` is the same code the preview shows, so the preview cannot say one thing and the run do
 * another. Stripe's own customer and payment records on the store's account are not touched (they are the store's Stripe data).
 */

export const STRIPE_DID_NOT_ANSWER = "Stripe did not answer; nothing was changed. Try again.";

export type EraseBy = {
  channel: "staff" | "shopper";
  /** The staff member (null for the shopper's own deletion). */
  accountId: string | null;
  /** The privacy request this answers, when staff logged one. */
  requestId?: string | null;
  now?: Date;
  /** Where the owners' notice links to (a staff erasure only). */
  adminUrl?: string | null;
};

export type ErasePlan = { plan: ErasurePlan; summary: PlanSummary; orders: PlanOrder[]; subject: PrivacySubject };

// ---------------------------------------------------------------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------------------------------------------------------------

const n = (v: unknown): number => Number(v ?? 0);

/**
 * What erasing the subject would do, read-only, by the same rules the run uses: counts per register entry, orders split into the ones
 * anonymised now and the ones restricted (with the day their data may go), what else happens, and the warnings.
 */
export async function planErasure(subject: PrivacySubject, now: Date = new Date()): Promise<ErasePlan | null> {
  const store = await privacyStore(subject.storeId);
  if (!store) return null;
  const sid = subject.storeId;
  const cid = subject.customerId;
  const email = subject.email;
  const addresses = textList(subject.addresses);
  const orderIds = uuidList(subject.orderIds);
  const cartIds = uuidList(subject.cartIds);
  const subIds = uuidList(subject.subscriptionIds);

  const [orders, counts, flows, warnings, rules, today] = await Promise.all([
    subject.orderIds.length === 0
      ? Promise.resolve([] as Row[])
      : db().execute<Row>(sql`
          select o.id, commerce.order_class(o.id) as class, commerce.order_anchor(o.id)::text as anchor, o.host_id is not null as host,
            trim(o.currency) as currency, o.total_minor, o.status
          from commerce.orders o where o.store_id = ${sid}::uuid and o.id = any(${orderIds}) order by o.placed_at, o.id
        `),
    db().execute<Row>(sql`
      select
        ${cid ? 1 : 0}::int as customers,
        (select count(*) from commerce.customers where store_id = ${sid}::uuid and id = ${cid}::uuid and avatar_path is not null)::int as avatars,
        (select count(*) from commerce.invoices where store_id = ${sid}::uuid and order_id = any(${orderIds}))::int as invoices,
        (select count(*) from commerce.credit_notes c join commerce.invoices i on i.store_id = c.store_id and i.id = c.invoice_id
           where i.store_id = ${sid}::uuid and i.order_id = any(${orderIds}))::int as credit_notes,
        (select count(*) from commerce.withdrawal_requests where store_id = ${sid}::uuid and order_id = any(${orderIds}))::int as withdrawals,
        (select count(*) from commerce.returns where store_id = ${sid}::uuid and order_id = any(${orderIds}))::int as returns,
        (select count(*) from commerce.subscriptions where store_id = ${sid}::uuid and id = any(${subIds}) and email <> '[removed]')::int as subscriptions,
        (select count(*) from commerce.standing_orders where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as standing_orders,
        (select count(*) from commerce.standing_order_lines l join commerce.standing_orders o on o.store_id = l.store_id and o.id = l.standing_order_id
           where o.store_id = ${sid}::uuid and o.customer_id = ${cid}::uuid)::int as standing_order_lines,
        (select count(*) from commerce.standing_deliveries d join commerce.standing_orders o on o.store_id = d.store_id and o.id = d.standing_order_id
           where o.store_id = ${sid}::uuid and o.customer_id = ${cid}::uuid)::int as standing_deliveries,
        (select count(*) from commerce.wishlists where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as wishlists,
        (select count(*) from commerce.wishlist_items i join commerce.wishlists w on w.store_id = i.store_id and w.id = i.wishlist_id
           where w.store_id = ${sid}::uuid and w.customer_id = ${cid}::uuid)::int as wishlist_items,
        (select count(*) from commerce.wishlist_cart_adds where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as wishlist_cart_adds,
        (select count(*) from commerce.carts where store_id = ${sid}::uuid and id = any(${cartIds})
           and (customer_id is not null or company_name is not null or organisation_number is not null or vat_number is not null
                or vat_check_id is not null or affiliate_code is not null))::int as carts,
        (select count(*) from commerce.delivery_quotes where store_id = ${sid}::uuid and cart_id = any(${cartIds}) and postal_code <> '')::int as delivery_quotes,
        (select count(*) from commerce.abandoned_checkouts where store_id = ${sid}::uuid and (lower(email) = any(${addresses}) or cart_id = any(${cartIds}))
           and (email is not null or lines <> '[]'::jsonb))::int as abandoned_checkouts,
        (select count(*) from commerce.bonus_entries where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as bonus_entries,
        (select count(*) from commerce.affiliates where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as affiliates,
        (select count(*) from commerce.affiliate_attributions where store_id = ${sid}::uuid
           and (affiliate_customer_id = ${cid}::uuid or friend_customer_id = ${cid}::uuid))::int as affiliate_attributions,
        (select count(*) from commerce.company_invites where store_id = ${sid}::uuid and (lower(email) = any(${addresses}) or customer_id = ${cid}::uuid))::int as company_invites,
        (select count(*) from commerce.email_messages e where e.store_id = ${sid}::uuid and e.to_address <> '[removed]'
           and (lower(e.to_address) = any(${addresses}) or e.order_id = any(${orderIds}) or e.subscription_id = any(${subIds}))
           and e.kind <> all(${textList(EVIDENCE_EMAIL_KINDS)}))::int as email_messages,
        (select count(*) from commerce.email_opt_outs where store_id = ${sid}::uuid and lower(email) = any(${addresses}))::int as email_opt_outs,
        (select count(*) from commerce.form_submissions where store_id = ${sid}::uuid and lower(email) = any(${addresses}))::int as form_submissions,
        (select count(*) from commerce.field_values where store_id = ${sid}::uuid and entity = 'customer' and entity_id = ${cid}::uuid)::int as field_values,
        (select count(*) from commerce.customer_sessions where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as customer_sessions,
        (select count(*) from commerce.customer_codes where store_id = ${sid}::uuid and lower(email) = any(${addresses}))::int as customer_codes,
        (select count(*) from commerce.customer_sign_in_links where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as customer_sign_in_links,
        (select count(*) from commerce.checkout_accounts where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)::int as checkout_accounts
    `),
    db().execute<Row>(sql`
      select
        (select count(*) from commerce.subscriptions where store_id = ${sid}::uuid and id = any(${subIds}) and status in ('active', 'past_due', 'paused'))::int as live,
        (select count(*) from commerce.standing_orders where store_id = ${sid}::uuid and customer_id = ${cid}::uuid and payment_method is not null)::int as cards,
        (select count(*) from commerce.orders where store_id = ${sid}::uuid and id = any(${orderIds}) and status = 'paid' and copied_from is null)::int as open_orders,
        (select count(*) from commerce.orders where store_id = ${sid}::uuid and id = any(${orderIds}) and status = 'pending_payment' and copied_from is null)::int as orders_cancelled,
        (select count(*) from commerce.returns where store_id = ${sid}::uuid and order_id = any(${orderIds}) and closed_at is null)::int as open_returns,
        (select coalesce(b.available_minor, 0) + coalesce(b.pending_minor, 0) from commerce.bonus_balance(${sid}::uuid, ${cid}::uuid) b) as bonus_minor,
        (select trim(currency) from commerce.bonus_settings where store_id = ${sid}::uuid) as bonus_currency
    `),
    warningsFor(subject, store),
    retentionRules(),
    db().execute<Row>(sql`select commerce.store_day(${sid}::uuid, ${now.toISOString()}::timestamptz)::text as d`),
  ]);
  const c = counts[0] ?? {};
  const f = flows[0] ?? {};
  const planOrders: PlanOrder[] = orders.map((o) => ({
    id: String(o.id),
    class: String(o.class) as PlanOrder["class"],
    anchorDay: String(o.anchor).slice(0, 10),
    host: Boolean(o.host),
    currency: String(o.currency).toUpperCase(),
    totalMinor: n(o.total_minor),
  }));
  const bonus: MoneyByCurrency[] = n(f.bonus_minor) > 0 && f.bonus_currency ? [{ currency: String(f.bonus_currency).toUpperCase(), amountMinor: n(f.bonus_minor) }] : [];
  const plan = buildPlan({
    subject: { kind: cid ? "account" : "guest", customerId: cid, hasEmail: email !== null },
    counts: {
      customers: n(c.customers),
      "storage:avatars": n(c.avatars),
      invoices: n(c.invoices),
      credit_notes: n(c.credit_notes),
      withdrawal_requests: n(c.withdrawals),
      returns: n(c.returns),
      subscriptions: n(c.subscriptions),
      standing_orders: n(c.standing_orders),
      standing_order_lines: n(c.standing_order_lines),
      standing_deliveries: n(c.standing_deliveries),
      wishlists: n(c.wishlists),
      wishlist_items: n(c.wishlist_items),
      wishlist_cart_adds: n(c.wishlist_cart_adds),
      carts: n(c.carts),
      delivery_quotes: n(c.delivery_quotes),
      abandoned_checkouts: n(c.abandoned_checkouts),
      bonus_entries: n(c.bonus_entries),
      affiliates: n(c.affiliates),
      affiliate_attributions: n(c.affiliate_attributions),
      company_invites: n(c.company_invites),
      email_messages: n(c.email_messages),
      email_opt_outs: n(c.email_opt_outs),
      form_submissions: n(c.form_submissions),
      field_values: n(c.field_values),
      customer_sessions: n(c.customer_sessions),
      customer_codes: n(c.customer_codes),
      customer_sign_in_links: n(c.customer_sign_in_links),
      checkout_accounts: n(c.checkout_accounts),
    },
    orders: planOrders,
    country: store.country,
    today: String(today[0]?.d ?? now.toISOString().slice(0, 10)).slice(0, 10),
    rules,
    subscriptionsLive: n(f.live),
    savedCards: n(f.cards),
    bonus,
    openOrders: n(f.open_orders),
    ordersCancelled: n(f.orders_cancelled),
    openReturns: n(f.open_returns),
    warnings,
  });
  return { plan, summary: summarisePlan(plan), orders: planOrders, subject };
}

/** Who else the email is, and what else copies exist (the preview warns; nothing of those is touched). */
async function warningsFor(s: PrivacySubject, store: PrivacyStore): Promise<PlanWarningKind[]> {
  if (!s.email) return [];
  const [row] = await db().execute<Row>(sql`
    select
      exists (select 1 from commerce.accounts a join commerce.store_members m on m.account_id = a.id
                where lower(a.email) = ${s.email} and m.store_id = ${store.id}::uuid and m.disabled_at is null
                  and (m.expires_at is null or m.expires_at > now())) as staff,
      exists (select 1 from commerce.hosts h join commerce.accounts a on a.id = h.account_id
                where h.store_id = ${store.id}::uuid and lower(a.email) = ${s.email}) as host,
      exists (select 1 from commerce.work_clients w where w.store_id = ${store.id}::uuid
                and (w.customer_id = ${s.customerId}::uuid or lower(w.billing_email) = ${s.email})) as work,
      exists (select 1 from commerce.customers c where c.store_id = ${store.id}::uuid and c.id = ${s.customerId}::uuid
                and c.company_id is not null and c.company_role = 'owner') as company_main,
      exists (select 1 from commerce.customers c where c.id <> ${s.customerId}::uuid and c.store_id <> ${store.id}::uuid
                and (c.copied_from = ${s.customerId}::uuid or c.id = (select x.copied_from from commerce.customers x where x.id = ${s.customerId}::uuid))) as copies,
      exists (select 1 from commerce.orders o where o.store_id <> ${store.id}::uuid and o.copied_from = any(${uuidList(s.orderIds)})) as copied_orders
  `);
  const out: PlanWarningKind[] = [];
  if (row?.staff) out.push("staff_account");
  if (row?.host) out.push("host");
  if (row?.work) out.push("work_client");
  if (row?.company_main) out.push("company_main");
  if (row?.copies) out.push("copies_in_other_stores");
  if (row?.copied_orders) out.push("copied_orders_elsewhere");
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The request of a run
// ---------------------------------------------------------------------------------------------------------------------------------

type RequestRow = {
  id: string;
  storeId: string;
  status: string;
  kind: string;
  channel: string;
  subjectEmail: string | null;
  subjectCustomerId: string | null;
  steps: Record<string, unknown>;
  handledBy: string | null;
};

const requestOf = (r: Row): RequestRow => ({
  id: String(r.id),
  storeId: String(r.store_id),
  status: String(r.status),
  kind: String(r.kind),
  channel: String(r.channel),
  subjectEmail: r.subject_email ? String(r.subject_email) : null,
  subjectCustomerId: r.subject_customer_id ? String(r.subject_customer_id) : null,
  steps: ((r.steps ?? {}) as Record<string, unknown>) ?? {},
  handledBy: r.handled_by ? String(r.handled_by) : null,
});

/** The request this run answers: the one named, an open erasure already logged for the subject (a retry resumes it), or a new one. */
async function ensureRequest(subject: PrivacySubject, by: EraseBy, now: Date): Promise<RequestRow | null> {
  if (by.requestId) {
    const [r] = await db().execute<Row>(sql`
      select id, store_id, status, kind, channel, subject_email, subject_customer_id, steps, handled_by from commerce.privacy_requests
      where store_id = ${subject.storeId}::uuid and id = ${by.requestId}::uuid and kind = 'erasure'
    `);
    return r ? requestOf(r) : null;
  }
  const find = async () => {
    const [r] = await db().execute<Row>(sql`
      select id, store_id, status, kind, channel, subject_email, subject_customer_id, steps, handled_by from commerce.privacy_requests
      where store_id = ${subject.storeId}::uuid and kind = 'erasure' and status = 'open'
        and (subject_email = ${subject.email} or (${subject.customerId}::uuid is not null and subject_customer_id = ${subject.customerId}::uuid))
      order by received_at limit 1
    `);
    return r ? requestOf(r) : null;
  };
  const existing = await find();
  if (existing) return existing;
  try {
    const [r] = await db().execute<Row>(sql`
      insert into commerce.privacy_requests (store_id, kind, channel, status, subject_customer_id, subject_email, received_at, due_at, handled_by)
      values (${subject.storeId}::uuid, 'erasure', ${by.channel}, 'open', ${subject.customerId}::uuid, ${subject.email}, ${now.toISOString()}::timestamptz,
              ${now.toISOString()}::timestamptz + interval '1 month', ${by.accountId}::uuid)
      returning id, store_id, status, kind, channel, subject_email, subject_customer_id, steps, handled_by
    `);
    return requestOf(r);
  } catch (error) {
    // Two runs for the same address at once: the unique index lets one in; the other joins it.
    if (isUniqueViolation(error)) return find();
    throw error;
  }
}

async function markStep(requestId: string, patch: Record<string, unknown>): Promise<void> {
  await db().execute(sql`
    update commerce.privacy_requests set steps = steps || ${JSON.stringify(patch)}::jsonb where id = ${requestId}::uuid and status = 'open'
  `);
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The outside world
// ---------------------------------------------------------------------------------------------------------------------------------

class ExternalFailure extends Error {}

/** A unique index refused the insert (drizzle wraps the driver's error: the code is on its cause). */
export const isUniqueViolation = (error: unknown): boolean => {
  const e = error as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
};

const isGone = (error: unknown): boolean => {
  const e = error as { code?: string; raw?: { code?: string }; message?: string } | null;
  return e?.code === "resource_missing" || e?.raw?.code === "resource_missing" || /No such PaymentMethod|not attached/i.test(e?.message ?? "");
};

/**
 * The Stripe Checkout sessions of the subject's orders that are still waiting for payment are expired, so nothing can be paid for an order that is about
 * to be cancelled (the same closing `startCheckout()` does for a shopper who checks out again). A session paid in the meantime completes its order (a sale,
 * which erasure then restricts like any other); one the shopper has finished whose payment has not arrived (a bank transfer) stops the erasure before
 * anything changes, as an unreachable Stripe does for a subscription. A session Stripe no longer knows is closed either way.
 */
async function closeOpenCheckouts(subject: PrivacySubject): Promise<void> {
  if (subject.orderIds.length === 0) return;
  const open = await db().execute<Row>(sql`
    select o.id, p.provider_reference, p.provider_account from commerce.orders o
    join commerce.payments p on p.store_id = o.store_id and p.order_id = o.id and p.provider = 'stripe' and p.status = 'pending'
    where o.store_id = ${subject.storeId}::uuid and o.id = any(${uuidList(subject.orderIds)}) and o.status = 'pending_payment' and o.copied_from is null
      and starts_with(p.provider_reference, 'cs_') and p.provider_account is not null
  `);
  if (open.length === 0) return;
  const found = await getCheckoutAccount(subject.storeId);
  const stripe = found ? platformStripe(found.mode) : null;
  if (!stripe) return; // Payments are off for the store: no session can still be open.
  for (const row of open) {
    const outcome = await closeSession(stripe, String(row.provider_account), String(row.provider_reference));
    if (outcome === "processing") throw new ExternalFailure(`order ${String(row.id)}: a payment is still being processed`);
    if (outcome === "paid") await completeOrderPayment(String(row.id), String(row.provider_reference));
  }
}

/**
 * Subscriptions end now (no refund, no proration), saved cards are detached. Idempotent: a subscription already cancelled is not live, a card
 * already gone is not an error. A failure throws `ExternalFailure` before anything in the database has changed.
 */
async function endExternal(subject: PrivacySubject): Promise<{ subscriptions: number; cards: number }> {
  const subs = await db().execute<Row>(sql`
    select id, provider_reference from commerce.subscriptions
    where store_id = ${subject.storeId}::uuid and id = any(${uuidList(subject.subscriptionIds)}) and status in ('active', 'past_due', 'paused')
  `);
  let cancelled = 0;
  for (const sub of subs) {
    if (!sub.provider_reference) {
      await db().execute(sql`
        update commerce.subscriptions set status = 'cancelled', cancelled_at = coalesce(cancelled_at, now()), updated_at = now()
        where store_id = ${subject.storeId}::uuid and id = ${String(sub.id)}::uuid
      `);
      cancelled++;
      continue;
    }
    const result = await changeSubscription(subject.storeId, String(sub.id), "cancel_now", { actor: "privacy" });
    if (!result.ok) throw new ExternalFailure(`subscription ${String(sub.id)}: ${result.problem}`);
    cancelled++;
  }
  await closeOpenCheckouts(subject);
  let cards = 0;
  if (subject.customerId) {
    const lists = await db().execute<Row>(sql`
      select id, stripe_account, mode, payment_method from commerce.standing_orders
      where store_id = ${subject.storeId}::uuid and customer_id = ${subject.customerId}::uuid and payment_method is not null
    `);
    for (const list of lists) {
      const stripe = list.mode ? platformStripe(list.mode as PaymentModeName) : null;
      if (!stripe || !list.stripe_account) throw new ExternalFailure("no Stripe client for a saved card");
      try {
        await stripe.paymentMethods.detach(String(list.payment_method), {}, { stripeAccount: String(list.stripe_account) });
        cards++;
      } catch (error) {
        if (!isGone(error)) throw new ExternalFailure("a saved card could not be detached");
      }
    }
  }
  return { subscriptions: cancelled, cards };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------------------------

export type EraseCounts = { ordersAnonymised: number; ordersRestricted: number; ordersCancelled: number; subscriptions: number; emailsBlanked: number; accountDeleted: boolean };

export type EraseResult =
  | { ok: true; outcome: "erased" | "no_data"; requestId: string; summary: PlanSummary; counts: EraseCounts; confirmation: "sent" | "none" | "failed" }
  | { ok: false; problem: "not_found" | "closed" | "stripe" | "failed"; message: string; requestId: string | null };

/**
 * Erases the subject (an account id and/or an email). Never deletes an order (D141). Writes `customer.erased` to the audit log (ids and
 * counts, never an email or a name), tells the owners when staff did it, and sends the one email that survives. A run that fails after the
 * outside world was reached leaves the request open (`steps` says where) and `resumeErasures()` finishes it.
 */
export async function eraseSubject(storeId: string, ref: SubjectRef, by: EraseBy, deps: { avatarRemover?: (paths: string[]) => Promise<void> } = {}): Promise<EraseResult> {
  const now = by.now ?? new Date();
  const store = await privacyStore(storeId);
  const subject = store ? await resolveSubject(storeId, ref, { channel: by.channel }) : null;
  if (!store || !subject) return { ok: false, problem: "not_found", message: "There is nobody with that account or email address in this store.", requestId: by.requestId ?? null };

  const request = await ensureRequest(subject, by, now);
  if (!request) return { ok: false, problem: "not_found", message: "There is no such request.", requestId: null };
  if (request.status !== "open") return { ok: false, problem: "closed", message: "That request is already answered.", requestId: request.id };

  const planned = await planErasure(subject, now);
  if (!planned) return { ok: false, problem: "not_found", message: "There is no such store.", requestId: request.id };
  const started = Boolean(request.steps.startedAt);

  // Nothing is held about this person: the request closes as "no data held".
  if (isEmptyPlan(planned.plan) && !started) {
    const closed = await db().execute(sql`
      update commerce.privacy_requests set status = 'done', outcome = 'no_data', completed_at = ${now.toISOString()}::timestamptz, subject_email = null,
        plan_summary = ${JSON.stringify(planned.summary)}::jsonb, handled_by = coalesce(handled_by, ${by.accountId}::uuid)
      where id = ${request.id}::uuid and status = 'open' returning id
    `);
    if (closed.length > 0) {
      await audit(by.accountId, storeId, "customer.erased", { outcome: "no_data", by: by.channel, request: request.id, customer: subject.customerId, counts: {} }, { area: "customers", target: { type: "customer", id: subject.customerId ?? request.id } });
    }
    return { ok: true, outcome: "no_data", requestId: request.id, summary: planned.summary, counts: { ordersAnonymised: 0, ordersRestricted: 0, ordersCancelled: 0, subscriptions: 0, emailsBlanked: 0, accountDeleted: false }, confirmation: "none" };
  }

  const language = String(request.steps.language ?? privacyLanguage(subject.locale ?? store.mainLocale));
  const keptUntilDay = planned.summary.keptUntil?.last ?? (request.steps.keptUntil as string | undefined) ?? null;
  const keptOrders = planned.plan.rows.filter((r) => r.table === "orders" && r.action === "restricted").reduce((sum, r) => sum + r.count, 0) || n(request.steps.keptOrders);
  await db().execute(sql`
    update commerce.privacy_requests set plan_summary = ${JSON.stringify(planned.summary)}::jsonb,
      handled_by = coalesce(handled_by, ${by.accountId}::uuid),
      steps = steps || ${JSON.stringify({ startedAt: request.steps.startedAt ?? now.toISOString(), language, keptOrders, keptUntil: keptUntilDay })}::jsonb
    where id = ${request.id}::uuid and status = 'open'
  `);

  // 1. The outside world first: a failure changes nothing here.
  try {
    const external = await endExternal(subject);
    await markStep(request.id, { external: "done", subscriptionsCancelled: external.subscriptions, cardsDetached: external.cards });
  } catch (error) {
    if (!(error instanceof ExternalFailure)) throw error;
    console.error("[privacy] the outside world did not answer; nothing was changed", request.id, error.message);
    await markStep(request.id, { external: "failed" });
    return { ok: false, problem: "stripe", message: STRIPE_DID_NOT_ANSWER, requestId: request.id };
  }

  // 2. One transaction for the subject's rows.
  let counts: EraseCounts;
  let avatar: string | null = null;
  try {
    const done = await db().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`privacy_erase:${storeId}:${subject.customerId ?? subject.email}`}, 0))`);
      // Read again under the lock: a run that finished while this one waited has left nothing to do.
      const live = (await resolveSubject(storeId, { customerId: subject.customerId, email: subject.email }, { channel: by.channel })) ?? subject;
      return eraseRows(tx, live, store);
    });
    counts = done.counts;
    avatar = done.avatar;
  } catch (error) {
    console.error("[privacy] the erasure failed in the database; the request stays open", request.id, error);
    await markStep(request.id, { database: "failed" });
    return { ok: false, problem: "failed", message: "The erasure could not be finished. Nothing is lost: try again, or it is resumed tonight.", requestId: request.id };
  }
  await markStep(request.id, { database: "done", avatarPath: avatar ?? request.steps.avatarPath ?? null, counts });

  // 3. Files after the commit: the picture. A failure is kept for the daily job.
  const remover = deps.avatarRemover ?? removeAvatarFiles;
  const toRemove = (avatar ?? (request.steps.avatarPath as string | null | undefined)) || null;
  if (toRemove) {
    try {
      await remover([toRemove]);
      await markStep(request.id, { files: "done", avatarPath: null });
    } catch (error) {
      console.error("[privacy] a profile picture could not be removed; retried tonight", error);
      await markStep(request.id, { files: "left" });
    }
  } else await markStep(request.id, { files: "done" });

  // 4. The one email that survives: its log row holds no address. The request still holds the address until it is completed (a resume needs it).
  let confirmation: "sent" | "none" | "failed" = "none";
  const to = request.subjectEmail ?? subject.email;
  if (to) {
    const content = erasureConfirmationEmail(
      language,
      { storeName: store.name, legalName: store.legalName, contactEmail: store.contactEmail, country: store.country },
      { orders: keptOrders, until: keptUntilDay },
    );
    const outcome = await sendEmail({
      storeId,
      kind: "privacy.erased",
      to,
      email: renderEmail(content),
      fromName: store.name,
      replyTo: store.contactEmail,
      idempotencyKey: erasedEmailKey(request.id),
      logAddress: false,
    });
    confirmation = outcome === "sent" || outcome === "logged" || outcome === "duplicate" ? "sent" : "failed";
  }

  // 5. Complete: the request keeps counts and dates, never the address. Only the run that completes it writes the log and tells the owners (two runs at once
  // finish one request).
  const completed = await db().execute(sql`
    update commerce.privacy_requests set status = 'done', outcome = 'erased', completed_at = ${now.toISOString()}::timestamptz, subject_email = null,
      steps = steps || ${JSON.stringify({ email: confirmation })}::jsonb
    where id = ${request.id}::uuid and status = 'open' returning id
  `);
  if (completed.length > 0) {
    await audit(
      by.accountId,
      storeId,
      "customer.erased",
      {
        outcome: "erased",
        by: by.channel,
        request: request.id,
        customer: subject.customerId,
        counts,
        ...(planned.summary.keptUntil ? { keptUntilFirst: planned.summary.keptUntil.first, keptUntilLast: planned.summary.keptUntil.last } : {}),
      },
      { area: "customers", target: { type: "customer", id: subject.customerId ?? request.id } },
    );
    if (by.channel === "staff" && by.accountId) await notifyOwners(storeId, "erasure", by.accountId, request.id, now, by.adminUrl ?? null).catch((e) => console.error("[privacy] the owners' notice failed", e));
  }
  return { ok: true, outcome: "erased", requestId: request.id, summary: planned.summary, counts, confirmation };
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** The subject's rows, all of it or none: the bodies of 2.4 step 3. */
async function eraseRows(tx: Tx, s: PrivacySubject, store: PrivacyStore): Promise<{ counts: EraseCounts; avatar: string | null }> {
  const sid = s.storeId;
  const cid = s.customerId;
  const addresses = textList(s.addresses);
  const orderIds = uuidList(s.orderIds);
  const subIds = uuidList(s.subscriptionIds);
  const counts: EraseCounts = { ordersAnonymised: 0, ordersRestricted: 0, ordersCancelled: 0, subscriptions: 0, emailsBlanked: 0, accountDeleted: false };

  // An order still waiting for payment is not a sale: it is cancelled first (its stock goes back, its payment is marked cancelled, a subscription that
  // never started is expired), so a payment that somehow arrives later finds a cancelled order, which `complete_order_payment()` still completes
  // without the person's data, instead of an order that is anonymised and still waiting.
  const waiting = await tx.execute<Row>(sql`
    select id from commerce.orders where store_id = ${sid}::uuid and id = any(${orderIds}) and status = 'pending_payment' and copied_from is null
  `);
  for (const w of waiting) {
    const [c] = await tx.execute<Row>(sql`select commerce.cancel_unpaid_order(${String(w.id)}::uuid, 'the customer asked for their data to be erased') as cancelled`);
    if (c?.cancelled) counts.ordersCancelled++;
    await tx.execute(sql`
      update commerce.payments set status = 'cancelled', updated_at = now()
      where store_id = ${sid}::uuid and order_id = ${String(w.id)}::uuid and status = 'pending'
    `);
    await tx.execute(sql`update commerce.subscriptions set status = 'expired', updated_at = now() where store_id = ${sid}::uuid and first_order_id = ${String(w.id)}::uuid and status = 'pending'`);
  }
  await tx.execute(sql`update commerce.subscriptions set status = 'expired', updated_at = now() where store_id = ${sid}::uuid and id = any(${subIds}) and status = 'pending'`);

  // Orders: each by the database's own rule (a sale whose day has not come is restricted, everything else is anonymised); never deleted.
  const anonymisedNow: string[] = [];
  for (const id of s.orderIds) {
    const [r] = await tx.execute<Row>(sql`select commerce.anonymise_order(${sid}::uuid, ${id}::uuid, 'erasure') as result`);
    const result = String(r?.result);
    if (result === "anonymised") {
      counts.ordersAnonymised++;
      anonymisedNow.push(id);
    } else if (result === "restricted") counts.ordersRestricted++;
  }
  // The link that opens a purchase without a sign-in stops working (a copied order has none of its own).
  await tx.execute(sql`
    update commerce.order_downloads d set expires_at = now()
    from commerce.orders o
    where d.store_id = ${sid}::uuid and d.order_id = any(${orderIds}) and o.id = d.order_id and o.copied_from is null and (d.expires_at is null or d.expires_at > now())
  `);
  // Staff-entered fields of an order that is anonymised now (a restricted order's go when it is).
  if (anonymisedNow.length > 0) {
    await tx.execute(sql`delete from commerce.field_values where store_id = ${sid}::uuid and entity = 'order' and entity_id = any(${uuidList(anonymisedNow)})`);
  }

  // Subscriptions are contracts, not accounting documents: the person goes, the renewal orders (restricted as orders) stay.
  for (const id of s.subscriptionIds) {
    const [done] = await tx.execute<Row>(sql`
      update commerce.subscriptions set email = '[removed]', shipping_address = '{}'::jsonb, manage_token = ${randomBytes(24).toString("base64url")},
        customer_id = null, updated_at = now()
      where store_id = ${sid}::uuid and id = ${id}::uuid and (email <> '[removed]' or customer_id is not null) returning id
    `);
    if (done) counts.subscriptions++;
  }

  // Standing lists, wishlists, sign-in records, company invitations and sign-ups by the address: deleted.
  if (cid) {
    await tx.execute(sql`
      delete from commerce.standing_deliveries where store_id = ${sid}::uuid and standing_order_id in
        (select id from commerce.standing_orders where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)
    `);
    await tx.execute(sql`delete from commerce.standing_order_lines where store_id = ${sid}::uuid and standing_order_id in
        (select id from commerce.standing_orders where store_id = ${sid}::uuid and customer_id = ${cid}::uuid)`);
    await tx.execute(sql`delete from commerce.standing_orders where store_id = ${sid}::uuid and customer_id = ${cid}::uuid`);
    await tx.execute(sql`update commerce.wishlist_cart_adds set wishlist_name = '', customer_id = null where store_id = ${sid}::uuid and customer_id = ${cid}::uuid`);
    await tx.execute(sql`delete from commerce.wishlists where store_id = ${sid}::uuid and customer_id = ${cid}::uuid`);
    await tx.execute(sql`delete from commerce.customer_sessions where store_id = ${sid}::uuid and customer_id = ${cid}::uuid`);
    await tx.execute(sql`delete from commerce.customer_sign_in_links where store_id = ${sid}::uuid and customer_id = ${cid}::uuid`);
    await tx.execute(sql`delete from commerce.checkout_accounts where store_id = ${sid}::uuid and customer_id = ${cid}::uuid`);
  }
  await tx.execute(sql`delete from commerce.customer_codes where store_id = ${sid}::uuid and lower(email) = any(${addresses})`);
  await tx.execute(sql`
    delete from commerce.company_invites where store_id = ${sid}::uuid and (lower(email) = any(${addresses}) or customer_id = ${cid}::uuid)
  `);
  await tx.execute(sql`delete from commerce.form_submissions where store_id = ${sid}::uuid and lower(email) = any(${addresses})`);

  // Carts: the person and the company details; their delivery quotes lose the postal code; reminders lose the address and the lines (the opt-out stays).
  const cartIds = uuidList(s.cartIds);
  await tx.execute(sql`
    update commerce.carts set customer_id = null, company_name = null, organisation_number = null, vat_number = null, vat_check_id = null, affiliate_code = null
    where store_id = ${sid}::uuid and id = any(${cartIds})
  `);
  await tx.execute(sql`
    update commerce.delivery_quotes set postal_code = '', pickup_points = '[]'::jsonb where store_id = ${sid}::uuid and cart_id = any(${cartIds})
  `);
  await tx.execute(sql`
    update commerce.abandoned_checkouts set email = null, lines = '[]'::jsonb
    where store_id = ${sid}::uuid and (lower(email) = any(${addresses}) or cart_id = any(${cartIds}))
  `);

  // Emails: address, subject and bodies blanked, the rows kept (the idempotency key stops a replayed webhook from sending again); the evidence kinds wait for their order.
  const blanked = await tx.execute<Row>(sql`
    update commerce.email_messages set to_address = '[removed]', subject = '[removed]', html = '', text = ''
    where store_id = ${sid}::uuid and to_address <> '[removed]' and kind <> all(${textList(EVIDENCE_EMAIL_KINDS)})
      and (lower(to_address) = any(${addresses}) or order_id = any(${orderIds}) or subscription_id = any(${subIds}))
    returning id
  `);
  counts.emailsBlanked = blanked.length;

  // The account (its field values go by the table's own trigger, the ledger and the referral code by the foreign keys: credits are forfeited).
  let avatar: string | null = null;
  if (cid) {
    const [row] = await tx.execute<Row>(sql`delete from commerce.customers where store_id = ${sid}::uuid and id = ${cid}::uuid returning avatar_path`);
    if (row) {
      counts.accountDeleted = true;
      avatar = row.avatar_path ? String(row.avatar_path) : null;
    }
  }
  void store;
  return { counts, avatar };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The daily resume
// ---------------------------------------------------------------------------------------------------------------------------------

/**
 * Finishes erasures that began and did not complete (a crash after the outside world was reached, a database error, a picture that would not
 * go). Only a request whose run started is resumed: a request staff logged and nobody acted on is never erased by the schedule. Idempotent.
 */
export async function resumeErasures(now: Date = new Date(), deps: Parameters<typeof eraseSubject>[3] = {}): Promise<{ resumed: number; failed: number; filesRetried: number }> {
  const rows = await db().execute<Row>(sql`
    select id, store_id, channel, subject_email, subject_customer_id, handled_by from commerce.privacy_requests
    where kind = 'erasure' and status = 'open' and steps ? 'startedAt' order by received_at limit 200
  `);
  let resumed = 0;
  let failed = 0;
  for (const r of rows) {
    try {
      const result = await eraseSubject(
        String(r.store_id),
        { customerId: r.subject_customer_id ? String(r.subject_customer_id) : null, email: r.subject_email ? String(r.subject_email) : null },
        { channel: String(r.channel) as "staff" | "shopper", accountId: r.handled_by ? String(r.handled_by) : null, requestId: String(r.id), now },
        deps,
      );
      if (result.ok) resumed++;
      else failed++;
    } catch (error) {
      failed++;
      console.error("[privacy] an erasure could not be resumed", String(r.id), error);
    }
  }
  // A picture that would not go when the erasure was done is removed again (the request is answered; only the file is left).
  let filesRetried = 0;
  const left = await db().execute<Row>(sql`
    select id, steps ->> 'avatarPath' as path from commerce.privacy_requests where kind = 'erasure' and steps ->> 'files' = 'left' and steps ->> 'avatarPath' is not null limit 200
  `);
  const remover = deps.avatarRemover ?? removeAvatarFiles;
  for (const row of left) {
    try {
      await remover([String(row.path)]);
      await db().execute(sql`update commerce.privacy_requests set steps = steps || '{"files":"done","avatarPath":null}'::jsonb where id = ${String(row.id)}::uuid`);
      filesRetried++;
    } catch (error) {
      console.error("[privacy] a profile picture could still not be removed", String(row.id), error);
    }
  }
  return { resumed, failed, filesRetried };
}
