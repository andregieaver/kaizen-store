/**
 * The lifecycle and the findings of data jobs (D165, `docs/wave-2-data.md` 3.1, 4.4), pure: which status may follow which (the
 * database holds the same table in `commerce.data_job_move_allowed()` and a PGlite test holds the two together), the stable
 * codes of an import's findings with their sentences, and the counts of a job.
 *
 * A finding's sentence may name a handle, a SKU or a column and NEVER quotes a cell of the file: a file's cells can hold anything
 * (a person's name in a title, a formula), and findings are stored, shown and downloaded.
 */

export const JOB_KINDS = ["product_import", "product_export", "order_export", "customer_export", "redirect_import", "redirect_export"] as const;
export type JobKind = (typeof JOB_KINDS)[number];

export const JOB_STATUSES = ["uploaded", "checking", "checked", "queued", "running", "done", "failed", "cancelled", "expired"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const JOB_PHASES = ["check", "apply", "write", "assemble"] as const;
export type JobPhase = (typeof JOB_PHASES)[number];

/** The kinds that read a file the member uploaded: a dry run, then an apply (the redirect import is wave 2's second run, D168). */
export const IMPORT_KINDS: readonly JobKind[] = ["product_import", "redirect_import"];
export const EXPORT_KINDS: readonly JobKind[] = ["product_export", "order_export", "customer_export", "redirect_export"];
export const isImport = (kind: JobKind): boolean => IMPORT_KINDS.includes(kind);
export const isExport = (kind: JobKind): boolean => !isImport(kind);
/** Exports that hold personal data of shoppers: owner-only, deleted on an erasure. */
export const hasPersonalData = (kind: JobKind): boolean => kind === "order_export" || kind === "customer_export";

/** Statuses of a job still to do or being done: one import of each kind of these per store, exports counted against the active limit. */
export const ACTIVE_IMPORT_STATUSES: readonly JobStatus[] = ["uploaded", "checking", "checked", "queued", "running"];
export const ACTIVE_EXPORT_STATUSES: readonly JobStatus[] = ["queued", "running"];
export const ENDED_STATUSES: readonly JobStatus[] = ["done", "failed", "cancelled", "expired"];

export const isEnded = (status: JobStatus): boolean => ENDED_STATUSES.includes(status);
export const isActive = (kind: JobKind, status: JobStatus): boolean =>
  (isImport(kind) ? ACTIVE_IMPORT_STATUSES : ACTIVE_EXPORT_STATUSES).includes(status);

/**
 * What may follow what. Forward only, with one move back: a `checked` import checked again after its options changed. An ended job
 * never runs again (it may only expire, when its files are purged). Mirrors `commerce.data_job_move_allowed()`.
 */
const NEXT: Record<JobStatus, readonly JobStatus[]> = {
  uploaded: ["checking", "cancelled", "failed", "expired"],
  checking: ["checked", "cancelled", "failed"],
  checked: ["checking", "queued", "cancelled", "failed", "expired"],
  queued: ["running", "cancelled", "failed"],
  running: ["done", "failed", "cancelled"],
  done: ["expired"],
  failed: ["expired"],
  cancelled: ["expired"],
  expired: [],
};

/** Whether a job may go from one status to another (staying put is always allowed). */
export function canMove(from: JobStatus, to: JobStatus): boolean {
  return from === to || NEXT[from].includes(to);
}

/** The statuses a kind of job can be in: an export never uploads, checks or waits to be applied. */
export function statusesOf(kind: JobKind): readonly JobStatus[] {
  return isImport(kind) ? JOB_STATUSES : JOB_STATUSES.filter((s) => s !== "uploaded" && s !== "checking" && s !== "checked");
}

/** The status a new job of a kind starts in. */
export const startStatus = (kind: JobKind): JobStatus => (isImport(kind) ? "uploaded" : "queued");

/** A job's own words for a status, for the page and the email. */
export const STATUS_WORDS: Record<JobStatus, string> = {
  uploaded: "File received",
  checking: "Checking the file",
  checked: "Checked, ready to import",
  queued: "Waiting to start",
  running: "Working",
  done: "Done",
  failed: "Stopped with a problem",
  cancelled: "Cancelled",
  expired: "Files removed",
};

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

export const SEVERITIES = ["error", "warning", "info"] as const;
export type Severity = (typeof SEVERITIES)[number];

/** One finding: a stable code, how serious, the column it is about (a header name) and a plain sentence. Never a quoted cell. */
export type Finding = { severity: Severity; code: FindingCode; column?: string; text: string };

/** What a sentence may be filled with: names and numbers, never a cell. */
export type FindingParams = {
  column?: string;
  handle?: string;
  sku?: string;
  /** A number the sentence names (a limit, a count). */
  n?: number;
  max?: number;
  /** A named thing: a market code, a locale, a currency, a format. */
  name?: string;
  /** The editor's own sentence (for `save.failed` and `product.drafted`): written by the editor from its rules, never from a cell. */
  reason?: string;
  /**
   * A redirect's address (wave 2, D168): ALWAYS in the normal form `normaliseSource()`/`normaliseTarget()` give (a path on the store, in lower case), never a
   * cell as typed. A sentence of a redirect finding may name an address and no other cell.
   */
  address?: string;
  /** More addresses (the hops of a chain, the lines of a loop), in the same normal form; a sentence names at most five. */
  addresses?: readonly string[];
  /** The accepted names of a file's columns (for `file.not_redirects`). */
  names?: readonly string[];
};

type FindingRule = { severity: Severity; sentence: (p: FindingParams) => string };

const col = (p: FindingParams) => (p.column ? `the "${p.column}" column` : "a column");
const prod = (p: FindingParams) => (p.handle ? `"${p.handle}"` : "this product");
const addr = (p: FindingParams) => (p.address ? `"${p.address}"` : "this address");
/** Up to five addresses, in a row: `"/a", "/b" and "/c"` (a longer chain is cut with its length). */
const addrs = (p: FindingParams) => {
  const all = p.addresses ?? [];
  const shown = all.slice(0, 5).map((a) => `"${a}"`);
  const more = all.length > 5 ? ` and ${all.length - 5} more` : "";
  return shown.length === 0 ? "other redirects" : shown.length === 1 ? `${shown[0]}${more}` : `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]}${more}`;
};

/**
 * Every finding an import can make (4.4). The severity here is the default; `finding()` may be given another where the spec says so
 * (`delivery.not_importable` is a warning for Shopify's "does not require shipping"). A test asserts that every code has a case.
 */
export const FINDINGS = {
  "file.too_large": { severity: "error", sentence: (p) => `The file is larger than ${p.max ?? 15} MB. Split it into smaller files.` },
  "file.too_many_rows": {
    severity: "error",
    sentence: (p) => `The file has ${p.n ?? 0} rows and an import takes at most ${p.max ?? 60000}. Split it into smaller files.`,
  },
  "file.too_many_products": {
    severity: "error",
    sentence: (p) => `The file has ${p.n ?? 0} products and an import takes at most ${p.max ?? 5000}. Split it into smaller files.`,
  },
  "file.empty": { severity: "error", sentence: () => "The file is empty." },
  "file.no_header": { severity: "error", sentence: () => "The file has no header row with column names." },
  "file.unknown_format": {
    severity: "error",
    sentence: () => "This is not a product file we know. Use a file exported from Kaizen, or Shopify's product export.",
  },
  "file.encoding_assumed": {
    severity: "warning",
    sentence: () => "The file is not UTF-8, so it was read as Windows-1252 (what Excel's plain CSV saves). Check that æ, ø and å look right.",
  },
  "file.delimiter": { severity: "info", sentence: (p) => `The columns are separated by ${p.name ?? "a comma"}.` },
  "file.ragged_row": { severity: "warning", sentence: () => "This row has a different number of cells than the header. Missing cells are read as empty and extra cells are ignored." },
  "price_basis.mismatch": {
    severity: "error",
    sentence: () => "The prices in this file are with VAT or without it in a way that differs from how the store enters prices. Export again from this store, or fix the price_basis column.",
  },
  "price_basis.required": {
    severity: "error",
    sentence: () => "Say whether the prices in this Shopify file include VAT. Kaizen stores prices with VAT, so it cannot guess.",
  },
  "row.handle_missing": { severity: "error", sentence: () => "This row has no handle, and it is not a picture row of a product above it." },
  "row.handle_invalid": {
    severity: "error",
    sentence: (p) => `${prod(p)} is not a valid handle. Use lowercase letters, digits and single hyphens, at most 80 characters.`,
  },
  "handle.duplicate_in_file": { severity: "error", sentence: (p) => `The handle ${prod(p)} appears again further down, apart from its first rows. Keep each product's rows together.` },
  "handle.mismatch": {
    severity: "error",
    sentence: (p) => `The variant in ${col(p)} belongs to a product with another handle than ${prod(p)}. An import never changes a product's web address.`,
  },
  "sku.missing": { severity: "error", sentence: (p) => `A variant of ${prod(p)} has no SKU. Every variant needs one.` },
  "sku.duplicate_in_file": { severity: "error", sentence: (p) => `The SKU "${p.sku ?? ""}" is used twice in the file.` },
  "sku.in_other_product": {
    severity: "error",
    sentence: (p) => `The SKU "${p.sku ?? ""}" already belongs to another product of the store, so ${prod(p)} was left as it was.`,
  },
  "variant.unknown_id": { severity: "error", sentence: (p) => `A variant id in the file is not a variant of ${prod(p)}.` },
  "options.mismatch": { severity: "error", sentence: (p) => `The option names of ${prod(p)} differ between its rows. Every row of a product needs the same option names.` },
  "options.too_many": { severity: "error", sentence: (p) => `${prod(p)} has more than ${p.max ?? 3} options or ${p.max ?? 100} variants, which is the most a product can have.` },
  "price.unreadable": { severity: "error", sentence: (p) => `A price in ${col(p)} of ${prod(p)} is not an amount in the market's currency.` },
  "price.market_unknown": { severity: "info", sentence: (p) => `${col(p)} is for a market this store does not sell to${p.name ? ` (${p.name})` : ""}, so it was left out.` },
  "price.negative": { severity: "error", sentence: (p) => `A price in ${col(p)} of ${prod(p)} would be below 0.` },
  "cost.unreadable": { severity: "error", sentence: (p) => `A cost of ${prod(p)} is not an amount in the store's main currency.` },
  "stock.invalid": { severity: "error", sentence: (p) => `A stock figure of ${prod(p)} is not a whole number from 0 to 1,000,000.` },
  "gtin.invalid": { severity: "error", sentence: (p) => `A barcode of ${prod(p)} is not 8 to 14 digits.` },
  "hs_code.invalid": { severity: "error", sentence: (p) => `A customs (HS) code of ${prod(p)} is not 6 to 10 digits.` },
  "origin.invalid": { severity: "error", sentence: (p) => `A country of origin of ${prod(p)} is not a two-letter country code.` },
  "measure.invalid": { severity: "error", sentence: (p) => `The content for the unit price of ${prod(p)} is not a number with a unit the store can use.` },
  "weight.invalid": { severity: "error", sentence: (p) => `The weight of ${prod(p)} is not a whole number of grams above 0.` },
  "delivery.not_importable": {
    severity: "warning",
    sentence: (p) => `${prod(p)} is read as a shipped product: a product that needs no shipping, or is a download, is set up in the editor.`,
  },
  "kind.not_importable": {
    severity: "error",
    sentence: (p) => `${prod(p)} is an appointment, stay or rental, which needs its staff or rooms: create it in the editor. An existing one can be updated here in its plain columns.`,
  },
  "status.unknown": { severity: "error", sentence: (p) => `The status of ${prod(p)} is not draft, active or archived.` },
  "status.draft_because_unpublished": { severity: "warning", sentence: (p) => `${prod(p)} was not published in the file, so it is saved as a draft.` },
  "product.drafted": {
    severity: "warning",
    sentence: (p) => `${prod(p)} cannot be published yet${p.reason ? `: ${p.reason}` : ""}. It is saved as a draft.`,
  },
  "value.cleared": { severity: "warning", sentence: (p) => `${col(p)} is empty for ${prod(p)}, so the value is cleared.` },
  "media.too_many": { severity: "error", sentence: (p) => `${prod(p)} has more than ${p.max ?? 12} pictures, which is the most a product can have here.` },
  "media.address_invalid": { severity: "error", sentence: (p) => `A picture address of ${prod(p)} is not a valid web address.` },
  "media.fetch_failed": { severity: "warning", sentence: (p) => `A picture of ${prod(p)} could not be fetched and was left out.` },
  "term.created": { severity: "info", sentence: (p) => `${p.n ?? 1} new categories or tags will be created.` },
  "field.unknown": { severity: "info", sentence: (p) => `${col(p)} is not a custom field of this store, so it was left out.` },
  "field.ambiguous": { severity: "error", sentence: (p) => `${col(p)} names more than one custom field of this store. Rename one of them.` },
  "field.invalid": { severity: "error", sentence: (p) => `A value in ${col(p)} of ${prod(p)} is not valid for that field${p.reason ? `: ${p.reason}` : ""}.` },
  "column.ignored": { severity: "info", sentence: (p) => `${col(p)} was left out${p.reason ? `: ${p.reason}` : ""}.` },
  "giftcard.not_supported": { severity: "error", sentence: (p) => `${prod(p)} is a gift card, which Kaizen does not import.` },
  "inventory.continue_selling_ignored": {
    severity: "warning",
    sentence: () => "Continue selling when out of stock is not imported: backorders are not available yet, so a product at 0 stops selling.",
  },
  "tax.ignored": {
    severity: "warning",
    sentence: (p) => `Charge tax or a tax code was in the file for ${prod(p)}. It keeps its VAT category, and an import never sets the exempt category.`,
  },
  "compare_at.ignored": {
    severity: "info",
    sentence: () => "Compare-at prices are never imported: Kaizen shows a reduction only against the lowest price of the last 30 days, from its own price history.",
  },
  "product.exists": { severity: "info", sentence: (p) => `${prod(p)} already exists, and this import only creates new products, so it was left as it is.` },
  "product.missing": { severity: "info", sentence: (p) => `${prod(p)} does not exist, and this import only updates existing products, so it was skipped.` },
  "product.not_published": {
    severity: "error",
    sentence: (p) => `${prod(p)} cannot be published yet${p.reason ? `: ${p.reason}` : ""}, so it was skipped.`,
  },
  "vat_category.unknown": { severity: "error", sentence: (p) => `The VAT category of ${prod(p)} is not one of the store's categories.` },
  "active.invalid": { severity: "error", sentence: (p) => `The active column of ${prod(p)} is not true or false.` },
  "save.failed": { severity: "error", sentence: (p) => `${prod(p)} could not be saved${p.reason ? `: ${p.reason}` : ""}.` },

  // Redirect files (wave 2, second run, D168, docs/wave-2-redirects.md 4.4): a line is a redirect from an address to an address.
  "file.not_redirects": {
    severity: "error",
    sentence: (p) => `This is not a redirect file we know. The first row must name a column for the old address and one for the new, such as ${(p.names ?? ["Redirect from", "Redirect to"]).map((n) => `"${n}"`).join(" and ")}.`,
  },
  "source.missing": { severity: "error", sentence: () => "The line has no old address (Redirect from), so it was skipped." },
  "source.invalid": {
    severity: "error",
    sentence: () => "The old address could not be read: it has a space, a control character or an invalid % code, or it is longer than 500 characters or has more than 12 parts.",
  },
  "source.external": { severity: "error", sentence: () => "The old address is on another website. Only addresses on this store can be redirected." },
  "source.market_prefix": {
    severity: "error",
    sentence: (p) => `The old address${p.address ? ` ${addr(p)}` : ""} begins with a country. Leave the country out: a redirect applies in every country and language.`,
  },
  "source.reserved": { severity: "error", sentence: (p) => `${addr(p)} is a page the store itself uses (the cart, checkout, account and so on), so it cannot be redirected.` },
  "source.live": { severity: "error", sentence: (p) => `${addr(p)} is a live page, product, category, tag or article now. Redirect only from an address that does not exist.` },
  "source.root": { severity: "error", sentence: () => "The front page cannot be redirected." },
  "source.query_dropped": { severity: "info", sentence: () => "The old address had a query string (after ?), which a redirect does not match on, so it was left out." },
  "target.missing": { severity: "error", sentence: (p) => `${p.address ? `The line from ${addr(p)}` : "The line"} has no new address (Redirect to), so it was skipped.` },
  "target.invalid": {
    severity: "error",
    sentence: () => "The new address could not be read: it must be a path on this store, or a full https address of this store, without a space, a control character or a password.",
  },
  "target.external": {
    severity: "error",
    sentence: () => "The new address is on another website. A redirect can only go to a page on this store.",
  },
  "target.market_removed": { severity: "info", sentence: () => "The country was removed from the new address: a redirect keeps the shopper's own country and language." },
  "target.self": { severity: "error", sentence: (p) => `${addr(p)} would redirect to itself.` },
  "target.loop": { severity: "error", sentence: (p) => `${addr(p)} would close a loop through ${addrs(p)}, so the shopper would never arrive.` },
  "target.chain": {
    severity: "warning",
    sentence: (p) => `The new address is itself redirected (through ${addrs(p)}), so the final destination is saved instead.`,
  },
  "target.not_found": { severity: "warning", sentence: (p) => `${addr(p)} is not a page on this store now. The redirect still works, and sends shoppers to the store's not-found page until it exists.` },
  "duplicate.in_file": { severity: "error", sentence: (p) => `${addr(p)} appears again further up, and the first line wins.` },
  "exists.update": { severity: "info", sentence: (p) => `A redirect from ${addr(p)} exists, and its new address is replaced.` },
  "exists.same": { severity: "info", sentence: (p) => `The redirect from ${addr(p)} is already there as it is.` },
  "exists.skipped": { severity: "info", sentence: (p) => `A redirect from ${addr(p)} exists, and the import was told to keep it, so the line was skipped.` },
  "exists.replaced_automatic": { severity: "info", sentence: (p) => `Kaizen made a redirect from ${addr(p)} when an address changed. This line replaces it.` },
  "limit.reached": { severity: "error", sentence: (p) => `The store would have more than ${p.max ?? 100000} redirects of its own, which is the most it can have. Delete some or import fewer.` },
} as const satisfies Record<string, FindingRule>;

export type FindingCode = keyof typeof FINDINGS;
export const FINDING_CODES = Object.keys(FINDINGS) as FindingCode[];

/** A finding from its code, with the sentence written from names and numbers only. `severity` overrides the default. */
export function finding(code: FindingCode, params: FindingParams = {}, severity?: Severity): Finding {
  const rule: FindingRule = FINDINGS[code];
  return {
    severity: severity ?? rule.severity,
    code,
    ...(params.column ? { column: params.column } : {}),
    text: rule.sentence(params),
  };
}

/** The worst severity of some findings; null for none. */
export function worstOf(findings: readonly Finding[]): Severity | null {
  for (const s of SEVERITIES) if (findings.some((f) => f.severity === s)) return s;
  return null;
}

// ---------------------------------------------------------------------------
// Items and counts
// ---------------------------------------------------------------------------

export const ITEM_OUTCOMES = ["created", "updated", "unchanged", "skipped", "drafted", "failed", "checked"] as const;
export type ItemOutcome = (typeof ITEM_OUTCOMES)[number];

/** What a job's items add up to: the `counts` of the job (an item's outcome by name, and the warnings among all messages). */
export type JobCounts = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  drafted: number;
  failed: number;
  warnings: number;
  errors: number;
  pricesChanged: number;
  picturesFetched: number;
  termsCreated: number;
};

