import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { accountStatus, requirementNotes, type PaymentModeName } from "@/lib/stripe-account";

import { audit } from "./auth";
import { INCLUDE, PAYMENT_CAPABILITIES, makeTestAccount, requestIp, stripeProblem, type StripeAccount } from "./connect";
import type { Hosting } from "./hosts";
import { platformStripe } from "./stripe";

/**
 * Paying hosts (D71). A host's booking is a direct charge on the host's own
 * Stripe account: the host is the seller, and refunds and chargebacks come
 * from them. The charge's application fee holds Kaizen's fee and the
 * store's commission; Kaizen then sends the commission on to the store's
 * account as a transfer, tried again from the cron until it goes through,
 * and takes back the part of it a refund returns to the shopper.
 */

type Row = Record<string, unknown>;

export type HostStripeAccount = StripeAccount & { managedByKaizen: boolean };

/** The host's connected Stripe accounts, by mode. */
export async function getHostStripeAccounts(
  storeId: string,
  hostId: string,
): Promise<Partial<Record<PaymentModeName, HostStripeAccount>>> {
  const rows = await db().execute<Row>(sql`
    select mode, account_id, card_payments, requirements_due, managed_by_kaizen from commerce.host_stripe_accounts
    where store_id = ${storeId}::uuid and host_id = ${hostId}::uuid
  `);
  return Object.fromEntries(
    rows.map((row) => [
      row.mode,
      {
        mode: row.mode as PaymentModeName,
        accountId: String(row.account_id),
        cardPayments: String(row.card_payments),
        requirementsDue: Boolean(row.requirements_due),
        managedByKaizen: Boolean(row.managed_by_kaizen),
      },
    ]),
  );
}

const requested = () =>
  Object.fromEntries(PAYMENT_CAPABILITIES.map((capability) => [capability, { requested: true }])) as Record<
    (typeof PAYMENT_CAPABILITIES)[number],
    { requested: true }
  >;

async function saveHostAccount(
  storeId: string,
  hostId: string,
  mode: PaymentModeName,
  account: Stripe.V2.Core.Account,
  managedByKaizen: boolean,
) {
  const status = accountStatus(account);
  await db().execute(sql`
    insert into commerce.host_stripe_accounts
      (host_id, store_id, mode, account_id, card_payments, requirements_due, requirements, managed_by_kaizen)
    values (${hostId}::uuid, ${storeId}::uuid, ${mode}, ${account.id}, ${status.cardPayments}, ${status.requirementsDue},
            ${JSON.stringify(requirementNotes(account))}::jsonb, ${managedByKaizen})
    on conflict (host_id, mode) do update set
      account_id = excluded.account_id, card_payments = excluded.card_payments,
      requirements_due = excluded.requirements_due, requirements = excluded.requirements,
      managed_by_kaizen = excluded.managed_by_kaizen,
      -- A new account has no domains registered yet.
      payment_domains = case when commerce.host_stripe_accounts.account_id = excluded.account_id
        then commerce.host_stripe_accounts.payment_domains else '{}' end,
      updated_at = now()
  `);
  return status;
}

/**
 * Sets up the host's Stripe account for a mode. Live: an account of their
 * own with the full Stripe Dashboard, paying Stripe's fees themselves, as
 * stores' accounts are (D17); they answer Stripe's questions in the host
 * area. Test: made and filled in by Kaizen with Stripe's test values (D20).
 * Does nothing if the host already has one.
 */
