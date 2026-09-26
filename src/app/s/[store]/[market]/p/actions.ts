"use server";

import { z } from "zod";

import { slotWeek, type SlotWeek } from "@/lib/booking-slots";
import { appointmentSlots } from "@/server/appointments";
import { resolveShop } from "@/server/shop";

const input = z.object({
  productId: z.uuid(),
  from: z.iso.date().nullable(),
  resourceId: z.uuid().nullable(),
});

/** Free times of an appointment for a week, with anyone or the chosen member of staff. */
export async function appointmentWeekAction(
  storeSlug: string,
  marketSlug: string,
  values: { productId: string; from: string | null; resourceId: string | null },
): Promise<SlotWeek | null> {
  const parsed = input.safeParse(values);
  const shop = parsed.success ? await resolveShop(storeSlug, marketSlug) : null;
  if (!parsed.success || !shop) return null;
  const week = await appointmentSlots(shop.store.id, parsed.data.productId, {
    from: parsed.data.from,
    resourceId: parsed.data.resourceId,
  });
  return week && slotWeek(week, shop.market.locale, shop.store.timeZone);
}
