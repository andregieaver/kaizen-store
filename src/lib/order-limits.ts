/**
 * The numbers of the order list, tags, archive, draft orders and gift messages (wave 3, run 2, D173, `docs/wave-3-orders.md` 4.1).
 * One module so a limit is one reviewed change: `order-limits.test.ts` pins every value, the database checks and triggers of
 * `orders_ops_rules` use the same numbers, and the screens say them out loud ("at most 250 tags", "300 characters").
 * Pure: no server import, no zod (the cart page, a pay route, reaches the gift limits through `src/lib/gift.ts`).
 */

/** Shopify's limit (read, `docs/wave-3-orders.md` 1.2). Counted in Unicode code points after trimming and collapsing spaces. */
export const TAG_MAX_LENGTH = 40;
/** Shopify's limit (read). Held by the trigger `order_tags_limit()`, so two bulk runs cannot both pass it. */
export const TAGS_PER_ORDER = 250;

/** Orders on a page of the list (keyset paging, no page numbers). */
export const ORDERS_PAGE_SIZE = 50;
/** The count is a bounded query; above this the page says "10,000+". */
export const ORDERS_COUNT_CAP = 10_000;

export const SEARCH_MAX_LENGTH = 100;
export const SEARCH_MAX_WORDS = 5;
/** A word shorter than this is ignored unless it is all digits. */
export const SEARCH_MIN_WORD = 2;

/** Orders in one bulk action (the row's "up to 250 at once"). Applied to every bulk action. */
export const BULK_MAX = 250;
/** Orders in one printed document of packing slips (a print is not a write). */
export const BULK_PRINT_MAX = 100;

export const VIEWS_MAX = 30;
export const VIEW_TITLE_MAX = 40;
/** The most columns a saved view can name (there are ten to choose from). */
export const VIEW_COLUMNS_MAX = 12;
/** A saved view's parameters, serialised: the database refuses above this (`octet_length(params::text)`). */
export const VIEW_PARAMS_MAX_BYTES = 4096;

export const GIFT_MESSAGE_MAX = 300;
export const GIFT_NAME_MAX = 60;
export const GIFT_MESSAGE_LINES = 6;

export const DRAFT_LINES_MAX = 100;
export const DRAFT_QUANTITY_MAX = 9_999;
export const DRAFTS_OPEN_MAX = 500;
export const DRAFT_TITLE_MAX = 120;
/**
 * The most one unit of a draft line can cost, in minor units (10 million in a currency with two decimals): it keeps every sum of a draft (100 lines
 * of 9,999 units) inside what a JavaScript number holds exactly, so the pricing needs no rounding of its own beyond the minor unit.
 */
export const DRAFT_PRICE_MAX_MINOR = 1_000_000_000;
/** The title column of a draft line: a catalogue line's product title and options can be longer than a custom item's. */
export const DRAFT_LINE_TITLE_COLUMN_MAX = 200;
export const DRAFT_DISCOUNT_LABEL_MAX = 60;
export const DRAFT_NOTE_TO_BUYER_MAX = 500;
export const DRAFT_INTERNAL_NOTE_MAX = 1_000;
export const DRAFT_REFERENCE_MAX = 200;

export const DRAFT_VALID_DAYS_DEFAULT = 7;
export const DRAFT_VALID_DAYS_MIN = 1;
export const DRAFT_VALID_DAYS_MAX = 30;
/** A draft paid outside Kaizen has no pay link; the order it makes is held this long (the moment it is paid, in the same transaction). */
export const DRAFT_PAID_OUTSIDE_VALID_DAYS = 1;

/** How many times one draft's link can be sent again in a day, and how many links a store sends in an hour (the abuse brake). */
export const DRAFT_SENDS_PER_DAY = 5;
export const DRAFT_SENDS_PER_HOUR_STORE = 60;

/** GDPR Art. 5(1)(c) and (e): an open draft untouched this long is deleted; a finished one this long after it ended. */
export const DRAFT_OPEN_RETENTION_DAYS = 90;
export const DRAFT_DONE_RETENTION_DAYS = 30;

/** Automatic archiving never starts before the 14-day withdrawal period (D153) can have run. */
export const AUTO_ARCHIVE_MIN_DAYS = 14;
export const AUTO_ARCHIVE_MAX_DAYS = 365;
/** Orders the five-minute job archives for one store in one run. */
export const AUTO_ARCHIVE_BATCH = 200;

/** Percent discounts are kept as basis points (hundredths of a percent): 0.01 % to 100.00 %. */
export const DISCOUNT_BPS_MIN = 1;
export const DISCOUNT_BPS_MAX = 10_000;

/** The tags the order page offers as suggestions (the store's most used). */
export const TAG_SUGGESTIONS = 200;

/** How many days back staff may date money taken outside Kaizen (the day it was received decides the VAT period, so it cannot be moved far back). */
export const MANUAL_RECEIVED_DAYS_MAX = 31;