export async function createHostStripeAccount(
  { account, store, host }: Hosting,
  mode: PaymentModeName,
): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (mode === "test") {
    const test = await ensureHostTestAccount(store.id, host.id, await requestIp());
    return test.ok ? { ok: true } : test;
  }
  const stripe = platformStripe(mode);
  if (!stripe) return { ok: false, problem: `Payments in ${mode} mode are not available yet.` };
  if ((await getHostStripeAccounts(store.id, host.id))[mode]) return { ok: true };
  const currency = store.markets[0]?.currency.toLowerCase();
  let created: Stripe.V2.Core.Account;
  try {
    created = await stripe.v2.core.accounts.create(
      {
        display_name: host.name,
        contact_email: account.email,
        dashboard: "full",
        configuration: { merchant: { capabilities: requested() } },
        defaults: {
          ...(currency && { currency }),
          responsibilities: { fees_collector: "stripe", losses_collector: "stripe" },
        },
        metadata: { store_id: store.id, store_slug: store.slug, host_id: host.id },
        include: INCLUDE,
      },
      { idempotencyKey: `kaizen-host-account-${host.id}-${mode}` },
    );
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }
  await saveHostAccount(store.id, host.id, mode, created, false);
  await audit(account.id, store.id, "host.stripe_account_created", { hostId: host.id, mode, accountId: created.id });
  return { ok: true };
}

/**
 * The host's test account (D20), made by Kaizen with Stripe's test values so
 * test bookings of their listings can be paid at once. Made on the first
 * visit to the host area, or at checkout.
 */
export async function ensureHostTestAccount(
  storeId: string,
  hostId: string,
  ip: string,
): Promise<{ ok: true; accountId: string; ready: boolean } | { ok: false; problem: string }> {
  const stripe = platformStripe("test");
  if (!stripe) return { ok: false, problem: "Test payments are not available yet." };
  const saved = (await getHostStripeAccounts(storeId, hostId)).test;
  if (saved?.cardPayments === "active") return { ok: true, accountId: saved.accountId, ready: true };
  if (saved) {
    try {
      const existing = await stripe.v2.core.accounts.retrieve(saved.accountId, { include: INCLUDE });
      const status = await saveHostAccount(storeId, hostId, "test", existing, saved.managedByKaizen);
      return { ok: true, accountId: existing.id, ready: status.cardPayments === "active" };
    } catch (error) {
      return { ok: false, problem: stripeProblem(error) };
    }
  }
  const [host] = await db().execute<Row>(sql`
    select h.name, a.email, s.slug,
      (select m.currency from commerce.markets m where m.store_id = s.id and m.active
        order by (m.code = s.country) desc nulls last, m.created_at limit 1) as currency
    from commerce.hosts h
    join commerce.accounts a on a.id = h.account_id
    join commerce.stores s on s.id = h.store_id
    where h.store_id = ${storeId}::uuid and h.id = ${hostId}::uuid
  `);
  if (!host) return { ok: false, problem: "Unknown host." };
  const minute = Math.floor(Date.now() / 60_000) * 60_000;
  let created: Stripe.V2.Core.Account;
  try {
    created = await makeTestAccount(stripe, {
      displayName: `${String(host.name)} (test)`,
      email: String(host.email),
      currency: String(host.currency ?? "NOK"),
      description: `Test host ${String(host.name)} on Kaizen`,
      metadata: { store_id: storeId, store_slug: String(host.slug), host_id: hostId, kaizen_test_account: "true" },
      idempotencyKey: `kaizen-host-test-account-${hostId}-${minute}`,
      minute,
      ip,
    });
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }
  const fresh = await stripe.v2.core.accounts.retrieve(created.id, { include: INCLUDE }).catch(() => created);
  const status = await saveHostAccount(storeId, hostId, "test", fresh, true);
  await audit(null, storeId, "host.test_account_created", { hostId, accountId: created.id });
  return { ok: true, accountId: created.id, ready: status.cardPayments === "active" };
}

/** Reads the host's account from Stripe and saves its state. Null if there is none or Stripe could not be asked. */
export async function refreshHostStripeAccount(
  storeId: string,
  hostId: string,
  mode: PaymentModeName,
): Promise<HostStripeAccount | null> {
  const stripe = platformStripe(mode);
  const saved = (await getHostStripeAccounts(storeId, hostId))[mode];
  if (!stripe || !saved) return null;
  try {
    const account = await stripe.v2.core.accounts.retrieve(saved.accountId, { include: INCLUDE });
    return { ...saved, ...(await saveHostAccount(storeId, hostId, mode, account, saved.managedByKaizen)) };
  } catch {
    return null;
  }
}

