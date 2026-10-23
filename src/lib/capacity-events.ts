/**
 * A busy time an owner tells Kaizena Flow about (D314, `docs/capacity.md` step 4.1): a start, an end at most 14 days later, how busy and a
 * short note. Pure, no zod: the Billing page and its action share it.
 */

export const EXPECTED = ["busy", "very_busy"] as const;
export type Expected = (typeof EXPECTED)[number];
export const PEAK_MAX_DAYS = 14;
export const NOTE_MAX = 300;

export type PeakInput = { startsAt: Date; endsAt: Date; expected: Expected; note: string };

/** Reads the form: dates as `YYYY-MM-DD` (the start's day from 00:00, the end's to 23:59, UTC), how busy, a note. Null when not one. */
export function parsePeak(form: { starts?: unknown; ends?: unknown; expected?: unknown; note?: unknown }, now: Date = new Date()): PeakInput | null {
  const day = (value: unknown) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null);
  const starts = day(form.starts);
  const ends = day(form.ends);
  if (!starts || !ends) return null;
  const startsAt = new Date(`${starts}T00:00:00Z`);
  const endsAt = new Date(`${ends}T23:59:59Z`);
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) return null;
  if (endsAt <= startsAt || endsAt.getTime() - startsAt.getTime() > PEAK_MAX_DAYS * 86_400_000) return null;
  // A time that is already over tells nobody anything.
  if (endsAt < now) return null;
  const expected = EXPECTED.find((e) => e === form.expected) ?? "busy";
  const note = typeof form.note === "string" ? form.note.trim().slice(0, NOTE_MAX) : "";
  return { startsAt, endsAt, expected, note };
}
