import { FINDING_CODES, type Finding, type FindingCode, type Severity } from "./data-job";

/**
 * What the AI manager says about a product import's findings (D165, `docs/wave-2-data.md` 5.5): the findings of a job grouped by their stable code, each
 * with how many products it touched, its sentence (the one the import page shows, written from names and numbers and never quoting a cell), what to do about
 * it and a few of the products it was about. Pure: the counting happens here in code from the stored items, so the model repeats figures and never makes one.
 * `FIX_FOR` is typed over every code, so a new finding code is a compile error until it says what to do; a test holds the same at run time.
 */

/** What to do about each finding, in a line the assistant can repeat. Plain, careful and about the file, never about the law. */
export const FIX_FOR: Record<FindingCode, string> = {
  "file.too_large": "Split the file into smaller files (at most 15 MB each) and import them one after another.",
  "file.too_many_rows": "Split the file so each part has at most 60,000 rows, keeping each product's rows together, and import the parts one after another.",
  "file.too_many_products": "Split the file so each part has at most 5,000 products, keeping each product's rows together.",
  "file.empty": "Check that the right file was chosen: this one has no rows.",
  "file.no_header": "Add the header row with the column names as the first row. Exporting a product from Kaizen shows what it looks like.",
  "file.unknown_format": "Use a file exported from Kaizen (Products, Export) or Shopify's own product export, and do not change the header row.",
  "file.encoding_assumed": "Open the products in the preview and check that æ, ø and å look right. If not, save the file again as CSV UTF-8.",
  "file.delimiter": "Nothing to do: the separator was found from the file.",
  "file.ragged_row": "Open the file in a spreadsheet and check that every row has as many cells as the header; a text with a line break or a comma must be in quotes.",
  "price_basis.mismatch": "Export again from this store and edit that file, or set the price_basis column to what the store uses (with VAT, or without it for a store that sells only to businesses).",
  "price_basis.required": "On the import page, say whether the prices in the Shopify file include VAT, then check the file again.",
  "row.handle_missing": "Give the row a handle, or move it under the product it belongs to if it is an extra picture.",
  "row.handle_invalid": "Use a handle with lowercase letters, digits and single hyphens, at most 80 characters.",
  "handle.duplicate_in_file": "Keep all rows of a product together: put the later rows under the first ones, or give the later product its own handle.",
  "handle.mismatch": "An import never changes a product's web address. Use the variant id and handle the product has in the store (export it to see them), or remove the variant id.",
  "sku.missing": "Give every variant a SKU. It is what an import matches a variant by.",
  "sku.duplicate_in_file": "Make each SKU in the file unique.",
  "sku.in_other_product": "A SKU belongs to one variant in the whole store. Change the SKU in the file, or change it on the other product first (Products).",
  "variant.unknown_id": "Remove the variant id, or export the product again to get the ids it has.",
  "options.mismatch": "Give every row of a product the same option names (option1_name and so on); only the values differ between variants.",
  "options.too_many": "A product has at most three options and 100 variants here. Split the product, or reduce its variants.",
  "price.unreadable": "Write the price as a number in the market's currency, such as 249.00 or 249,00, without a currency sign.",
  "price.market_unknown": "Nothing to do unless the store should sell in that market: the price columns follow the store's own markets.",
  "price.negative": "Check the price: a price cannot be below 0.",
  "cost.unreadable": "Write the cost as a number in the store's main currency, without VAT.",
  "stock.invalid": "Write stock as a whole number from 0 to 1,000,000, or leave it empty to keep the current stock.",
  "stock_policy.invalid": "Write deny to stop selling at zero stock, or continue to keep selling on backorder, or leave the cell empty to change nothing.",
  "stock_policy.not_goods": "Only goods that are shipped can be sold past zero. Use deny, or leave the cell empty.",
  "backorder_days.invalid": "Write the delivery time as a whole number of days from 1 to 90.",
  "backorder_days.required": "Add the days within which a backordered item is expected to ship (1 to 90), or use deny.",
  "low_stock_threshold.invalid": "Write the warning level as a whole number from 0 to 1,000,000, or leave the cell empty to switch the warning off.",
  "inventory.multi_location_stock_ignored": "Set the stock on the Inventory page, or import a stock file with a location column. The other columns of the file are imported.",
  "gtin.invalid": "A barcode is 8 to 14 digits. Remove spaces and letters, or leave it empty.",
  "hs_code.invalid": "A customs (HS) code is 6 to 10 digits.",
  "origin.invalid": "Use the two-letter country code, such as NO or SE.",
  "measure.invalid": "Write the content as a number with a unit the store can use (such as 500 and g, or 0.75 and l) and a base for the unit price.",
  "weight.invalid": "Write the weight as a whole number of grams above 0.",
  "delivery.not_importable": "A product that needs no shipping, or a download, is set up in the product editor.",
  "kind.not_importable": "Create appointments, stays and rentals in the product editor, which asks who does them. An existing one can be updated here in its plain columns.",
  "status.unknown": "Use draft, active or archived.",
  "status.draft_because_unpublished": "Nothing to do if a draft is what you want. To publish it, set the status to active in the file or in the editor.",
  "product.drafted": "Open the product in the editor and fix what the sentence names (a picture, a manufacturer or a price), then publish it.",
  "value.cleared": "Nothing to do if clearing was meant. If not, fill the cell or remove the column from the file: a column that is not in the file keeps the current value.",
  "media.too_many": "A product has at most 12 pictures here. Remove some from the file.",
  "media.address_invalid": "Use a full web address starting with https:// that is public.",
  "media.fetch_failed": "Check that the picture address is public and is a picture (jpeg, png, webp, gif or avif) of at most 10 MB, then import again, or add the picture in the editor.",
  "term.created": "Nothing to do: the categories and tags are created when the import is applied. Check the spelling if one looks wrong.",
  "field.unknown": "Nothing to do unless that custom field should exist: add it under Custom fields, then export again.",
  "field.ambiguous": "Two custom fields have the same name. Rename one of them under Custom fields, then export again.",
  "field.invalid": "Give the field a value of the kind it holds (a number, a date, one of its choices) or leave it empty.",
  "column.ignored": "Nothing to do: that column is not imported, and the sentence says why.",
  "giftcard.not_supported": "Remove gift cards from the file. Kaizen does not import them.",
  "inventory.continue_selling_ignored": "Set it per variant in the product editor or on the Inventory page, with the days a backordered item is expected to ship. Until then a product at 0 stops selling.",
  "tax.ignored": "Nothing to do unless the product's VAT category is wrong, which is set in the editor.",
  "compare_at.ignored": "Nothing to do. A price reduction is shown from the product's own price history.",
  "product.exists": "Choose Create new and update existing if the products should be updated.",
  "product.missing": "Choose Create new and update existing if the products should be created.",
  "product.not_published": "Fix what the sentence names in the editor, or choose to save such products as drafts.",
  "vat_category.unknown": "Use a VAT category the store has (export a product to see them), or leave the column out.",
  "active.invalid": "Write true or false.",
  "save.failed": "The product was left as it was. Open it in the editor to see what stops it from being saved, or fix the file and import again.",
  "file.not_redirects": "Use a file with the columns Redirect from and Redirect to in the first row (Shopify's redirect file, or one exported from Redirects), saved as CSV.",
  "source.missing": "Fill in the old address (Redirect from) on that line, or remove the line.",
  "source.invalid": "Write the old address as a path on the store, such as /old-page, without spaces, and at most 500 characters and 12 parts.",
  "source.external": "Only addresses on this store can be redirected. Write the old address as a path, such as /old-page, or remove the line.",
  "source.market_prefix": "Take the country away from the old address (/old-page, not /no/old-page): one redirect works in every country and language.",
  "source.reserved": "A page the store uses itself (such as the cart, checkout or account) cannot be redirected. Remove the line.",
  "source.live": "Redirect only from an address that does not exist. Change or retire the page, product, category, tag or article that has it first, or remove the line.",
  "source.root": "The front page cannot be redirected. Remove the line.",
  "source.query_dropped": "Nothing to do: a redirect matches the path only, and keeps the shopper's own query string.",
  "target.missing": "Fill in the new address (Redirect to) on that line, or remove the line.",
  "target.invalid": "Write the new address as a path on the store, such as /category/shoes, or as a full https address of the store, without spaces or a password.",
  "target.external": "A redirect can only go to a page on this store. Write the new address as a path, such as /category/shoes, or remove the line.",
  "target.market_removed": "Nothing to do: the shopper keeps their own country and language.",
  "target.self": "Give the line a new address that differs from the old one, or remove it.",
  "target.loop": "Change the new address, or delete or change one of the redirects named, so the shopper reaches a page.",
  "target.chain": "Nothing to do: the final destination was saved, so the shopper goes there in one step.",
  "target.not_found": "Check the new address for a typo, or create the page it should go to. Until then the shopper sees the store's not-found page.",
  "duplicate.in_file": "Keep one line for each old address. The first line is used; remove or change the later ones.",
  "exists.update": "Nothing to do if the new address should replace the old one. To keep the old redirect, choose to keep existing redirects when you check the file.",
  "exists.same": "Nothing to do: the redirect is already there.",
  "exists.skipped": "Choose to replace existing redirects when you check the file if the new address should win.",
  "exists.replaced_automatic": "Nothing to do unless the automatic redirect was right: then remove the line.",
  "limit.reached": "A store can have 100,000 redirects of its own. Delete redirects that are not used, or import fewer lines.",
  "file.not_inventory": "Export the stock from the Inventory page and edit that file, or give the first row a sku column and an on_hand column.",
  "stockfile.sku_missing": "Give the row the SKU of the variant that was counted.",
  "stockfile.sku_unknown": "Check the SKU against the product's page. A stock file only counts variants that exist; create a new product in the editor.",
  "stockfile.sku_not_goods": "Take the row out of the file: downloads, services and bookings have no stock.",
  "stockfile.location_unknown": "Use the name of a location exactly as the Locations page shows it, or add the location there first.",
  "stockfile.location_required": "Fill in the location column on every row, with the name of one of the store's locations.",
  "stockfile.on_hand_invalid": "Write the counted figure as a whole number from 0 to 1,000,000, without spaces or units.",
  "stockfile.on_hand_was_invalid": "Leave on_hand_was as the export wrote it, or empty to set the figure whatever the stock is now.",
  "stockfile.reason_invalid": "Use one of the reasons listed, or leave the column empty to record the change as a count.",
  "stockfile.note_too_long": "Shorten the note to 200 characters, and do not write about a person.",
  "stockfile.policy_invalid": "Write deny to stop selling at zero, or continue to keep selling, or leave the column empty to change nothing.",
  "stockfile.days_required": "Add the days within which a backordered item is expected to ship (1 to 90), or use deny.",
  "stockfile.days_invalid": "Write the delivery time as a whole number of days from 1 to 90.",
  "stockfile.days_ignored": "Nothing to do, or set stock_policy to continue if the item should keep selling at zero.",
  "stockfile.threshold_invalid": "Write the warning level as a whole number from 0 to 1,000,000, or leave it empty to change nothing.",
  "stockfile.duplicate": "Keep one row for each SKU and location. If both counts were meant, add them and write the total.",
  "stockfile.conflict": "The stock moved after the file was made (a sale, or someone's count). Export again, count again, and import the new file.",
  "stockfile.failed": "Try the row again in a new file, or set the stock on the Inventory page.",
};

