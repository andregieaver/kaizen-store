/**
 * Stock levels, their history and the rules a person's change of them must keep (wave 3, D172, `docs/wave-3-inventory.md` 4.2).
 * Pure: no database and nothing server-only, so the browser checks a save with the same rules as the server (`adjustInput`).
 *
 * Every change of `inventory_levels.on_hand` is a row of `commerce.inventory_movements`; this file is the one list of the
 * reasons and sources such a row may have (the table's checks are built from these lists, and a PGlite test holds the two
 * together), the limits of 4.2, and the checks of a typed figure. All quantities are whole numbers: nothing here rounds.
 */

import { z } from "zod";

// ---------------------------------------------------------------------------
// Limits (spec 4.2)
// ---------------------------------------------------------------------------

/** The most a person can set on hand, and the most a figure may be adjusted by (up or down). */
export const STOCK_MAX = 1_000_000;
/** Adjust rows in one save of the Inventory page. */
export const ADJUST_ROWS_MAX = 500;
/** A note on a manual change. */
export const NOTE_MAX = 200;
/** A store's locations, active or not (a location is never deleted). */
export const LOCATIONS_MAX = 20;
/** A location's name. */
export const LOCATION_NAME_MAX = 60;
/** Rows in a stock file. */
export const INVENTORY_FILE_ROWS_MAX = 20_000;
/** The days a backorder may state (spec 3.1): always stated, never blank. */
export const BACKORDER_DAYS_MIN = 1;
export const BACKORDER_DAYS_MAX = 90;
/** Unless a longer time is agreed, delivery is within this many days of the order (Directive 2011/83/EU Art. 18, forbrukerkjøpsloven § 6): the editor says so. */
export const BACKORDER_DAYS_AGREED = 30;
/**
 * The days of transport the editor assumes after dispatch when it compares the days a store states ("ships within") with the 30 above: the
 * limit counts until the goods are DELIVERED, so a figure close to 30 can pass it once the parcel is on its way. A stated assumption, not a
 * rule of law, listed for the lawyer in `docs/wave-3-inventory.md` section 8.
 */
export const BACKORDER_TRANSIT_DAYS = 7;
/** Whether days to ship, with the usual transport on top, can pass the 30 days that apply unless the customer agrees to a longer time. */
export const backorderMayPassAgreed = (days: number | null | undefined): boolean => typeof days === "number" && days + BACKORDER_TRANSIT_DAYS > BACKORDER_DAYS_AGREED;
/** The low-stock level's range. */
export const THRESHOLD_MAX = STOCK_MAX;
/** How long the history is kept, in months (the audit log's length, D158); a test holds it equal to the SQL guard's. */
export const INVENTORY_RETENTION_MONTHS = 24;
/** Rows of the history page, and of the Inventory page. */
export const HISTORY_PAGE_SIZE = 50;
export const INVENTORY_PAGE_SIZE = 50;
/** Lines of the low-stock email before "and {n} more". */
export const LOW_STOCK_EMAIL_LINES = 50;

// ---------------------------------------------------------------------------
// Reasons and sources
// ---------------------------------------------------------------------------

/**
 * The reasons a person can give for a manual change, in the order the page offers them. `count` is Shopify's "Count" (a counted
 * figure set as it is); the default is `correction`.
 */
export const ADJUST_REASONS = ["received", "correction", "count", "damaged", "lost", "promotion"] as const;
export type AdjustReason = (typeof ADJUST_REASONS)[number];
export const DEFAULT_ADJUST_REASON: AdjustReason = "correction";

/** Every reason a movement can carry: the manual ones and what the system writes. */
export const MOVEMENT_REASONS = [...ADJUST_REASONS, "sale", "order_restock", "return_restock", "opening", "system"] as const;
export type MovementReason = (typeof MOVEMENT_REASONS)[number];

/** Where a change came from. `checkout` and `copy` and `system` are the system's; the rest are a person's or a job's. */
export const MOVEMENT_SOURCES = ["inventory_page", "editor", "bulk", "file", "order", "return", "checkout", "ai_manager", "copy", "system"] as const;
export type MovementSource = (typeof MOVEMENT_SOURCES)[number];

