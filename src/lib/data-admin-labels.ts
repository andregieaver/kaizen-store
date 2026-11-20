/**
 * What the import and export pages say that code reads too, in English (bloat review step 2.50): beside `data-admin.ts`, which re-exports it, so
 * the admin's catalogues (`products`, `inventory`) take it from here and import no code. Imports nothing but types.
 */
import type { JobKind } from "./data-job";

/** An import never undoes as a whole; a bulk edit can be undone (section 2.2.4). */
export const IMPORT_CONFIRMATION =
  "Products are saved one at a time; a product with an error is left as it was. You cannot undo an import as a whole; a bulk edit can be undone.";

/** The Omnibus sentence of a bulk price change is `OMNIBUS_SENTENCE` in `bulk-edit.ts`; this is the one-line rule behind an import's compare-at column. */
export const COMPARE_AT_NOTE = "A compare-at price in a file is never imported: a reduction is shown to shoppers only against the lowest price of the last 30 days, which Kaizena Flow takes from its own price history.";

export const KIND_TITLES: Record<JobKind, string> = {
  product_import: "Product import",
  product_export: "Product export",
  order_export: "Order export",
  customer_export: "Customer export",
  redirect_import: "Redirect import",
  redirect_export: "Redirect export",
  inventory_import: "Stock import",
  inventory_export: "Stock export",
  customer_import: "Customer import",
  order_history_import: "Order history import",
};

export const SEVERITY_WORDS = { error: "Error", warning: "Warning", info: "Note" } as const;
