import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import { noShowCharge } from "@/lib/pay-later";
import { saleFee, type PaymentModeName } from "@/lib/stripe-account";

import { audit, type Membership } from "./auth";
import { storeFeeBps } from "./billing";
import { commissionOf, hostCommissionBps, recordNoShowCommission } from "./host-payments";
import { platformStripe } from "./stripe";

type Row = Record<string, unknown>;

/**
 * Shoppers who do not come (D66): staff mark the booking, and for one paid
 * with a deposit they may charge the appointment's no-show fee to the card
 * saved then, less the deposit. Never charged without staff asking.
 */

export type NoShowResult = { ok: true; chargedMinor: number } | { ok: false; problem: string };

/** The fee a no-show would cost, for a booking paid with a deposit whose appointment has one; else 0. */
export function noShowFeeFor(line: { totalMinor: number; venueMinor: number }, percent: number): number {
  const deposit = line.venueMinor > 0 && line.venueMinor < line.totalMinor;
  return deposit && percent > 0 ? noShowCharge(line.totalMinor, line.totalMinor - line.venueMinor, percent) : 0;
}

/** Marks a past booking as a no-show, charging its fee to the saved card when asked. */
export async function markNoShow(
  { account, store }: Membership,
  bookingId: string,
  charge: boolean,
): Promise<NoShowResult> {
  const [row] = await db().execute<Row>(sql`
    select b.status, b.no_show_at, b.starts_at <= now() as started, b.order_id,
      ol.total_minor, ol.venue_minor, a.no_show_percent, o.currency, o.number, o.host_id
    from commerce.bookings b
    join commerce.orders o on o.store_id = b.store_id and o.id = b.order_id
    join commerce.order_lines ol on ol.store_id = b.store_id and ol.id = b.order_line_id
    left join commerce.appointment_settings a on a.store_id = b.store_id and a.product_id = b.product_id
    where b.store_id = ${store.id}::uuid and b.id = ${bookingId}::uuid
  `);
  if (!row || row.status !== "confirmed") return { ok: false, problem: "This booking is not confirmed." };
  if (row.no_show_at) return { ok: false, problem: "This booking is already marked as a no-show." };
  if (!row.started) return { ok: false, problem: "The appointment has not started yet." };
  const orderId = String(row.order_id);
  const line = { totalMinor: Number(row.total_minor), venueMinor: Number(row.venue_minor) };
  const amount = charge ? noShowFeeFor(line, Number(row.no_show_percent ?? 0)) : 0;
  if (charge && amount === 0) return { ok: false, problem: "There is no no-show fee to charge for this booking." };

  let reference: { id: string; account: string } | null = null;
  if (amount > 0) {
    const hostId = row.host_id ? String(row.host_id) : null;
    const charged = await chargeSavedCard(store.id, orderId, bookingId, amount, String(row.currency), String(row.number), hostId);
    if (!charged.ok) return charged;
    reference = charged;
    const [payment] = await db().execute<Row>(sql`
      insert into commerce.payments
        (store_id, order_id, provider, provider_reference, provider_account, amount_minor, currency, status, kaizen_fee_minor)
      values (${store.id}::uuid, ${orderId}::uuid, 'stripe', ${charged.id}, ${charged.account}, ${amount}, ${String(row.currency)},
        'captured', ${charged.kaizenFeeMinor})
      returning id
    `);
    // A host's booking (D71): the store's commission of the fee is owed to it, as of the booking.
    if (charged.commissionMinor > 0) await recordNoShowCommission(store.id, String(payment.id), charged.commissionMinor);
  }
  await db().execute(sql`
    update commerce.bookings set no_show_at = now(), updated_at = now()
    where store_id = ${store.id}::uuid and id = ${bookingId}::uuid and no_show_at is null
  `);
  // What was to be paid at the venue for it will not be.
  await db().execute(sql`
    update commerce.orders set balance_minor = greatest(0, balance_minor - ${line.venueMinor})
    where store_id = ${store.id}::uuid and id = ${orderId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.order_events (store_id, order_id, type, data, actor)
    values (${store.id}::uuid, ${orderId}::uuid, 'booking.no_show',
            ${JSON.stringify({ booking: bookingId, charged: amount, payment: reference?.id ?? null })}::jsonb, 'staff')
  `);
  await audit(account.id, store.id, "booking.no_show", { id: bookingId, charged: amount });
  return { ok: true, chargedMinor: amount };
}

/**
 * Charges the card saved with the order's deposit, off session, on the
 * account that took the deposit (the store's own, or a host's, D71), with
 * Kaizen's fee as for any sale and, for a host, the store's commission.
 */
async function chargeSavedCard(
  storeId: string,
  orderId: string,
  bookingId: string,
  amount: number,
  currency: string,
  orderNumber: string,
  hostId: string | null,
): Promise<{ ok: true; id: string; account: string; commissionMinor: number; kaizenFeeMinor: number } | { ok: false; problem: string }> {
  const [payment] = await db().execute<Row>(sql`
    select p.provider_reference, p.provider_account, a.mode
    from commerce.payments p
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
    where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.provider = 'stripe'
      and p.status = 'captured' and left(p.provider_reference, 3) = 'cs_'
    order by p.created_at limit 1
  `);
  const stripe = payment ? platformStripe(payment.mode as PaymentModeName) : null;
  if (!payment || !stripe) return { ok: false, problem: "No card was saved with this booking, or Stripe cannot be reached." };
  const stripeAccount = String(payment.provider_account);
  try {
    const session = await stripe.checkout.sessions.retrieve(
      String(payment.provider_reference),
      { expand: ["payment_intent"] },
      { stripeAccount },
    );
    const intent = session.payment_intent as Stripe.PaymentIntent | string | null;
    const method = typeof intent === "object" && intent ? intent.payment_method : null;
    const paymentMethod = typeof method === "string" ? method : (method?.id ?? null);
    const customer = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
    if (!paymentMethod || !customer) return { ok: false, problem: "No card was saved with this booking." };
    const kaizenFee = saleFee(amount, await storeFeeBps(storeId));
    const commission = hostId ? commissionOf(amount, await hostCommissionBps(storeId, hostId)) : 0;
    const fee = commission > 0 ? Math.min(amount, (kaizenFee ?? 0) + commission) : kaizenFee;
    const charged = await stripe.paymentIntents.create(
      {
        amount,
        currency: currency.toLowerCase(),
        customer,
        payment_method: paymentMethod,
        off_session: true,
        confirm: true,
        description: `No-show fee, order ${orderNumber}`,
        metadata: { order_id: orderId, order_number: orderNumber, booking_id: bookingId, kind: "no_show" },
        ...(fee !== null && { application_fee_amount: fee }),
      },
      { stripeAccount, idempotencyKey: `no-show-${bookingId}` },
    );
    if (charged.status !== "succeeded") return { ok: false, problem: `Stripe did not take the payment (${charged.status}).` };
    return {
      ok: true,
      id: charged.id,
      account: stripeAccount,
      commissionMinor: commission > 0 ? (fee ?? 0) - (kaizenFee ?? 0) : 0,
      kaizenFeeMinor: kaizenFee ?? 0,
    };
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "authentication_required") {
      return {
        ok: false,
        problem: "The customer's bank wants them to confirm this payment, so it cannot be charged without them. Ask them to pay another way.",
      };
    }
    return { ok: false, problem: error instanceof Error ? `Stripe said: ${error.message}` : "Stripe could not charge the card." };
  }
}