/** A short-lived secret for Stripe's embedded onboarding and account screens, for the host's own account. */
export async function createHostAccountSession(
  storeId: string,
  hostId: string,
  mode: PaymentModeName,
): Promise<{ ok: true; clientSecret: string } | { ok: false; problem: string }> {
  const stripe = platformStripe(mode);
  const saved = (await getHostStripeAccounts(storeId, hostId))[mode];
  if (!stripe || !saved) return { ok: false, problem: "Set up your Stripe account first." };
  try {
    const session = await stripe.accountSessions.create({
      account: saved.accountId,
      components: {
        account_onboarding: { enabled: true },
        account_management: { enabled: true },
        notification_banner: { enabled: true },
      },
    });
    return { ok: true, clientSecret: session.client_secret };
  } catch (error) {
    return { ok: false, problem: stripeProblem(error) };
  }
}

/**
 * The host's account that takes a booking's payment in the store's mode, or
 * null while it cannot take payments yet. In test mode Kaizen makes it if
 * needed, so a store can try a host's listing before the host has signed in.
 */
export async function hostCheckoutAccount(storeId: string, hostId: string, mode: PaymentModeName): Promise<string | null> {
  if (mode === "test") {
    const test = await ensureHostTestAccount(storeId, hostId, await requestIp());
    return test.ok && test.ready ? test.accountId : null;
  }
  const saved = (await getHostStripeAccounts(storeId, hostId)).live;
  return saved?.cardPayments === "active" ? saved.accountId : null;
}

/** The mode the store takes payments in, which its hosts' bookings follow; null while payments are off. */
export async function storePaymentMode(storeId: string): Promise<PaymentModeName | null> {
  const [row] = await db().execute<Row>(sql`
    select active_mode from commerce.payment_providers
    where store_id = ${storeId}::uuid and provider = 'stripe' and enabled
  `);
  return row ? (row.active_mode as PaymentModeName) : null;
}

/** The store's commission of a charge: its share of what was paid online, in whole minor units. */
export function commissionOf(dueNowMinor: number, commissionBps: number): number {
  if (dueNowMinor <= 0 || commissionBps <= 0) return 0;
  return Math.min(dueNowMinor, Math.round((dueNowMinor * commissionBps) / 10_000));
}

// ---------------------------------------------------------------------------
// The store's commission
// ---------------------------------------------------------------------------

/**
 * Once a host's order is paid: records the store's commission (in the
 * application fee Kaizen took) as owed to the store, and tries to send it.
 * Applying the same payment again changes nothing.
 */
export async function recordHostCommission(storeId: string, orderId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.host_commissions (store_id, order_id, payment_id, kind, host_id, mode, currency, amount_minor)
    select o.store_id, o.id, p.id, 'booking', o.host_id, a.mode, o.currency, o.commission_minor
    from commerce.orders o
    join commerce.payments p on p.store_id = o.store_id and p.order_id = o.id and p.provider = 'stripe'
      and left(p.provider_reference, 3) = 'cs_'
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
    where o.store_id = ${storeId}::uuid and o.id = ${orderId}::uuid and o.host_id is not null and o.commission_minor > 0
      and a.host_id = o.host_id
    order by p.created_at
    limit 1
    on conflict (store_id, payment_id) do nothing
    returning id
  `);
  if (row) await payHostCommissions({ id: String(row.id) });
}

/**
 * A no-show fee charged to the card saved with a host's booking (D66): the
 * store keeps its commission of it as of the booking, taken in the charge's
 * application fee, and it is owed and sent the same way.
 */
export async function recordNoShowCommission(storeId: string, paymentId: string, amountMinor: number): Promise<void> {
  if (amountMinor <= 0) return;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.host_commissions (store_id, order_id, payment_id, kind, host_id, mode, currency, amount_minor)
    select p.store_id, p.order_id, p.id, 'no_show', o.host_id, a.mode, p.currency, ${amountMinor}
    from commerce.payments p
    join commerce.orders o on o.store_id = p.store_id and o.id = p.order_id
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
    where p.store_id = ${storeId}::uuid and p.id = ${paymentId}::uuid and a.host_id = o.host_id
    on conflict (store_id, payment_id) do nothing
    returning id
  `);
  if (row) await payHostCommissions({ id: String(row.id) });
}

