/**
 * The countdown timer (D560), pure: the time left until a fixed moment the owner chose, the same for every visitor. A timer that starts
 * again for each visitor would announce an urgency that is not there, which EU consumer law forbids (Directive 2005/29/EC Annex I, 7), so
 * there is none: only an end that is real. At zero the timer is gone, so a past offer is never announced.
 */

export type TimeLeft = { days: number; hours: number; minutes: number; seconds: number };

/** What is left until `endsAt` at `now`, in whole units; null once it has passed (the timer then draws nothing). */
export function timeLeft(endsAt: string | null, now: number): TimeLeft | null {
  if (!endsAt) return null;
  const end = Date.parse(endsAt);
  if (Number.isNaN(end) || end <= now) return null;
  let s = Math.floor((end - now) / 1000);
  const days = Math.floor(s / 86_400);
  s -= days * 86_400;
  const hours = Math.floor(s / 3_600);
  s -= hours * 3_600;
  const minutes = Math.floor(s / 60);
  return { days, hours, minutes, seconds: s - minutes * 60 };
}

/** An end as kept: an ISO moment in UTC, from what the owner's browser read in their own time zone; null for one that is not a date. */
export function cleanEnd(value: string): string | null {
  const at = Date.parse(value);
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}

/** The value of a `datetime-local` field for a kept end, in the browser's own time zone. */
export function endFieldValue(endsAt: string | null): string {
  if (!endsAt) return "";
  const at = new Date(endsAt);
  if (Number.isNaN(at.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
}
