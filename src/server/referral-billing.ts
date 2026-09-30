import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import {
  creditForInvoice,
  creditNoteExTaxMinor,
  creditNoteInvoiceId,
  invoiceExTaxMinor,
  invoicePaidAt,
  invoiceStoreMetadata,
  isPlanInvoice,
  REFERRAL_CREDIT_DESCRIPTION,
  REFERRAL_CREDIT_METADATA,
  type CreditNoteShape,
  type InvoiceShape,
} from "@/lib/referral-billing";
import type { PaymentModeName } from "@/lib/stripe-account";

import { notifyCreditApplied } from "./referrals";
import { BILLING_EVENTS, platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Kaizen's plan invoices and the referral program (D131, `docs/referrals.md`), from the billing webhook
 * (`/api/stripe/billing/{mode}`):
 *
 * - `invoice.paid`: a referred store paid a plan invoice, so its referrer earns commission on the amount without VAT
 *   (`plan_invoice:{invoice}`, once).
 * - `invoice.created`: a draft invoice of a store whose owner has referral credit in the invoice's currency gets one
 *   negative invoice item, "Referral credit", for what they have usable, at most the invoice's amount without VAT.
 * - `invoice.voided` / `invoice.deleted`: credit on it comes back.
 * - `credit_note.created`: the referrer gives back the credited share of what the invoice earned.
 *
 * Every step is idempotent, and the ledger is written before Stripe is asked to add the line, so credit is never put on
 * an invoice twice and never spent on two; a line Stripe did not take is given back (`applyCreditToInvoice()`).
 */

/** The events the billing webhook listens to beyond subscriptions: `BILLING_EVENTS`, which the webhook is set up with. */
export const REFERRAL_INVOICE_EVENTS = ["invoice.created", "invoice.paid", "invoice.voided", "invoice.deleted", "credit_note.created"] as const;

/** The store an invoice is for: its Stripe customer account is the store's account in that mode, else its subscription's metadata. */
export async function storeForInvoice(mode: PaymentModeName, invoice: InvoiceShape): Promise<string | null> {
  if (invoice.customer_account) {
    const [row] = await db().execute<Row>(sql`
      select store_id from commerce.stripe_accounts where mode = ${mode} and account_id = ${invoice.customer_account}
    `);
    if (row) return String(row.store_id);
  }
  const fromMetadata = invoiceStoreMetadata(invoice);
  if (fromMetadata && /^[0-9a-f-]{36}$/i.test(fromMetadata)) {
    const [row] = await db().execute<Row>(sql`select id from commerce.stores where id = ${fromMetadata}::uuid`);
    if (row) return String(row.id);
  }
  return null;
}

const upper = (currency: string) => currency.trim().toUpperCase();

// ---------------------------------------------------------------------------
// A plan invoice was paid: commission
// ---------------------------------------------------------------------------

/**
 * Earns the referrer commission on a paid plan invoice of a referred store: the amount without VAT, after discounts and
 * credit, since that is what the store paid Kaizen; once per invoice, only inside the referral's months. Returns the
 * commission granted (0 for none).
 */
export async function earnOnPlanInvoice(mode: PaymentModeName, invoice: InvoiceShape, eventCreated: number): Promise<number> {
  if (!isPlanInvoice(invoice)) return 0;
  const fee = invoiceExTaxMinor(invoice);
  if (fee <= 0) return 0;
  const storeId = await storeForInvoice(mode, invoice);
  if (!storeId) return 0;
  const [row] = await db().execute<Row>(sql`
    select commerce.referral_earn(
      ${storeId}::uuid, ${fee}::bigint, ${upper(invoice.currency)}, 'plan_invoice', ${invoice.id},
      ${`Plan invoice${invoice.number ? ` ${invoice.number}` : ""}`}, ${invoicePaidAt(invoice, eventCreated).toISOString()}::timestamptz
    ) as earned
  `);
  return Number(row?.earned ?? 0);
}

// ---------------------------------------------------------------------------
// A credit note: the commission on the credited share goes back
// ---------------------------------------------------------------------------

/**
 * A credit note on a plan invoice takes back the share of the commission that the credited amount (without VAT) is of
 * the invoice's: as far as the referrer still has it, never below zero. Keyed on the credit note, so it counts once.
 * The invoice is asked of Stripe for its amount. Returns what was taken back.
 */
export async function reverseForCreditNote(mode: PaymentModeName, note: CreditNoteShape): Promise<number> {
  const credited = creditNoteExTaxMinor(note);
  if (credited <= 0) return 0;
  const invoiceId = creditNoteInvoiceId(note);
  const [earned] = await db().execute<Row>(sql`select 1 as found from commerce.referral_entries where idempotency_key = ${`plan_invoice:${invoiceId}`}`);
  if (!earned) return 0;
  const stripe = platformStripe(mode);
  if (!stripe) throw new Error("Stripe is not set up for this mode.");
  const invoice = await stripe.invoices.retrieve(invoiceId);
  const total = invoiceExTaxMinor(invoice as unknown as InvoiceShape);
  if (total <= 0) return 0;
  const [row] = await db().execute<Row>(sql`
    select commerce.referral_reverse('plan_invoice', ${invoiceId}, ${credited}::bigint, ${total}::bigint, false, ${`reverse:cn:${note.id}`}, 'Credit note') as taken
  `);
  return Number(row?.taken ?? 0);
}

// ---------------------------------------------------------------------------
// A draft invoice: referral credit on it
// ---------------------------------------------------------------------------

/** The owner of the billed store who has referral credit usable in the currency (the first such owner), with how much. */
export async function ownerWithCredit(storeId: string, currency: string): Promise<{ accountId: string; availableMinor: number } | null> {
  const [row] = await db().execute<Row>(sql`
    select m.account_id, b.available_minor
    from commerce.store_members m
    join commerce.accounts a on a.id = m.account_id and a.disabled_at is null
    left join commerce.referrers r on r.account_id = m.account_id
    cross join lateral commerce.referral_balance(m.account_id) b
    where m.store_id = ${storeId}::uuid and m.role = 'owner' and m.disabled_at is null
      and r.blocked_at is null and b.currency = ${upper(currency)} and b.available_minor > 0
    order by m.created_at, m.account_id
    limit 1
  `);
  return row ? { accountId: String(row.account_id), availableMinor: Number(row.available_minor) } : null;
}

/** The invoice item that carries this invoice's referral credit, if Stripe has it (found by Kaizen's own mark). */
async function findCreditItem(stripe: Stripe, invoiceId: string): Promise<Stripe.InvoiceItem | null> {
  const items = await stripe.invoiceItems.list({ invoice: invoiceId, limit: 100 });
  return items.data.find((item) => item.metadata?.[REFERRAL_CREDIT_METADATA] === invoiceId) ?? null;
}

export type CreditOutcome =
  | { applied: false; reason: "not_a_plan_invoice" | "not_draft" | "no_store" | "no_credit" | "nothing_to_take" }
  | { applied: true; amountMinor: number; currency: string; fresh: boolean };

/**
 * Puts the owner's referral credit on a draft plan invoice, as one negative invoice item, at most the invoice's amount
 * without VAT so it is never negative. The steps, in this order, so a retry or a crash never applies twice:
 *
 * 1. The invoice is read from Stripe (an event's copy can be old): only a draft can take a line.
 * 2. The ledger takes the credit (`referral_apply_invoice`), once per invoice: a retry finds the credit it already took.
 * 3. Stripe is asked to add the line (idempotency key from the ledger entry), after looking for one already there.
 * 4. A failed call is checked against Stripe: a line that did arrive keeps the credit; one that did not gives it back
 *    (`referral_restore_invoice`). When Stripe cannot be asked at all, the credit stays taken for the retry (Stripe retries
 *    the event) to finish or undo, and the error is thrown so it does.
 */
export async function applyCreditToInvoice(mode: PaymentModeName, eventInvoice: InvoiceShape): Promise<CreditOutcome> {
  if (!isPlanInvoice(eventInvoice)) return { applied: false, reason: "not_a_plan_invoice" };
  const stripe = platformStripe(mode);
  if (!stripe) throw new Error("Stripe is not set up for this mode.");
  const invoice = (await stripe.invoices.retrieve(eventInvoice.id)) as unknown as InvoiceShape;
  if (invoice.status !== "draft") {
    // Too late to add a line. Stripe says what happened: a line that is there keeps the credit (the invoice went on after
    // the line was added); none means the credit taken for it never reached Stripe, and it goes back.
    const line = await findCreditItem(stripe, invoice.id);
    if (line) return { applied: true, amountMinor: Math.abs(line.amount), currency: upper(invoice.currency), fresh: false };
    await db().execute(sql`select commerce.referral_restore_invoice(${invoice.id}, 'The invoice was no longer a draft') as restored`);
    return { applied: false, reason: "not_draft" };
  }
  const storeId = await storeForInvoice(mode, invoice);
  if (!storeId) return { applied: false, reason: "no_store" };
  const currency = upper(invoice.currency);
  const exTax = invoiceExTaxMinor(invoice);

  // An earlier try may already hold credit for this invoice: it is finished, not started again.
  const [held] = await db().execute<Row>(sql`
    select e.account_id from commerce.referral_entries e
     where e.invoice_ref = ${invoice.id} and e.kind = 'apply' order by e.created_at desc limit 1
  `);
  let accountId = held ? String(held.account_id) : null;
  if (!accountId) {
    const owner = await ownerWithCredit(storeId, currency);
    if (!owner) return { applied: false, reason: "no_credit" };
    if (creditForInvoice(owner.availableMinor, exTax) <= 0) return { applied: false, reason: "nothing_to_take" };
    accountId = owner.accountId;
  }
  const [taken] = await db().execute<Row>(sql`
    select commerce.referral_apply_invoice(${accountId}::uuid, ${currency}, ${invoice.id}, ${exTax}::bigint) as held
  `);
  const amount = Number(taken?.held ?? 0);
  if (amount <= 0) return { applied: false, reason: "nothing_to_take" };
  const [entry] = await db().execute<Row>(sql`
    select id from commerce.referral_entries where invoice_ref = ${invoice.id} and kind = 'apply' order by created_at desc limit 1
  `);

  let fresh = false;
  try {
    const existing = await findCreditItem(stripe, invoice.id);
    if (!existing) {
      await stripe.invoiceItems.create(
        {
          customer_account: invoice.customer_account ?? undefined,
          invoice: invoice.id,
          amount: -amount,
          currency: currency.toLowerCase(),
          description: REFERRAL_CREDIT_DESCRIPTION,
          metadata: { [REFERRAL_CREDIT_METADATA]: invoice.id, kaizen_referral_account: accountId },
        },
        { idempotencyKey: `referral-credit:${String(entry.id)}` },
      );
      fresh = true;
    }
  } catch (error) {
    let reached: Stripe.InvoiceItem | null | undefined;
    try {
      reached = await findCreditItem(stripe, invoice.id);
    } catch {
      reached = undefined; // Stripe cannot be asked: the retry decides.
    }
    if (reached === null) {
      await db().execute(sql`select commerce.referral_restore_invoice(${invoice.id}, 'Stripe did not take the credit') as restored`);
    }
    throw error;
  }
  if (fresh) {
    await notifyCreditApplied({ accountId, invoiceId: invoice.id, invoiceNumber: invoice.number ?? null, amountMinor: amount, currency }).catch(() => null);
  }
  return { applied: true, amountMinor: amount, currency, fresh };
}

/** An invoice was voided or deleted: the credit on it comes back, once. Returns what came back. */
export async function restoreCreditOnInvoice(invoiceId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`select commerce.referral_restore_invoice(${invoiceId}, 'The invoice was voided') as restored`);
  return Number(row?.restored ?? 0);
}

