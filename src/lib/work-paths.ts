/**
 * Where Work lives in the admin (D123): at the store owner's level, one place
 * for every store's clients, hours and invoices. `/admin/account/work` is the
 * combined view; one store's own screens are under `/admin/account/work/s/{store}`
 * (`s` is shorter than any store address, so no store can take it). Build every
 * Work link with these, never by hand.
 */
export const WORK_ROOT = "/admin/account/work";

/** One store's Work, for example `${workBase("acme")}/clients`. */
export function workBase(storeSlug: string): string {
  return `${WORK_ROOT}/s/${storeSlug}`;
}
