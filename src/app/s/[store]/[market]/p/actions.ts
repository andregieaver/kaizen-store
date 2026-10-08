"use server";

import { z } from "zod";

import { formatClock, parseRentalPeriod, rangeCalendar, type RangeCalendar, type RentalPeriod } from "@/lib/booking-ranges";
import { slotWeek, type SlotWeek } from "@/lib/booking-slots";
import { appointmentSlots } from "@/server/appointments";
import { rangeDates, rentalTimes } from "@/server/ranges";
import { resolveSellingShop } from "@/server/shop";

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
  const shop = parsed.success ? await resolveSellingShop(storeSlug, marketSlug) : null;
  if (!parsed.success || !shop) return null;
  const week = await appointmentSlots(shop.store.id, parsed.data.productId, {
    from: parsed.data.from,
    resourceId: parsed.data.resourceId,
  });
  return week && slotWeek(week, shop.market.locale, shop.store.timeZone);
}

/** Four weeks of a stay's nights or a rental's days (D67), and which are free: for a variant by the half day or hour, any of it (D69). */
export async function rangeDatesAction(
  storeSlug: string,
  marketSlug: string,
  values: { productId: string; from: string | null; period?: RentalPeriod },
): Promise<RangeCalendar | null> {
  const parsed = input.pick({ productId: true, from: true }).safeParse(values);
  const shop = parsed.success ? await resolveSellingShop(storeSlug, marketSlug) : null;
  if (!parsed.success || !shop) return null;
  const month = await rangeDates(shop.store.id, parsed.data.productId, parsed.data.from, Date.now(), parseRentalPeriod(values.period));
  return month && rangeCalendar(month, shop.market.locale);
}

/** A start time a shopper can choose for a rental by the half day or hour, and how many hours are free from it. */
export type RentalTimeChoice = { startsAt: string; label: string; free: number };

/** The times a rental's variant by the half day or hour can start on a date (D69), labelled in the shopper's language. */
export async function rentalTimesAction(
  storeSlug: string,
  marketSlug: string,
  values: { productId: string; date: string; period: RentalPeriod },
): Promise<RentalTimeChoice[] | null> {
  const parsed = z
    .object({ productId: z.uuid(), date: z.iso.date(), period: z.enum(["half_day", "hour"]) })
    .safeParse(values);
  const shop = parsed.success ? await resolveSellingShop(storeSlug, marketSlug) : null;
  if (!parsed.success || !shop) return null;
  const times = await rentalTimes(shop.store.id, parsed.data.productId, parsed.data.date, parsed.data.period);
  if (!times) return null;
  const clock = (iso: string) => formatClock(iso, shop.market.locale, shop.store.timeZone);
  return times.map((t) => ({
    startsAt: t.startsAt,
    label: parsed.data.period === "half_day" ? `${clock(t.startsAt)}–${clock(t.endsAt)}` : clock(t.startsAt),
    free: t.free,
  }));
}