export type ProblemGroup = {
  code: FindingCode;
  severity: Severity;
  /** How many findings of this kind, and in how many different products (a product with several variants may have several). */
  findings: number;
  products: number;
  /** The first sentence stored for it (written by the import from names and numbers, never quoting a cell), and what to do. */
  sentence: string;
  what_to_do: string;
  /** Up to `EXAMPLES` handles of the products it was about. */
  examples: string[];
};

/** How many products a group names. */
export const EXAMPLES = 5;

const RANK: Record<Severity, number> = { error: 0, warning: 1, info: 2 };
const known = new Set<string>(FINDING_CODES);

type ItemLike = { ref: string | null; messages: readonly Finding[] };

/**
 * The findings of a job's items grouped by code: errors first, then warnings, then information, the most findings first. A code this version does not
 * know (an item written by a newer one) is skipped, never invented. Counted here, so the totals the assistant reads are code's.
 */
export function groupFindings(items: readonly ItemLike[]): { groups: ProblemGroup[]; totals: Record<Severity, number> } {
  const byCode = new Map<FindingCode, { severity: Severity; findings: number; refs: Set<string>; handles: string[]; sentence: string }>();
  const totals: Record<Severity, number> = { error: 0, warning: 0, info: 0 };
  for (const item of items) {
    for (const message of item.messages) {
      if (!known.has(message.code)) continue;
      const code = message.code as FindingCode;
      const group = byCode.get(code) ?? { severity: message.severity, findings: 0, refs: new Set<string>(), handles: [], sentence: message.text };
      group.findings += 1;
      if (item.ref && !group.refs.has(item.ref)) {
        group.refs.add(item.ref);
        if (group.handles.length < EXAMPLES) group.handles.push(item.ref);
      }
      byCode.set(code, group);
      totals[message.severity] += 1;
    }
  }
  const groups = [...byCode.entries()]
    .map(([code, g]): ProblemGroup => ({ code, severity: g.severity, findings: g.findings, products: g.refs.size, sentence: g.sentence, what_to_do: FIX_FOR[code], examples: g.handles }))
    .sort((a, b) => RANK[a.severity] - RANK[b.severity] || b.findings - a.findings || a.code.localeCompare(b.code));
  return { groups, totals };
}