// ---------------------------------------------------------------------------
// The webhook
// ---------------------------------------------------------------------------

/** What `handleReferralEvent` did, for the webhook's answer and the tests. */
export type ReferralEventResult = { handled: boolean; detail?: string };

/**
 * Applies a verified billing event to the referral program. Events it does not know are left alone (handled false); a
 * failure is thrown, so the webhook answers 500 and Stripe sends the event again: everything here is safe to repeat.
 */
export async function handleReferralEvent(mode: PaymentModeName, event: Stripe.Event): Promise<ReferralEventResult> {
  switch (event.type) {
    case "invoice.created": {
      const outcome = await applyCreditToInvoice(mode, event.data.object as unknown as InvoiceShape);
      return { handled: true, detail: outcome.applied ? `credit ${outcome.amountMinor}` : outcome.reason };
    }
    case "invoice.paid": {
      const earned = await earnOnPlanInvoice(mode, event.data.object as unknown as InvoiceShape, event.created);
      return { handled: true, detail: `commission ${earned}` };
    }
    case "invoice.voided":
    case "invoice.deleted": {
      const restored = await restoreCreditOnInvoice((event.data.object as { id: string }).id);
      return { handled: true, detail: `restored ${restored}` };
    }
    case "credit_note.created": {
      const taken = await reverseForCreditNote(mode, event.data.object as unknown as CreditNoteShape);
      return { handled: true, detail: `taken back ${taken}` };
    }
    default:
      return { handled: false };
  }
}

/**
 * Makes sure Kaizen's billing webhook sends the invoice events (added with D131), without replacing it: a webhook made
 * before them lacks them. Returns the events that were added, or null when it could not be checked.
 */
export async function ensureBillingEvents(mode: PaymentModeName): Promise<string[] | null> {
  const stripe = platformStripe(mode);
  const [row] = await db().execute<Row>(sql`
    select endpoint_id from commerce.platform_webhooks where provider = 'stripe' and mode = ${mode} and kind = 'billing'
  `);
  if (!stripe || !row) return null;
  try {
    const endpoint = await stripe.webhookEndpoints.retrieve(String(row.endpoint_id));
    if (endpoint.enabled_events.includes("*")) return [];
    const missing = BILLING_EVENTS.filter((event) => !endpoint.enabled_events.includes(event));
    if (missing.length > 0) {
      await stripe.webhookEndpoints.update(endpoint.id, {
        enabled_events: [...endpoint.enabled_events, ...missing] as Stripe.WebhookEndpointUpdateParams.EnabledEvent[],
      });
    }
    return [...missing];
  } catch {
    return null;
  }
}
