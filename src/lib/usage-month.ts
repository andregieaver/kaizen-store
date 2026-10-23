/** The month a usage page shows (D314): `YYYY-MM` from the address, else the current UTC month; never after it. Pure. */
export function usageMonth(given: unknown, now: Date = new Date()): string {
  const current = now.toISOString().slice(0, 7);
  if (typeof given !== "string" || !/^\d{4}-(0[1-9]|1[0-2])$/.test(given)) return current;
  return given > current ? current : given;
}

/** The month before or after, as `YYYY-MM`. */
export function shiftMonth(month: string, by: number): string {
  const [year, m] = month.split("-").map(Number);
  const date = new Date(Date.UTC(year, m - 1 + by, 1));
  return date.toISOString().slice(0, 7);
}
