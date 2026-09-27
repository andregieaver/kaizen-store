"use server";

import { z } from "zod";

import { rangeCalendar, type RangeCalendar } from "@/lib/booking-ranges";
import { slotWeek, type SlotWeek } from "@/lib/booking-slots";
import { appointmentSlots } from "@/server/appointments";
import { rangeDates } from "@/server/ranges";
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

/** Four weeks of a stay's nights or a rental's days (D67), and which are free. */
export async function rangeDatesAction(
  storeSlug: string,
  marketSlug: string,
  values: { productId: string; from: string | null },
): Promise<RangeCalendar | null> {
  const parsed = input.pick({ productId: true, from: true }).safeParse(values);
  const shop = parsed.success ? await resolveShop(storeSlug, marketSlug) : null;
  if (!parsed.success || !shop) return null;
  const month = await rangeDates(shop.store.id, parsed.data.productId, parsed.data.from);
  return month && rangeCalendar(month, shop.market.locale);
}
