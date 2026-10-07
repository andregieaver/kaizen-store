/**
 * Today's date in a store's time zone, for tests. A store's documents, history and exports count days as the store does
 * (`commerce.store_day()`), so a test that compares them with the UTC date fails in the hours when the two differ (after 22:00 UTC
 * in Oslo's summer). Test stores are copies of the template, whose time zone is Europe/Oslo.
 */
export function storeToday(timeZone = "Europe/Oslo", at: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
}
