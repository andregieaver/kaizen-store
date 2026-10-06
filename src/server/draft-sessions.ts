import "server-only";

import { sql } from "drizzle-orm";
import type Stripe from "stripe";

import { db } from "@/db/client";
import type { PaymentModeName } from "@/lib/stripe-account";

import { platformStripe } from "./stripe";
import { applySession } from "./stripe-webhooks";

type Row = Record<string, unknown>;

export type SettledSessions = "none" | "closed" | "paid" | "processing";

/**
 * Closes the Stripe sessions still open for an order (wave 3, run 2, D173): the pay link of a draft order may have opened any number of them, one at a time, and each must be closed before the order is
 * reopened, paid outside Kaizen or cancelled at the draft's expiry, so a buyer cannot pay an order that is no longer theirs to pay. A session that turns out PAID is applied (`applySession()`: the order is
 * completed, the confirmation sent) and the answer is `paid`: the caller must not cancel or change the order. A session that finished but whose payment has not arrived (a bank transfer) is `processing`: it is left
 * alone and the caller waits for the webhook. Otherwise every open session is expired, its payment row marked cancelled, and the answer is `closed` (or `none` when the order had no session).
 * A session Stripe says does not exist is closed; ANY other failure to ask (and a missing client) leaves it pending and the answer `processing`, so the caller waits instead of acting while the buyer may still pay.
 */
export async function settleOrderSessions(storeId: string, orderId: string): Promise<SettledSessions> {
  const pending = await db().execute<Row>(sql`
    select p.id, p.provider_reference, p.provider_account, a.mode
    from commerce.payments p
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
    where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.provider = 'stripe' and p.status = 'pending'
    order by p.created_at
  `);
  if (pending.length === 0) return "none";
  let outcome: SettledSessions = "closed";
  for (const row of pending) {
    const stripe = platformStripe(row.mode as PaymentModeName);
    const reference = String(row.provider_reference);
    const account = String(row.provider_account);
    // Only a session Stripe says does not exist, or one it reports closed, is closed. A failure to ask (a network error, a rate limit, no client for the mode) is NOT proof the buyer cannot pay it: the caller waits (`processing`)
    // and the payment row stays pending, so the order is never paid outside Kaizen, cancelled or reopened while a payable session may be open.
    if (!stripe) {
      outcome = "processing";
      continue;
    }
    let state: "closed" | "paid" | "processing" | "unknown" = "unknown";
    for (let attempt = 0; attempt < 2 && state === "unknown"; attempt += 1) {
      try {
        const session = await stripe.checkout.sessions.retrieve(reference, {}, { stripeAccount: account });
        if (session.status === "complete") {
          if (session.payment_status === "unpaid") {
            state = "processing";
            break;
          }
          await applySession(storeId, session);
          state = "paid";
          break;
        }
        if (session.status === "open") {
          // Expiring can fail because the buyer finished meanwhile: the next look tells which.
          await stripe.checkout.sessions.expire(reference, {}, { stripeAccount: account });
        }
        state = "closed";
      } catch (error) {
        if (isMissingSession(error)) state = "closed";
      }
    }
    if (state === "paid") return "paid";
    if (state === "processing" || state === "unknown") {
      outcome = "processing";
      continue;
    }
    await db().execute(sql`
      update commerce.payments set status = 'cancelled', updated_at = now()
      where store_id = ${storeId}::uuid and id = ${String(row.id)}::uuid and status = 'pending'
    `);
  }
  return outcome;
}

/** Stripe's answer for a session that does not exist (or is not this account's): the only error that proves nothing can be paid there. */
function isMissingSession(error: unknown): boolean {
  const e = error as { code?: string; statusCode?: number } | null;
  return e?.code === "resource_missing" || e?.statusCode === 404;
}
