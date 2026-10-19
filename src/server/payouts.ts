import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { feeOfBalance, isPayoutStatus, lineKindOf, PAYOUT_LINES_MAX, PAYOUT_READ_DAYS, type PayoutLineKind } from "@/lib/payouts";
import type { PaymentModeName } from "@/lib/stripe-account";

import { writeFee } from "./payment-facts";
import { uuidList } from "./sql-arrays";
import { platformStripe } from "./stripe";
import { modeOfAccount, paymentOfIntent } from "./stripe-refunds";

type Row = Record<string, unknown>;

/**
 * Payouts and reconciliation (wave 4 unit C, D290, `docs/wave-4-payments.md` 5): a store's Stripe payouts, read from `payout.*` on the
 * connected-account webhook and by a daily read back 30 days, each with the balance transactions it settles (`readPayoutLines()`), tied to the
 * payment, refund or dispute and the order each is for where Kaizena Flow knows it. A line's fee is what Stripe took; a payment's fee is kept from it
 * once (`writeFee()`). Only a store's own account's payouts are read (a host's account, D71, is the host's money). Never throws to a webhook or a job
 * for one payout: a payout that cannot be read is left for the next read.
 */

export type PayoutDeps = {
  /** The Stripe client for a mode (tests); the platform's by default. */
  stripeFor?: (mode: PaymentModeName) => Stripe | null;
  now?: () => Date;
};

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === "string" ? value : (value?.id ?? null));

/** The store's own Stripe account of that id, with its mode (null: not this store's, or a host's). */
async function ownAccount(storeId: string, account: string | null | undefined): Promise<{ account: string; mode: PaymentModeName } | null> {
  if (!account) return null;
  const [a] = await db().execute<Row>(sql`select mode from commerce.stripe_accounts where store_id = ${storeId}::uuid and account_id = ${account} limit 1`);
  return a?.mode === "test" || a?.mode === "live" ? { account, mode: a.mode } : null;
}

export type PayoutApplied = { outcome: "inserted" | "updated" | "skipped"; payoutId?: string; lines?: number };

/** The parts of a Stripe payout that are kept. */
export type PayoutLike = Pick<Stripe.Payout, "id" | "amount" | "currency" | "status" | "automatic" | "arrival_date" | "created" | "livemode"> & {
  failure_code?: string | null;
  failure_message?: string | null;
};

/**
 * Brings a payout's row up to date with what Stripe sent (idempotent by the payout's id) and, once it is paid and Stripe made it, reads what it
 * settles. A payout of an account that is not the store's own is skipped.
 */
