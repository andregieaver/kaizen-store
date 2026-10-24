/**
 * Product reviews' fixed words (D301, `docs/wave-5-marketing.md` 9): the states, sources, reasons a review is not shown and the limits, shared by
 * the schema, the database's checks, the server and the browser (no zod, no server imports).
 */

/** `pending` waits for staff (or for the author's edit to be checked again), `published` is shown, `hidden` is kept and not shown. */
export const REVIEW_STATUSES = ["pending", "published", "hidden"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** A buyer's review is written from an order line they received (a verified purchase); an import came from another service, never verified. */
export const REVIEW_SOURCES = ["buyer", "import"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];

/** Why staff do not show a review (Annex I 23c: never because it is negative). */
export const HIDE_REASONS = ["not_about_product", "offensive", "personal_data", "spam", "other"] as const;
export type HideReason = (typeof HIDE_REASONS)[number];

/** `after_check`: a new or edited review waits for staff; `at_once`: published when written, staff may hide it after. */
export const PUBLISH_MODES = ["after_check", "at_once"] as const;
export type PublishMode = (typeof PUBLISH_MODES)[number];

export const REVIEW_NAME_MAX = 60;
export const REVIEW_TITLE_MAX = 120;
export const REVIEW_BODY_MAX = 5000;
export const REVIEW_ANSWER_MAX = 2000;
export const IMPORTED_FROM_MAX = 80;

/** A line can be reviewed for this long after it was received. */
export const REVIEW_WINDOW_DAYS = 365;
/** Writes (new, edited or deleted) a customer may make a day. */
export const REVIEW_WRITES_A_DAY = 20;

/** The request email's days after receipt (G3). */
export const REQUEST_DAYS_MIN = 3;
export const REQUEST_DAYS_MAX = 60;
export const REQUEST_DAYS_DEFAULT = 14;

/** Status moves outside the author's write; the author's write may also send any review back to `pending`. */
export function mayModerate(from: ReviewStatus, to: ReviewStatus): boolean {
  if (from === "pending") return to === "published" || to === "hidden";
  if (from === "published") return to === "hidden";
  return to === "published";
}

/** A request email's link works this long (9.6). */
export const REQUEST_LINK_DAYS = 90;
/** How many products a request email names; the page lists every one of the order's. */
export const REQUEST_PRODUCTS_SHOWN = 5;
/** Orders asked per store and run of the every-minute job. */
export const REQUEST_BATCH = 50;
/** Request rows are kept this long (a link's life is long past), then deleted daily. */
export const REQUESTS_KEEP_DAYS = 400;