export const EMPTY_COUNTS: JobCounts = {
  created: 0,
  updated: 0,
  unchanged: 0,
  skipped: 0,
  drafted: 0,
  failed: 0,
  warnings: 0,
  errors: 0,
  pricesChanged: 0,
  picturesFetched: 0,
  termsCreated: 0,
};

export type ItemSummary = {
  outcome: ItemOutcome;
  messages: readonly Pick<Finding, "severity">[];
  changes?: { prices?: number; pictures?: number; terms?: number };
};

/**
 * The counts of a set of items. The dry run's `checked` outcome is not a count of its own: an item of a dry run says what an
 * apply WOULD do through its `changes` and is counted by `predictCounts()`.
 */
export function summariseCounts(items: readonly ItemSummary[]): JobCounts {
  const counts: JobCounts = { ...EMPTY_COUNTS };
  for (const item of items) {
    if (item.outcome !== "checked") counts[item.outcome] += 1;
    for (const m of item.messages) {
      if (m.severity === "warning") counts.warnings += 1;
      if (m.severity === "error") counts.errors += 1;
    }
    counts.pricesChanged += item.changes?.prices ?? 0;
    counts.picturesFetched += item.changes?.pictures ?? 0;
    counts.termsCreated += item.changes?.terms ?? 0;
  }
  return counts;
}

/** What a finished dry run tells the member before they apply: what would be created, updated, left alone, and what has problems. */
export type DryRunCounts = { toCreate: number; toUpdate: number; unchanged: number; withProblems: number };

/** The step an apply continues from: the product index in the plan (items are written in the plan's order, one per product). */
export type ImportCursor = { next: number };
export const startCursor = (): ImportCursor => ({ next: 0 });

/** Progress as a whole percent, never above 99 until the job is done. */
export function progressPercent(done: number | null, total: number | null, status: JobStatus): number {
  if (status === "done") return 100;
  if (!total || done === null) return 0;
  return Math.min(99, Math.floor((done / total) * 100));
}