export const isAdjustReason = (value: unknown): value is AdjustReason => typeof value === "string" && (ADJUST_REASONS as readonly string[]).includes(value);
export const isMovementReason = (value: unknown): value is MovementReason => typeof value === "string" && (MOVEMENT_REASONS as readonly string[]).includes(value);
export const isMovementSource = (value: unknown): value is MovementSource => typeof value === "string" && (MOVEMENT_SOURCES as readonly string[]).includes(value);

/**
 * The why of a change of a level, as `commerce.stock_context(reason, source, account, order, return, job, note)` takes it. The server's
 * `withStockContext(tx, context)` sets it for a transaction; a write of a level with none is recorded as `opening`/`system` (insert) or
 * `correction`/`system` (update). The note is typed by staff on a manual change only and is cut at `NOTE_MAX`.
 */
export type StockContext = {
  reason: MovementReason;
  source: MovementSource;
  accountId?: string | null;
  orderId?: string | null;
  returnId?: string | null;
  jobId?: string | null;
  note?: string | null;
};

/** The arguments of `commerce.stock_context()` in order, with the note trimmed and cut: what the server binds. */
export function stockContextArgs(context: StockContext): [string, string, string | null, string | null, string | null, string | null, string | null] {
  const note = context.note?.trim() ?? "";
  return [
    context.reason,
    context.source,
    context.accountId ?? null,
    context.orderId ?? null,
    context.returnId ?? null,
    context.jobId ?? null,
    note === "" ? null : note.slice(0, NOTE_MAX),
  ];
}

/** The words of the page (the admin is English only). */
export const REASON_WORDS: Record<MovementReason, string> = {
  received: "Received",
  correction: "Correction",
  count: "Count",
  damaged: "Damaged",
  lost: "Theft or loss",
  promotion: "Promotion or donation",
  sale: "Sale",
  order_restock: "Put back after an order",
  return_restock: "Return put back",
  opening: "Opening figure",
  system: "System",
};

export const reasonWord = (reason: string): string => (isMovementReason(reason) ? REASON_WORDS[reason] : "Other");

/** Who or what made a change, as the history shows it: a staff member's name, "Order {number}", "Return {number}", "Checkout", "File import", "AI manager", "System". */
export function byWords(movement: {
  source: string;
  actorName?: string | null;
  orderNumber?: string | null;
  returnNumber?: string | null;
}): string {
  // A return's restock goes through the refund of its order; name the return when there is one, else the order.
  if (movement.returnNumber) return `Return ${movement.returnNumber}`;
  if (movement.orderNumber) return `Order ${movement.orderNumber}`;
  switch (movement.source) {
    case "checkout":
      return "Checkout";
    case "file":
      return movement.actorName ? `File import (${movement.actorName})` : "File import";
    case "ai_manager":
      return "AI manager";
    case "copy":
      return "Store copy";
    case "system":
      return "System";
    default:
      return movement.actorName?.trim() ? movement.actorName.trim() : "A staff member";
  }
}

// ---------------------------------------------------------------------------
// A person's change of a figure
// ---------------------------------------------------------------------------

export const ADJUST_MODES = ["set", "adjust"] as const;
export type AdjustMode = (typeof ADJUST_MODES)[number];

export type AdjustProblem = "not_whole" | "too_high" | "too_low" | "negative" | "adjust_range";

/**
 * What a typed figure makes of the current one. `set` is the counted figure; `adjust` is a signed change. The result must be a
 * whole number from 0 to `STOCK_MAX`: a person never takes a level below zero (only a sale of a variant that keeps selling on
 * backorder does). `delta` is the change from the current figure; the server works it out under the row lock.
 */
export function resultOf(mode: AdjustMode, value: number, current: number): { ok: true; next: number; delta: number } | { ok: false; problem: AdjustProblem } {
  if (!Number.isInteger(value) || !Number.isInteger(current)) return { ok: false, problem: "not_whole" };
  if (mode === "set") {
    if (value < 0) return { ok: false, problem: "negative" };
    if (value > STOCK_MAX) return { ok: false, problem: "too_high" };
    return { ok: true, next: value, delta: value - current };
  }
  if (Math.abs(value) > STOCK_MAX) return { ok: false, problem: "adjust_range" };
  const next = current + value;
  if (next < 0) return { ok: false, problem: "too_low" };
  if (next > STOCK_MAX) return { ok: false, problem: "too_high" };
  return { ok: true, next, delta: value };
}

