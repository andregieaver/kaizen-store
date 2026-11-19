import { zoneOf } from "./admin-date";

/**
 * Dates people read outside the admin (code review 1.14's next, FS12, D796): the same pure formatter D786 built for the admin
 * (`src/lib/admin-date.ts`), under names that do not say admin, for storefront pages, shoppers' emails, contracts and Kaizena Flow's own
 * site and mail. Server pages and client parts alike.
 *
 * - `dateIn(where, at, style, locale)`: an instant (an order placed, an article published, a campaign's end, a subscription's next charge)
 *   in the store's own zone (`store`, `store.timeZone`) and the visitor's or the email's locale (`market.locale`, `order.locale`). Kaizena
 *   Flow's own site and its mail to owners about plans and invoices use `PLATFORM_TIME_ZONE`. A bare `YYYY-MM-DD` is a calendar day, never
 *   moved.
 * - `calendarDate(day, style, locale)`: a calendar day (a `date` column, a release date, a due date), never moved by a zone.
 *
 * Never format a moment without a zone (a locale alone gives UTC's day on the server, Vercel's clock, and the browser's in a client part,
 * so the page and its hydration disagree), never write a zone's name out, and never cut a day from a UTC string: `dates.scan.test.ts`
 * holds storefront, email and server code to it, as `admin-dates.scan.test.ts` holds the admin.
 */
export { adminDate as dateIn, adminDay as calendarDate, NORWAY_TIME_ZONE, PLATFORM_TIME_ZONE, zoneOf } from "./admin-date";

/**
 * A store's zone from a row read without a type (`row.time_zone`). The column is never null (`commerce.stores.time_zone`, whose default is
 * the platform's zone), so the platform's zone stands in only where no store row came back (a store since deleted, an outer join that found
 * none) or for a name this runtime does not know, as with `zoneOf()`.
 */
export const storeZoneOf = (value: unknown): string => zoneOf(typeof value === "string" ? value : null);
