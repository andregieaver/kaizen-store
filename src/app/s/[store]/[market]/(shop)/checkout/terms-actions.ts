"use server";

import { recordTermsAcceptance } from "@/server/checkout-terms";

/**
 * The shopper pressed pay (wave 1, 1e, `docs/wave-1-trust.md` 2.4): keeps what they were shown with the order waiting for payment.
 * The order is found from this browser's cart cookie, so no one can record for another's. `ok` is false only when the record could
 * not be made; in `checkbox` mode the browser then does not start the payment, in `link` mode it goes on and the order has no record.
 */
export async function recordTermsAction(storeSlug: string, marketSlug: string): Promise<{ ok: boolean }> {
  const result = await recordTermsAcceptance(storeSlug, marketSlug);
  return { ok: result.ok };
}