export async function applyPayout(storeId: string, payout: PayoutLike, account: string | null | undefined, deps: PayoutDeps = {}): Promise<PayoutApplied> {
  const own = await ownAccount(storeId, account);
  if (!own || !isPayoutStatus(payout.status)) return { outcome: "skipped" };
  const arrival = typeof payout.arrival_date === "number" ? new Date(payout.arrival_date * 1000).toISOString().slice(0, 10) : null;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.payouts (store_id, provider, provider_reference, provider_account, test_mode, amount_minor, currency, status, automatic, arrival_on,
      provider_created_at, failure_code, failure_message)
    values (${storeId}::uuid, 'stripe', ${payout.id}, ${own.account}, ${!payout.livemode}, ${payout.amount}, ${payout.currency.toUpperCase()}, ${payout.status},
      ${payout.automatic}, ${arrival}::date, ${new Date(payout.created * 1000).toISOString()}::timestamptz,
      ${payout.failure_code?.slice(0, 80) ?? null}, ${payout.failure_message?.slice(0, 300) ?? null})
    on conflict (store_id, provider, provider_reference) do update set
      status = excluded.status, amount_minor = excluded.amount_minor, arrival_on = coalesce(excluded.arrival_on, commerce.payouts.arrival_on),
      failure_code = coalesce(excluded.failure_code, commerce.payouts.failure_code), failure_message = coalesce(excluded.failure_message, commerce.payouts.failure_message)
    returning id, (xmax = 0) as inserted, lines_read_at
  `);
  const payoutId = String(row.id);
  const outcome = row.inserted ? "inserted" : "updated";
  if (payout.status !== "paid" || row.lines_read_at) return { outcome, payoutId };
  const lines = await readPayoutLines(storeId, payoutId, deps);
  return { outcome, payoutId, lines: lines ?? undefined };
}

type Tie = { paymentId: string | null; refundId: string | null; disputeId: string | null; orderId: string | null };
const NO_TIE: Tie = { paymentId: null, refundId: null, disputeId: null, orderId: null };

async function paymentOfCharge(storeId: string, charge: string): Promise<{ id: string; orderId: string } | null> {
  const [p] = await db().execute<Row>(sql`select id, order_id from commerce.payments where store_id = ${storeId}::uuid and provider = 'stripe' and charge_reference = ${charge} limit 1`);
  return p ? { id: String(p.id), orderId: String(p.order_id) } : null;
}

/** What of Kaizena Flow's a balance transaction settles: a payment by its charge (or the charge's PaymentIntent), a refund by its id, a dispute by its id. */
async function tieOf(storeId: string, kind: PayoutLineKind, bt: Stripe.BalanceTransaction, stripe: Stripe, account: string): Promise<Tie> {
  const sourceId = idOf(bt.source as string | { id: string } | null);
  if (!sourceId) return NO_TIE;
  if (kind === "charge") {
    const byCharge = await paymentOfCharge(storeId, sourceId);
    if (byCharge) return { ...NO_TIE, paymentId: byCharge.id, orderId: byCharge.orderId };
    const source = typeof bt.source === "object" && bt.source ? (bt.source as { payment_intent?: string | { id: string } | null }) : null;
    const intent = idOf(source?.payment_intent ?? null);
    const byIntent = intent ? await paymentOfIntent(storeId, intent, { stripe, account }).catch(() => null) : null;
    return byIntent ? { ...NO_TIE, paymentId: byIntent.id, orderId: byIntent.orderId } : NO_TIE;
  }
  if (kind === "refund") {
    const [r] = await db().execute<Row>(sql`
      select r.id, p.order_id from commerce.refunds r join commerce.payments p on p.store_id = r.store_id and p.id = r.payment_id
       where r.store_id = ${storeId}::uuid and r.provider_reference = ${sourceId} limit 1
    `);
    return r ? { ...NO_TIE, refundId: String(r.id), orderId: String(r.order_id) } : NO_TIE;
  }
  if (kind === "dispute") {
    const [d] = await db().execute<Row>(sql`select id, order_id from commerce.payment_disputes where store_id = ${storeId}::uuid and provider_reference = ${sourceId} limit 1`);
    return d ? { ...NO_TIE, disputeId: String(d.id), orderId: String(d.order_id) } : NO_TIE;
  }
  return NO_TIE;
}

/**
 * Reads what a paid payout settles from Stripe (its balance transactions, at most `PAYOUT_LINES_MAX`) and keeps each line once, tied where Kaizena
 * Flow knows it; a payment's fee is kept from its charge's line. A manual payout lists nothing (Stripe refuses), and is marked read. Returns the
 * lines kept, or null when Stripe could not be asked. Never throws.
 */
export async function readPayoutLines(storeId: string, payoutId: string, deps: PayoutDeps = {}): Promise<number | null> {
  const [p] = await db().execute<Row>(sql`
    select provider_reference, provider_account, currency, automatic from commerce.payouts where store_id = ${storeId}::uuid and id = ${payoutId}::uuid
  `);
  if (!p) return null;
  const account = String(p.provider_account);
  const mode = await modeOfAccount(storeId, account);
  const stripe = mode ? (deps.stripeFor ?? platformStripe)(mode) : null;
  if (!stripe) return null;
  if (!p.automatic) {
    await db().execute(sql`update commerce.payouts set lines_read_at = now() where store_id = ${storeId}::uuid and id = ${payoutId}::uuid and lines_read_at is null`);
    return 0;
  }
  const currency = String(p.currency).trim();
  let kept = 0;
  let complete = true;
  try {
    let read = 0;
    for await (const bt of stripe.balanceTransactions.list({ payout: String(p.provider_reference), limit: 100, expand: ["data.source"] }, { stripeAccount: account })) {
      if (read >= PAYOUT_LINES_MAX) {
        complete = false;
        break;
      }
      read += 1;
      if (bt.currency.toUpperCase() !== currency) continue;
      const sourceId = idOf(bt.source as string | { id: string } | null);
      const kind = lineKindOf(bt.type, sourceId);
      const tie = await tieOf(storeId, kind, bt, stripe, account);
      const [line] = await db().execute<Row>(sql`
        insert into commerce.payout_lines (store_id, payout_id, provider_reference, kind, provider_type, source_reference, amount_minor, fee_minor, net_minor, currency,
          payment_id, refund_id, dispute_id, order_id, provider_created_at)
        values (${storeId}::uuid, ${payoutId}::uuid, ${bt.id}, ${kind}, ${bt.type.slice(0, 60)}, ${sourceId}, ${bt.amount}, ${bt.fee}, ${bt.net}, ${currency},
          ${tie.paymentId}::uuid, ${tie.refundId}::uuid, ${tie.disputeId}::uuid, ${tie.orderId}::uuid, ${new Date(bt.created * 1000).toISOString()}::timestamptz)
        on conflict (store_id, payout_id, provider_reference) do nothing
        returning id
      `);
      if (line) kept += 1;
      else if (tie.orderId) {
        // Read before, tied now (its payment, refund or dispute arrived since): the tie is set once.
        await db().execute(sql`
          update commerce.payout_lines set payment_id = ${tie.paymentId}::uuid, refund_id = ${tie.refundId}::uuid, dispute_id = ${tie.disputeId}::uuid, order_id = ${tie.orderId}::uuid
           where store_id = ${storeId}::uuid and payout_id = ${payoutId}::uuid and provider_reference = ${bt.id} and order_id is null
        `);
      }
      if (kind === "charge" && tie.paymentId) {
        const fee = feeOfBalance(bt);
        if (fee) await writeFee(storeId, tie.paymentId, fee);
      }
    }
  } catch (error) {
    console.error("[payouts] could not read a payout's lines:", error instanceof Error ? error.message : error);
    return null;
  }
  await db().execute(sql`
    update commerce.payouts set lines_read_at = now(), lines_complete = ${complete} where store_id = ${storeId}::uuid and id = ${payoutId}::uuid
  `);
  return kept;
}

export type PayoutJobRun = { stores: number; payouts: number; lines: number; failed: number };

/**
 * The five-minute job's part (never throws): the stores whose payouts were read longest ago (more than a day, a few a run) have their payouts of the
 * last 30 days read back from Stripe, and paid payouts whose lines were never read are read.
 */
export async function runPayoutJobs(options: PayoutDeps & { storeIds?: readonly string[]; stores?: number } = {}): Promise<PayoutJobRun> {
  const run: PayoutJobRun = { stores: 0, payouts: 0, lines: 0, failed: 0 };
  const now = (options.now ?? (() => new Date()))();
  const scope = options.storeIds ? sql`and a.store_id = any(${uuidList(options.storeIds)})` : sql``;
  try {
    const due = await db().execute<Row>(sql`
      select a.store_id, a.account_id, a.mode from commerce.stripe_accounts a
        left join commerce.payout_reads r on r.store_id = a.store_id
       where commerce.store_is_active(a.store_id) and (r.read_at is null or r.read_at < ${now.toISOString()}::timestamptz - interval '1 day') ${scope}
       order by r.read_at nulls first limit ${options.stores ?? 5}
    `);
    for (const r of due) {
      const storeId = String(r.store_id);
      const mode = r.mode === "test" || r.mode === "live" ? r.mode : null;
      const stripe = mode ? (options.stripeFor ?? platformStripe)(mode) : null;
      let problem: string | null = null;
      if (stripe) {
        try {
          const since = Math.floor(now.getTime() / 1000) - PAYOUT_READ_DAYS * 86_400;
          let read = 0;
          for await (const payout of stripe.payouts.list({ created: { gte: since }, limit: 100 }, { stripeAccount: String(r.account_id) })) {
            if (read >= 300) break;
            read += 1;
            const applied = await applyPayout(storeId, payout, String(r.account_id), options);
            if (applied.outcome !== "skipped") run.payouts += 1;
            run.lines += applied.lines ?? 0;
          }
        } catch (error) {
          problem = (error instanceof Error ? error.message : String(error)).slice(0, 300);
          run.failed += 1;
        }
      } else problem = "Stripe is not set up for this mode.";
      await db().execute(sql`
        insert into commerce.payout_reads (store_id, read_at, problem) values (${storeId}::uuid, ${now.toISOString()}::timestamptz, ${problem})
        on conflict (store_id) do update set read_at = excluded.read_at, problem = excluded.problem
      `);
      run.stores += 1;
    }
    // Paid payouts whose lines a webhook could not read: a few a run, oldest first.
    const unread = await db().execute<Row>(sql`
      select p.store_id, p.id from commerce.payouts p
       where p.lines_read_at is null and p.status = 'paid' and p.automatic ${options.storeIds ? sql`and p.store_id = any(${uuidList(options.storeIds)})` : sql``}
       order by p.provider_created_at limit 5
    `);
    for (const p of unread) {
      const lines = await readPayoutLines(String(p.store_id), String(p.id), options);
      if (lines === null) run.failed += 1;
      else run.lines += lines;
    }
  } catch (error) {
    console.error("[payouts] the job failed:", error instanceof Error ? error.message : error);
  }
  return run;
}
