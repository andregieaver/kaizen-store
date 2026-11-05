import { addDays, zonedDate, zonedTime } from "./booking-slots";

/**
 * Asking a carrier to collect a parcel when it is booked (D458): the day and window it is ready in, worked out from the hours the owner gave on
 * the carrier's page ("10:00-17:00", `collectionHours`) in the store's time zone. Pure, so the order page and the booking agree.
 */

/** "10:00-17:00" as the times a courier can collect, or null when it is not that. */
export function collectionHours(typed: string | null | undefined): { from: string; to: string } | null {
  const match = /^\s*(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})\s*$/.exec(typed ?? "");
  if (!match) return null;
  const pad = (n: string) => n.padStart(2, "0");
  const [fh, fm, th, tm] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])];
  if (fh > 23 || th > 23 || fm > 59 || tm > 59) return null;
  const from = `${pad(match[1])}:${match[2]}`;
  const to = `${pad(match[3])}:${match[4]}`;
  return from < to ? { from, to } : null;
}

const weekday = (date: string) => {
  const day = new Date(`${date}T12:00:00Z`).getUTCDay();
  return day !== 0 && day !== 6;
};

/** At least this long between asking and the courier's window closing, so the carrier can still come the same day. */
const LEAD_MINUTES = 120;

/**
 * The collection to ask for now: today on a weekday when the window still has two hours left (from the next quarter hour), else the next weekday's
 * whole window. Null when the hours are not set or not readable (the store hands its parcels in, or has a standing collection).
 */
export function collectionFor(hours: string | null | undefined, now: Date, timeZone: string): { date: string; readyTime: string; closeTime: string } | null {
  const window = collectionHours(hours);
  if (!window) return null;
  const today = zonedDate(now.getTime(), timeZone);
  if (weekday(today)) {
    const close = zonedTime(today, window.to, timeZone);
    if (close - now.getTime() >= LEAD_MINUTES * 60_000) {
      const local = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(now);
      const [h, m] = local.split(":").map(Number);
      const quarter = Math.ceil((h * 60 + m) / 15) * 15;
      const next = `${String(Math.floor(quarter / 60)).padStart(2, "0")}:${String(quarter % 60).padStart(2, "0")}`;
      return { date: today, readyTime: next > window.from ? next : window.from, closeTime: window.to };
    }
  }
  let date = addDays(today, 1);
  while (!weekday(date)) date = addDays(date, 1);
  return { date, readyTime: window.from, closeTime: window.to };
}
