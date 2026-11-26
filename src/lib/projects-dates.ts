/**
 * An item's dates (D903) between the instant kept and the fields a person fills in, always in the store's zone: a day and, unless it is for
 * the day as a whole, a time. A whole day is kept at noon, the same calendar day in every European zone. Pure, for the editor in the browser
 * and the server alike.
 */

import { zonedDate, zonedTime } from "./booking-slots";

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The fields for a kept instant: its day and time in the zone (no time for a whole day). */
export function whenFields(iso: string | null, allDay: boolean | null, timeZone: string): { day: string; time: string } {
  if (!iso) return { day: "", time: "" };
  const ms = Date.parse(iso);
  const day = zonedDate(ms, timeZone);
  if (allDay) return { day, time: "" };
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return { day, time: `${get("hour")}:${get("minute")}` };
}

/** The instant for a day and a time typed in the zone; a day alone is a whole day; nothing (or a day that is not one) is none. */
export function instantOf(day: string, time: string, timeZone: string): { at: string | null; allDay: boolean | null } {
  if (!DAY.test(day)) return { at: null, allDay: null };
  const timed = TIME.test(time);
  return { at: new Date(zonedTime(day, timed ? time : "12:00", timeZone)).toISOString(), allDay: !timed };
}

/** Where a due time stands on the store's day: late (a day before today, or a time already passed), today, or later. */
export function dueState(iso: string, allDay: boolean | null, now: Date, timeZone: string): "late" | "today" | "later" {
  const today = zonedDate(now.getTime(), timeZone);
  const day = zonedDate(Date.parse(iso), timeZone);
  if (day < today || (!allDay && day === today && Date.parse(iso) < now.getTime())) return "late";
  return day === today ? "today" : "later";
}
