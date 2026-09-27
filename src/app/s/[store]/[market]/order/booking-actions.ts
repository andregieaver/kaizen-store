"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { cancelOwnBooking, moveOwnBooking, type ChangeOutcome, type ShopperAccess } from "@/server/booking-changes";
import { getCustomer } from "@/server/customers";
import { resolveShop } from "@/server/shop";

/**
 * The shopper changing their own booking (D66): from the order page, which
 * its key opens, or from My account, signed in.
 */
async function access(storeSlug: string, marketSlug: string, sessionId: string | null) {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return null;
  if (sessionId) return { storeId: shop.store.id, who: { sessionId } as ShopperAccess };
  const customer = await getCustomer(shop.store.id);
  return customer ? { storeId: shop.store.id, who: { customerId: customer.id } as ShopperAccess } : null;
}

const ids = z.object({ orderId: z.uuid(), bookingId: z.uuid(), sessionId: z.string().max(300).nullable() });

export async function cancelOwnBookingAction(
  storeSlug: string,
  marketSlug: string,
  values: { orderId: string; bookingId: string; sessionId: string | null },
): Promise<{ outcome: ChangeOutcome; refundMinor: number }> {
  const parsed = ids.safeParse(values);
  const found = parsed.success ? await access(storeSlug, marketSlug, parsed.data.sessionId) : null;
  if (!parsed.success || !found) return { outcome: "not_found", refundMinor: 0 };
  const result = await cancelOwnBooking(found.storeId, parsed.data.orderId, found.who, parsed.data.bookingId);
  if (result.outcome === "done") refresh();
  return result;
}

export async function moveOwnBookingAction(
  storeSlug: string,
  marketSlug: string,
  values: { orderId: string; bookingId: string; sessionId: string | null; startsAt: string },
): Promise<ChangeOutcome> {
  const parsed = ids.extend({ startsAt: z.iso.datetime({ offset: true }) }).safeParse(values);
  const found = parsed.success ? await access(storeSlug, marketSlug, parsed.data.sessionId) : null;
  if (!parsed.success || !found) return "not_found";
  const outcome = await moveOwnBooking(
    found.storeId,
    parsed.data.orderId,
    found.who,
    parsed.data.bookingId,
    new Date(parsed.data.startsAt).toISOString(),
  );
  if (outcome === "done") refresh();
  return outcome;
}