export const ADJUST_PROBLEM_WORDS: Record<AdjustProblem, string> = {
  not_whole: "Use a whole number.",
  too_high: `A level cannot be more than ${STOCK_MAX.toLocaleString("en")}.`,
  too_low: "That would take the stock below 0. Count what is there and set it instead.",
  negative: "Stock cannot be below 0. Stock goes below 0 only when a variant that keeps selling on backorder is sold.",
  adjust_range: `Adjust by at most ${STOCK_MAX.toLocaleString("en")}.`,
};

const stockFigure = z.number().int("Use a whole number.").min(-STOCK_MAX).max(STOCK_MAX);

const noteText = z
  .string()
  .trim()
  .max(NOTE_MAX, `A note is at most ${NOTE_MAX} characters.`)
  .nullable()
  .default(null)
  .transform((v) => (v === "" ? null : v));

/** One row of the Inventory page's save: the figure typed (`set` or `adjust`) and the figure the row was loaded with. */
export const adjustRow = z
  .object({
    variantId: z.uuid(),
    locationId: z.uuid(),
    mode: z.enum(ADJUST_MODES),
    value: stockFigure,
    /** The figure the row was loaded with: a different stored figure at save time makes the row a conflict. */
    was: z.number().int().min(-STOCK_MAX).max(STOCK_MAX),
  })
  .refine((r) => r.mode !== "set" || (r.value >= 0 && r.value <= STOCK_MAX), { message: ADJUST_PROBLEM_WORDS.negative, path: ["value"] });
export type AdjustRow = z.infer<typeof adjustRow>;

/** The whole save: a reason for it, an optional note, and up to 500 rows (no row twice). */
export const adjustInput = z
  .object({
    reason: z.enum(ADJUST_REASONS).default(DEFAULT_ADJUST_REASON),
    note: noteText,
    rows: z.array(adjustRow).min(1, "Change at least one figure.").max(ADJUST_ROWS_MAX, `Save at most ${ADJUST_ROWS_MAX} rows at a time.`),
  })
  .refine((v) => new Set(v.rows.map((r) => `${r.variantId}:${r.locationId}`)).size === v.rows.length, {
    message: "A figure is changed twice in one save.",
    path: ["rows"],
  });
export type AdjustInput = z.infer<typeof adjustInput>;
export type AdjustInputValue = z.input<typeof adjustInput>;

/** What each row of a save came to. `conflict`: the stored figure was not the one the row was loaded with. */
export type AdjustOutcome = "written" | "unchanged" | "conflict" | "refused" | "failed";

// ---------------------------------------------------------------------------
// Policy (backorder) and the low-stock level
// ---------------------------------------------------------------------------

export const STOCK_POLICIES = ["deny", "continue"] as const;
export type StockPolicy = (typeof STOCK_POLICIES)[number];
export const isStockPolicy = (value: unknown): value is StockPolicy => value === "deny" || value === "continue";

export const POLICY_WORDS: Record<StockPolicy, string> = { deny: "Stop selling at zero", continue: "Keep selling" };
export const policyWords = (policy: StockPolicy, days: number | null): string =>
  policy === "continue" && days ? `Keep selling: ${days} ${days === 1 ? "day" : "days"}` : POLICY_WORDS[policy];

/** Shown under "Expected to ship within" in the product editor. States a rule: needs human legal review. */
export const BACKORDER_LONG_HINT =
  "The 30 days run until the goods are delivered, not until they are shipped. If shipping and transport can take it past 30 days, the customer agrees to a longer time by ordering. Say it clearly.";

export type PolicyInput = { stockPolicy: StockPolicy; backorderDays: number | null; lowStockThreshold?: number | null };

/**
 * The same three rules the database holds for a variant (`product_variants` checks): goods only for `continue`, the days required
 * with it (1 to 90) and absent without it, and the warning level 0 to 1,000,000 for goods only. Returns a sentence or null.
 */