/** A host's commission rate, for a charge made on their account. */
export async function hostCommissionBps(storeId: string, hostId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select commission_bps from commerce.hosts where store_id = ${storeId}::uuid and id = ${hostId}::uuid
  `);
  return Number(row?.commission_bps ?? 0);
}

/** How long a failed transfer waits before the next try: 5 minutes, doubling, at most 12 hours. */
const RETRY = sql`make_interval(mins => least(5 * power(2, least(attempts, 10)), 720)::int)`;

/**
 * Sends the commissions owed to stores (or one of them): a transfer from
 * Kaizen's balance to the store's Stripe account. Stripe refuses until the
 * application fee is in Kaizen's available balance, and until the store's
 * account can receive transfers (asked for on the first refusal); both are
 * tried again later. Returns how many were sent.
 */
export async function payHostCommissions({ id = null, limit = 20 }: { id?: string | null; limit?: number } = {}): Promise<number> {
  const due = await db().execute<Row>(sql`
    select c.id, c.order_id, c.kind, c.store_id, c.host_id, c.mode, c.currency, c.amount_minor, c.reversed_minor, c.attempts,
      o.number, sa.account_id as store_account
    from commerce.host_commissions c
    join commerce.orders o on o.store_id = c.store_id and o.id = c.order_id
    left join commerce.stripe_accounts sa on sa.store_id = c.store_id and sa.mode = c.mode
    where c.status = 'pending'
      and ${id ? sql`c.id = ${id}::uuid` : sql`c.updated_at <= now() - ${RETRY}`}
    order by c.created_at
    limit ${limit}
  `);
  let sent = 0;
  for (const row of due) {
    const commissionId = String(row.id);
    const orderId = String(row.order_id);
    const amount = Number(row.amount_minor) - Number(row.reversed_minor);
    const where = sql`id = ${commissionId}::uuid and status = 'pending'`;
    if (amount <= 0) {
      // All of it was refunded before it was sent.
      await db().execute(sql`update commerce.host_commissions set status = 'paid', updated_at = now() where ${where}`);
      continue;
    }
    const mode = row.mode as PaymentModeName;
    const stripe = platformStripe(mode);
    const fail = (problem: string) =>
      db().execute(sql`
        update commerce.host_commissions set attempts = attempts + 1, last_error = ${problem.slice(0, 500)}, updated_at = now()
        where ${where}
      `);
    if (!stripe || !row.store_account) {
      await fail(stripe ? "The store has no Stripe account to receive it." : `Payments in ${mode} mode are not set up.`);
      continue;
    }
    const storeAccount = String(row.store_account);
    const noShow = row.kind === "no_show";
    try {
      const transfer = await stripe.transfers.create(
        {
          amount,
          currency: String(row.currency).toLowerCase(),
          destination: storeAccount,
          transfer_group: `order-${orderId}`,
          description: `Commission${noShow ? " on a no-show fee" : ""}, order ${String(row.number)}`,
          metadata: {
            order_id: orderId,
            store_id: String(row.store_id),
            host_id: String(row.host_id),
            kind: noShow ? "host_commission_no_show" : "host_commission",
          },
        },
        { idempotencyKey: `host-commission-${commissionId}-${amount}` },
      );
      await db().execute(sql`
        update commerce.host_commissions set status = 'paid', transfer_id = ${transfer.id}, last_error = '',
          attempts = attempts + 1, updated_at = now()
        where ${where}
      `);
      sent += 1;
    } catch (error) {
      await fail(stripeProblem(error));
      // Stores' accounts take payments; receiving transfers is asked for when first needed.
      if (Number(row.attempts) === 0) {
        await stripe.v2.core.accounts
          .update(storeAccount, { configuration: { recipient: { capabilities: { stripe_balance: { stripe_transfers: { requested: true } } } } } })
          .catch(() => null);
      }
    }
  }
  return sent;
}

/**
 * After a refund of a payment on a host's account: Stripe gave back the
 * refunded share of the application fee, the commission's share with it,
 * so the store gives back the same share of its commission of that
 * payment. Not yet sent, it is lowered; sent, part of the transfer is
 * reversed.
 */
export async function reverseHostCommission(storeId: string, paymentId: string): Promise<void> {
  const [row] = await db().execute<Row>(sql`
    select c.id, c.order_id, c.amount_minor, c.reversed_minor, c.status, c.transfer_id, c.mode, p.amount_minor as paid,
      coalesce((select sum(r.amount_minor) from commerce.refunds r
        where r.store_id = p.store_id and r.payment_id = p.id and r.status <> 'failed'), 0)::bigint as refunded
    from commerce.host_commissions c
    join commerce.payments p on p.store_id = c.store_id and p.id = c.payment_id
    where c.store_id = ${storeId}::uuid and c.payment_id = ${paymentId}::uuid
  `);
  if (!row) return;
  const commissionId = String(row.id);
  const orderId = String(row.order_id);
  const amount = Number(row.amount_minor);
  const paid = Number(row.paid);
  const target = paid > 0 ? Math.min(amount, Math.round((amount * Number(row.refunded)) / paid)) : 0;
  const more = target - Number(row.reversed_minor);
  if (more <= 0) return;
  if (row.status === "paid" && row.transfer_id) {
    const stripe = platformStripe(row.mode as PaymentModeName);
    if (!stripe) return;
    try {
      await stripe.transfers.createReversal(
        String(row.transfer_id),
        { amount: more, metadata: { order_id: orderId } },
        { idempotencyKey: `host-commission-reversal-${commissionId}-${target}` },
      );
    } catch (error) {
      await audit(null, storeId, "host.commission_reversal_failed", { orderId, amount: more, problem: stripeProblem(error) });
      return;
    }
  }
  await db().execute(sql`
    update commerce.host_commissions set reversed_minor = ${target}, updated_at = now()
    where id = ${commissionId}::uuid and reversed_minor < ${target}
  `);
}

export type HostEarning = {
  /** The payment: a booking's checkout, or a no-show fee charged later. */
  paymentId: string;
  kind: "booking" | "no_show";
  orderId: string;
  number: string;
  /** When it was paid. */
  paidAt: string;
  currency: string;
  /** What the shopper paid online. */
  paidMinor: number;
  refundedMinor: number;
  /** The store's commission, after refunds. */
  commissionMinor: number;
  /** Sent on to the store: the commission is settled. */
  sent: boolean;
  problem: string;
};

/**
 * A host's payments, newest first: their bookings' checkouts and any
 * no-show fees, each with the store's commission. For the host's own area
 * and the store's page about them.
 */
export async function hostEarnings(storeId: string, hostId: string, limit = 50): Promise<HostEarning[]> {
  const rows = await db().execute<Row>(sql`
    select p.id as payment_id, left(p.provider_reference, 3) = 'cs_' as checkout, o.id, o.number, p.created_at, p.currency,
      p.amount_minor as paid,
      coalesce((select sum(r.amount_minor) from commerce.refunds r
        where r.store_id = p.store_id and r.payment_id = p.id and r.status <> 'failed'), 0)::bigint as refunded,
      coalesce(c.amount_minor - c.reversed_minor, 0) as commission, c.status, coalesce(c.last_error, '') as problem
    from commerce.orders o
    join commerce.payments p on p.store_id = o.store_id and p.order_id = o.id and p.provider = 'stripe' and p.status = 'captured'
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account and a.host_id = o.host_id
    left join commerce.host_commissions c on c.store_id = p.store_id and c.payment_id = p.id
    where o.store_id = ${storeId}::uuid and o.host_id = ${hostId}::uuid
    order by p.created_at desc
    limit ${limit}
  `);
  return rows.map((row) => ({
    paymentId: String(row.payment_id),
    kind: row.checkout ? "booking" : "no_show",
    orderId: String(row.id),
    number: String(row.number),
    paidAt: new Date(String(row.created_at)).toISOString(),
    currency: String(row.currency),
    paidMinor: Number(row.paid),
    refundedMinor: Number(row.refunded),
    commissionMinor: Number(row.commission),
    sent: row.status !== "pending",
    problem: row.status === "pending" ? String(row.problem) : "",
  }));
}
