/**
 * The limits of data in and out (D165, `docs/wave-2-data.md` 4.8): every number in one place, never in a component. They are
 * per store; per-plan limits are not built (the plan comparison of D132 names these). A test holds the numbers.
 */

/** An import's file, in bytes (Shopify's customer file has the same 15 MB ceiling; the page for products states none). */
export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;
/** Rows of a product file, the header excluded. */
export const IMPORT_MAX_ROWS = 60_000;
/** Distinct products (handles) of one import. */
export const IMPORT_MAX_PRODUCTS = 5_000;

/** Rows (a line of an order, a variant, a customer) up to which an export is a download at once; more is a job. */
export const DIRECT_EXPORT_MAX_ROWS = 2_000;
/** The most rows of one export job. */
export const EXPORT_MAX_ROWS = 500_000;
/** Rows in one part of a large export (a file of the job). */
export const EXPORT_PART_ROWS = 100_000;
/** Exports (of any kind) queued or running for a store at once; one product import is allowed at a time. */
export const DATA_EXPORTS_ACTIVE_MAX = 3;

/** Products a bulk list action may take in one request, and the grid. */
export const BULK_MAX_PRODUCTS = 500;
export const BULK_GRID_MAX_PRODUCTS = 50;
/** A bulk action runs this many products at a time, each in its own transaction. */
export const BULK_CHUNK = 25;
/** Days a bulk edit can be undone; the batch and its items are kept 90. */
export const BULK_UNDO_DAYS = 7;
export const BULK_KEEP_DAYS = 90;
/** The most markets a grid shows a price column for. */
export const BULK_GRID_MARKETS_MAX = 4;
/** The most a typed percentage may lower or raise a price by (basis points are ten thousandths of the price). */
export const BULK_PERCENT_MIN = -90;
export const BULK_PERCENT_MAX = 500;
/** A stock figure a bulk edit may set. */
export const BULK_STOCK_MAX = 1_000_000;

/** Order numbers a selection may name. */
export const ORDER_SELECTION_MAX = 500;

/** A job is claimed for this long by one run; a run stops after the budget; a job that makes no progress this many times fails. */
export const DATA_JOB_MAX_ATTEMPTS = 6;
export const DATA_JOB_BUDGET_MS = 40_000;
export const DATA_JOB_CLAIM_MINUTES = 5;

/** How long files and records are kept (days): an export's files, an import's file, a job's items and assets, a job row (months below). */
export const EXPORT_KEEP_DAYS = 7;
export const IMPORT_FILE_KEEP_DAYS = 30;
export const JOB_ITEMS_KEEP_DAYS = 90;
export const JOB_ROW_KEEP_MONTHS = 12;
/** A signed address for a download lives this long, in seconds. */
export const DOWNLOAD_LINK_SECONDS = 60;

/** A picture an import fetches: at most this big, of these types, shrunk to this width (the editor's own sizes). */
export const IMPORT_PICTURE_MAX_BYTES = 10 * 1024 * 1024;
export const IMPORT_PICTURE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"] as const;
export const IMPORT_PICTURE_WIDTH = 1600;
export const IMPORT_THUMBNAIL_WIDTH = 480;

// ---------------------------------------------------------------------------
// Redirects and the 404 report (wave 2, second run, D168, `docs/wave-2-redirects.md` 4.1 rule 11, 3.2, 4.6)
// ---------------------------------------------------------------------------

/** Redirects of a store's own (manual: staff, an import or the assistant); Shopify's figure. Automatic ones are made by triggers and are not refused. */
export const REDIRECTS_MAX = 100_000;
/** Data rows of a redirect file, the header excluded. */
export const REDIRECT_IMPORT_MAX_ROWS = 100_000;
/** Lines of a redirect import written in one transaction, under the store's lock. */
export const REDIRECT_APPLY_CHUNK = 500;
/** Rows of a stock file judged and written together (each row is its own transaction); small in tests to make a few rows several chunks (wave 3, D172). */
export const INVENTORY_APPLY_CHUNK = 200;
/** The most redirects deleted in one request, and rows of the manager's list on a page. */
export const REDIRECT_BULK_DELETE_MAX = 200;
export const REDIRECT_PAGE_SIZE = 50;
/** Hops followed in one response; Google follows at most 10. A loop or the eleventh hop is a 404. */
export const REDIRECT_HOPS_MAX = 10;
/** Rows of a redirect export that download at once; more is a job. */
export const REDIRECT_EXPORT_DIRECT_MAX = DIRECT_EXPORT_MAX_ROWS;

/** Different addresses recorded for one store on one UTC day; the counts of an address are not capped, the rest are counted in one row without an address. */
export const NOT_FOUND_DAY_CAP = 1_000;
/** Days the 404 report keeps a row after its day. */
export const NOT_FOUND_KEEP_DAYS = 90;
/** The report's windows in days (the first is the default), the rows on screen, the rows of its CSV, and the addresses a store may hide. */
export const NOT_FOUND_WINDOWS = [30, 7, 90] as const;
export const NOT_FOUND_SCREEN_ROWS = 500;
export const NOT_FOUND_CSV_ROWS = 5_000;
export const NOT_FOUND_IGNORED_MAX = 1_000;
/** A flood of one address is written once a second at most (per server instance). */
export const NOT_FOUND_THROTTLE_MS = 1_000;
/** Suggested targets of a missing address. */
export const NOT_FOUND_SUGGESTIONS = 3;