export function policyProblem(input: PolicyInput, delivery: "physical" | "digital" | "service" = "physical"): string | null {
  if (input.stockPolicy === "continue") {
    if (delivery !== "physical") return "Only goods that are shipped can keep selling at zero stock.";
    const days = input.backorderDays;
    if (days === null || !Number.isInteger(days)) return `Say within how many days a backordered item is expected to ship (${BACKORDER_DAYS_MIN} to ${BACKORDER_DAYS_MAX}).`;
    if (days < BACKORDER_DAYS_MIN || days > BACKORDER_DAYS_MAX) return `The delivery time is ${BACKORDER_DAYS_MIN} to ${BACKORDER_DAYS_MAX} days.`;
  } else if (input.backorderDays !== null) {
    return "A delivery time belongs only to a variant that keeps selling at zero stock.";
  }
  const level = input.lowStockThreshold ?? null;
  if (level !== null) {
    if (delivery !== "physical") return "Only goods that are shipped have a low-stock level.";
    if (!Number.isInteger(level) || level < 0 || level > THRESHOLD_MAX) return `The low-stock level is a whole number from 0 to ${THRESHOLD_MAX.toLocaleString("en")}.`;
  }
  return null;
}

/** The product editor's and the bulk action's fields of a variant, shared with the browser (`productInput` widens with these). */
export const stockPolicyFields = {
  stockPolicy: z.enum(STOCK_POLICIES).default("deny"),
  backorderDays: z.number().int().min(BACKORDER_DAYS_MIN).max(BACKORDER_DAYS_MAX).nullable().default(null),
  lowStockThreshold: z.number().int().min(0).max(THRESHOLD_MAX).nullable().default(null),
};

/** A bulk change from the Inventory page: the selected rows' policy, or their warning level. */
export const bulkPolicyInput = z
  .object({
    variantIds: z.array(z.uuid()).min(1).max(ADJUST_ROWS_MAX),
    change: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("continue"), backorderDays: z.number().int().min(BACKORDER_DAYS_MIN).max(BACKORDER_DAYS_MAX) }),
      z.object({ kind: z.literal("deny") }),
      z.object({ kind: z.literal("threshold"), lowStockThreshold: z.number().int().min(0).max(THRESHOLD_MAX).nullable() }),
    ]),
  })
  .refine((v) => new Set(v.variantIds).size === v.variantIds.length, { message: "A variant is chosen twice.", path: ["variantIds"] });
export type BulkPolicyInput = z.infer<typeof bulkPolicyInput>;

// ---------------------------------------------------------------------------
// Locations (spec 2.3)
// ---------------------------------------------------------------------------

export const locationInput = z.object({
  name: z.string().trim().min(1, "Give the location a name.").max(LOCATION_NAME_MAX, `A name is at most ${LOCATION_NAME_MAX} characters.`),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Choose a country."),
});
export type LocationInput = z.infer<typeof locationInput>;

/** The rank key: `priority`, then `created_at`, then `id` (spec 1.3). Every reader of "the first location" uses this order. */
export type Rankable = { id: string; priority: number; createdAt: string | number | Date };
const time = (v: string | number | Date): number => (v instanceof Date ? v.getTime() : typeof v === "number" ? v : Date.parse(v));
export function compareRank(a: Rankable, b: Rankable): number {
  if (a.priority !== b.priority) return a.priority - b.priority;
  const t = time(a.createdAt) - time(b.createdAt);
  if (t !== 0 && !Number.isNaN(t)) return t;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}
/** The locations in rank order (a new array). */
export const inRankOrder = <T extends Rankable>(locations: readonly T[]): T[] => [...locations].sort(compareRank);

/** After a move up or down: the ids in their new order, which the server writes as priority 1..n in one transaction. Moving past an end changes nothing. */
export function moveInRank(ids: readonly string[], id: string, direction: "up" | "down"): string[] {
  const at = ids.indexOf(id);
  if (at < 0) return [...ids];
  const to = direction === "up" ? at - 1 : at + 1;
  if (to < 0 || to >= ids.length) return [...ids];
  const next = [...ids];
  [next[at], next[to]] = [next[to], next[at]];
  return next;
}

/** The sentence the deactivate dialog and the notice after it say (spec 2.3). */
export function deactivationWords(impact: { units: number; variants: number; committedUnits: number }): { refusal: string | null; notice: string } {
  const units = impact.units.toLocaleString("en");
  return {
    refusal:
      impact.committedUnits > 0
        ? `${impact.committedUnits} ${impact.committedUnits === 1 ? "unit is" : "units are"} held by checkouts in progress; try again in a few minutes.`
        : null,
    notice: `${units} ${impact.units === 1 ? "unit" : "units"} across ${impact.variants} ${impact.variants === 1 ? "variant is" : "variants are"} no longer for sale; reactivate the location to sell them again.`,
  };
}
