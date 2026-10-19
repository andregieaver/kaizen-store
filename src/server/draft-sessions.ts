import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import type { PaymentModeName } from "@/lib/stripe-account";

import { providerOf } from "./payment-providers";

type Row = Record<string, unknown>;

export type SettledSessions = "none" | "closed" | "paid" | "processing";

/**
 * Closes the payments still open for an order (wave 3, run 2, D173): the pay link of a draft order may have opened any number of them, one at a time, and each must be closed before the order is
 * reopened, paid outside Kaizen or cancelled at the draft's expiry, so a buyer cannot pay an order that is no longer theirs to pay. Each is closed by its own provider (D292). One that turns out PAID is
 * applied (the order is completed, the confirmation sent) and the answer is `paid`: the caller must not cancel or change the order. One that finished but whose money has not arrived (a bank transfer) is
 * `processing`: it is left alone and the caller waits for the provider's next answer. Otherwise every open payment is closed, its row marked cancelled, and the answer is `closed` (or `none` when the
 * order had none). A payment the provider says does not exist is closed; ANY other failure to ask leaves it pending and the answer `processing`, so the caller waits instead of acting while the buyer
 * may still pay.
 */
export async function settleOrderSessions(storeId: string, orderId: string): Promise<SettledSessions> {
  const pending = await db().execute<Row>(sql`
    select p.id, p.provider, p.provider_reference, p.provider_account, a.mode
    from commerce.payments p
    join commerce.connected_accounts a on a.store_id = p.store_id and a.account_id = p.provider_account
    where p.store_id = ${storeId}::uuid and p.order_id = ${orderId}::uuid and p.provider = 'stripe' and p.status = 'pending'
    order by p.created_at
  `);
  if (pending.length === 0) return "none";
  let outcome: SettledSessions = "closed";
  for (const row of pending) {
    const provider = providerOf(row.provider);
    const state = provider
      ? await provider.close(storeId, {
          id: String(row.id),
          orderId,
          provider: provider.id,
          reference: String(row.provider_reference),
          account: String(row.provider_account),
          mode: row.mode as PaymentModeName,
        })
      : "unknown";
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
