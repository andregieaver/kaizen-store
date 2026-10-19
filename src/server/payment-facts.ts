import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { factsOfCharge, type ChargeFacts, type ChargeLike } from "@/lib/payment-facts";
import { feeOfBalance, type BalanceLike } from "@/lib/payouts";
import type { PaymentModeName } from "@/lib/stripe-account";

import { uuidList } from "./sql-arrays";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * What a Stripe payment was (wave 4 unit A, D288, `docs/wave-4-payments.md` 3): its charge is read once after capture, through the store's connected
 * account, and its method, wallet, card brand, risk outcome and charge id are kept on the payment as Stripe gave them (`factsOfCharge()`). Read in
 * `after()` the payment is applied (`applySession()`), and by the five-minute job for any captured Stripe payment of the last day still without them
 * (`readMissingPaymentFacts()`). A payment Stripe cannot be asked about keeps nulls and is *Unknown*; nothing is guessed. Never throws.
 */

export type FactsDeps = {
  /** The Stripe client for a mode (tests); the platform's by default. */
  stripeFor?: (mode: PaymentModeName) => Stripe | null;
};

type Target = { id: string; storeId: string; reference: string; account: string; mode: PaymentModeName };

const idOf = (value: string | { id: string } | null | undefined): string | null => (typeof value === "string" ? value : (value?.id ?? null));

/** A charge with its balance transaction (expanded where Stripe has one), whose fee is what Stripe took (D290). */
type ChargeWithBalance = ChargeLike & { balance_transaction?: BalanceLike | string | null };

/** The latest charge of a PaymentIntent, expanded or fetched, with its balance transaction. */
async function chargeOfIntent(stripe: Stripe, intent: string | Stripe.PaymentIntent | null | undefined, options: Stripe.RequestOptions): Promise<ChargeWithBalance | null> {
  if (!intent) return null;
  const pi = typeof intent === "string" ? await stripe.paymentIntents.retrieve(intent, { expand: ["latest_charge.balance_transaction"] }, options) : intent;
  const charge = pi.latest_charge;
  if (!charge) return null;
  return typeof charge === "string" ? ((await stripe.charges.retrieve(charge, { expand: ["balance_transaction"] }, options)) as ChargeWithBalance) : (charge as ChargeWithBalance);
}

/** The charge behind a payment's reference: a Checkout session (`cs_`), a PaymentIntent (`pi_`) or a subscription invoice (`in_`). */
async function chargeOf(stripe: Stripe, reference: string, options: Stripe.RequestOptions): Promise<ChargeWithBalance | null> {
  if (reference.startsWith("pi_")) return chargeOfIntent(stripe, reference, options);
  if (reference.startsWith("cs_")) {
    const session = await stripe.checkout.sessions.retrieve(reference, { expand: ["payment_intent.latest_charge.balance_transaction"] }, options);
    if (session.payment_intent) return chargeOfIntent(stripe, session.payment_intent, options);
    const invoice = idOf(session.invoice as string | { id: string } | null);
    return invoice ? chargeOf(stripe, invoice, options) : null;
  }
  if (reference.startsWith("in_")) {
    const payments = await stripe.invoicePayments.list({ invoice: reference, limit: 1 }, options);
    const intent = payments.data[0]?.payment?.payment_intent;
    return chargeOfIntent(stripe, idOf(intent as string | { id: string } | null | undefined), options);
  }
  return null;
}

async function write(target: Target, facts: ChargeFacts | null, fee: ReturnType<typeof feeOfBalance>) {
  await db().execute(sql`
    update commerce.payments set
      method_type = ${facts?.methodType ?? null}, wallet = ${facts?.wallet ?? null}, card_brand = ${facts?.cardBrand ?? null},
      risk_level = ${facts?.riskLevel ?? null}, risk_score = ${facts?.riskScore ?? null}, charge_reference = ${facts?.chargeReference ?? null},
      facts_read_at = now(), updated_at = now()
    where store_id = ${target.storeId}::uuid and id = ${target.id}::uuid and provider = 'stripe' and facts_read_at is null
  `);
  // What Stripe took (D290), once: a payout that settles the payment may have read it first.
  if (fee) await writeFee(target.storeId, target.id, fee);
}

/** Keeps a Stripe payment's fee as its balance transaction gave it, once (the database refuses a change). */
export async function writeFee(storeId: string, paymentId: string, fee: NonNullable<ReturnType<typeof feeOfBalance>>) {
  await db().execute(sql`
    update commerce.payments set provider_fee_minor = ${fee.providerFeeMinor}, application_fee_minor = ${fee.applicationFeeMinor}, fee_currency = ${fee.currency}, updated_at = now()
    where store_id = ${storeId}::uuid and id = ${paymentId}::uuid and provider = 'stripe' and provider_fee_minor is null
  `);
}

/** Reads one payment's charge and keeps its facts; `read` when kept (also when Stripe gave none), `failed` when Stripe could not be asked. */
async function readOne(target: Target, deps: FactsDeps): Promise<"read" | "failed"> {
  const stripe = (deps.stripeFor ?? platformStripe)(target.mode);
  if (!stripe) return "failed";
  try {
    const charge = await chargeOf(stripe, target.reference, { stripeAccount: target.account });
    await write(target, charge ? factsOfCharge(charge) : null, charge ? feeOfBalance(charge.balance_transaction) : null);
    return "read";
  } catch {
    return "failed";
  }
}

const targetsSql = sql`
  select p.id, p.store_id, p.provider_reference, p.provider_account, a.mode
    from commerce.payments p
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
   where p.provider = 'stripe' and p.status = 'captured' and p.facts_read_at is null and p.provider_account is not null
`;

const toTarget = (r: Row): Target | null =>
  r.mode === "test" || r.mode === "live"
    ? { id: String(r.id), storeId: String(r.store_id), reference: String(r.provider_reference), account: String(r.provider_account), mode: r.mode }
    : null;

/** Reads the facts of a store's captured Stripe payment by its reference (a session, an intent or an invoice), once. Never throws. */
export async function readPaymentFacts(storeId: string, reference: string, deps: FactsDeps = {}): Promise<"read" | "failed" | "none"> {
  try {
    const rows = await db().execute<Row>(sql`${targetsSql} and p.store_id = ${storeId}::uuid and p.provider_reference = ${reference} limit 1`);
    const target = rows[0] ? toTarget(rows[0]) : null;
    return target ? await readOne(target, deps) : "none";
  } catch {
    return "failed";
  }
}

export type FactsRun = { checked: number; read: number; failed: number };

/** The five-minute job's safety net: captured Stripe payments of the last day still without facts, newest first (one Stripe keeps refusing never holds the rest back), a few a run. Never throws. */
export async function readMissingPaymentFacts(limit = 10, deps: FactsDeps & { storeIds?: readonly string[] } = {}): Promise<FactsRun> {
  const run: FactsRun = { checked: 0, read: 0, failed: 0 };
  let rows: Row[];
  try {
    rows = await db().execute<Row>(sql`
      ${targetsSql} and p.created_at > now() - interval '1 day' ${deps.storeIds ? sql`and p.store_id = any(${uuidList(deps.storeIds)})` : sql``}
      order by p.created_at desc limit ${limit}
    `);
  } catch {
    return run;
  }
  for (const r of rows) {
    const target = toTarget(r);
    if (!target) continue;
    run.checked += 1;
    if ((await readOne(target, deps)) === "read") run.read += 1;
    else run.failed += 1;
  }
  return run;
}
