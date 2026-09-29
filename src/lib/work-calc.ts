import { minorUnitDigits } from "./money";
import { parsePrice } from "./product-input";
import type { VatLineCategory } from "./work-vat";

/**
 * Work (docs/work.md 4.3): the money and hours arithmetic of invoices, exact
 * and without floating point, so an invoice can be checked by hand and the
 * browser (live totals), the server and the database's issue check agree to
 * the minor unit.
 *
 * Units: money is integer minor units, hours are integer minutes, and an
 * invoice line's quantity is integer hundredths of an hour (or of a unit), so
 * 1.75 h is 175. A percentage or VAT rate is basis points (25 % is 2500).
 * Products of these can pass 2^53, so the maths is done in BigInt and only
 * the results, checked to be safe integers, come back as numbers.
 *
 * Ported from Life's `invoice-calc.ts` and `billing.ts`, which used floats
 * rounded to two decimals; the rounding rule is the same (half up, per line),
 * only exact.
 */

/** The largest quantity on a line: 100 000.00 hours. */
export const MAX_QUANTITY_HUNDREDTHS = 10_000_000;
/** The largest unit price on a line: 10 000 000.00 in the invoice's currency. */
export const MAX_UNIT_PRICE_MINOR = 1_000_000_000;
export const MAX_DISCOUNT_BP = 10_000;
export const MAX_VAT_BP = 10_000;

/**
 * What a line is called until somebody names it. Stored as this literal (not
 * a translation) so the editor can recognise an unnamed line whatever
 * language the person reads in, and show it as an empty field.
 */
export const UNNAMED_LINE = "Line item";

/** A line's description as it is stored: trimmed, and never empty. */
export function lineDescription(text: string | null | undefined): string {
  const trimmed = (text ?? "").trim();
  return trimmed === "" ? UNNAMED_LINE : trimmed;
}

/** What the editor shows in the field: an unnamed line reads as empty. */
export const isUnnamedLine = (description: string) => description.trim() === UNNAMED_LINE;

// --- Exact integer helpers ---------------------------------------------------

function assertInt(value: number, min: number, max: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(`${name} must be a whole number from ${min} to ${max}: ${value}`);
  }
}

/** n / d rounded to the nearest whole number, halves away from zero (up, for the non-negative amounts here). */
export function divideRounded(n: bigint, d: bigint): bigint {
  if (d <= BigInt(0)) throw new RangeError("Divisor must be positive");
  const negative = n < BigInt(0);
  const a = negative ? -n : n;
  const q = (BigInt(2) * a + d) / (BigInt(2) * d);
  return negative ? -q : q;
}

function toSafeNumber(value: bigint, name: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError(`${name} is too large to count exactly`);
  }
  return Number(value);
}

/** A sum of minor-unit amounts, exact, and refused rather than wrong if it would not fit a safe integer. */
export function sumMinor(values: readonly number[]): number {
  let total = BigInt(0);
  for (const v of values) {
    assertInt(v, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Amount");
    total += BigInt(v);
  }
  return toSafeNumber(total, "Sum");
}

// --- Hours and minutes -------------------------------------------------------

/**
 * Minutes as hundredths of an hour, rounded half up: 20 min is 0.33 h (33),
 * 1 min is 0.02 h. Life's rule (`round(minutes / 60, 2)`), now exact. State
 * it on the invoice screen: hours are rounded to two decimals.
 */
export function minutesToHundredths(minutes: number): number {
  assertInt(minutes, 0, Math.floor(Number.MAX_SAFE_INTEGER / 100) - 1, "Minutes");
  return Math.floor((minutes * 100 + 30) / 60);
}

/** Hundredths of an hour as minutes, rounded half up (0.33 h is 20 min). */
export function hundredthsToMinutes(hundredths: number): number {
  assertInt(hundredths, 0, Math.floor(Number.MAX_SAFE_INTEGER / 60) - 1, "Hundredths");
  return Math.floor((hundredths * 60 + 50) / 100);
}

/** The periods an invoice's hours can be rounded up to. */
export const ROUND_UP_STEPS_MINUTES = [15, 30, 60] as const;
export type RoundUpStep = (typeof ROUND_UP_STEPS_MINUTES)[number];

/** Minutes rounded UP to the next started period (75 min at 30 is 90). Zero stays zero. */
export function roundUpMinutes(minutes: number, stepMinutes: number): number {
  assertInt(minutes, 0, Number.MAX_SAFE_INTEGER, "Minutes");
  assertInt(stepMinutes, 1, 1440, "Step");
  return Math.ceil(minutes / stepMinutes) * stepMinutes;
}

/**
 * A line's hours (in hundredths) rounded UP to the next started period: 1.02 h
 * at a 15-minute step is 1.25 h, because the second period was started. Exact
 * multiples stay put and zero stays zero. Whole minutes first, so a quantity
 * that is one hour up to rounding is one hour and not one and a quarter. The
 * result is exact in hundredths for every step offered (15 min is 25).
 */
export function roundUpHours(quantityHundredths: number, step: RoundUpStep): number {
  const minutes = hundredthsToMinutes(quantityHundredths);
  return minutesToHundredths(roundUpMinutes(minutes, step));
}

// --- Rates -------------------------------------------------------------------

export type BillingType = "hourly" | "fixed_fee";
export type RateSource = "assignment" | "client" | "none";

/**
 * The hourly rate that applies to an assignment: its own, else the client's
 * default, else none (0, with `source` saying so, so the editor can ask for
 * one). A fixed fee has no hourly rate. An assignment's rate of 0 counts as
 * set (free work is a decision), a missing one falls through.
 */
export function effectiveRate(
  assignment: { billingType: BillingType; hourlyRateMinor: number | null },
  client: { defaultHourlyRateMinor: number | null },
): { rateMinor: number; source: RateSource } {
  if (assignment.billingType !== "hourly") return { rateMinor: 0, source: "none" };
  if (assignment.hourlyRateMinor != null) return { rateMinor: assignment.hourlyRateMinor, source: "assignment" };
  if (client.defaultHourlyRateMinor != null) return { rateMinor: client.defaultHourlyRateMinor, source: "client" };
  return { rateMinor: 0, source: "none" };
}

/**
 * What an assignment's billable time comes to, net: the fixed fee for a fixed
 * fee, else the hours (rounded to hundredths, as an invoice line would) at the
 * rate. The same figure the line gets, so a report and an invoice agree.
 */
export function billableAmountMinor(
  assignment: { billingType: BillingType; hourlyRateMinor: number | null; fixedAmountMinor: number | null },
  client: { defaultHourlyRateMinor: number | null },
  billableMinutes: number,
): number {
  if (assignment.billingType === "fixed_fee") return assignment.fixedAmountMinor ?? 0;
  const { rateMinor } = effectiveRate(assignment, client);
  return timeAmountMinor(billableMinutes, rateMinor);
}

/** Minutes at an hourly rate, net, with the hours rounded to hundredths first as on an invoice line. */
export function timeAmountMinor(minutes: number, rateMinor: number): number {
  return computeLine({
    quantityHundredths: minutesToHundredths(minutes),
    unitPriceMinor: rateMinor,
    discountBp: 0,
    vatBp: 0,
    vatCategory: "standard",
  }).exclMinor;
}

// --- Lines and invoices ------------------------------------------------------

/** What is typed on a line. VAT arrives resolved (`work-vat.ts` `resolveLineVat`), never free text. */
export type LineInput = {
  quantityHundredths: number;
  /** Net, in minor units of the invoice's currency. */
  unitPriceMinor: number;
  discountBp: number;
  vatBp: number;
  /** Only used to group the VAT summary. */
  vatCategory: VatLineCategory;
};

export type LineAmounts = {
  /** Before the discount, rounded: what quantity times price is. */
  grossMinor: number;
  /** gross minus net, for display; never negative. */
  discountMinor: number;
  exclMinor: number;
  vatMinor: number;
  inclMinor: number;
};

/**
 * One line, exactly (4.3), half up, rounded once per amount:
 *
 *   excl = round(qty * price * (10000 - discountBp) / 1 000 000)
 *   vat  = round(excl * vatBp / 10000)      (VAT is rounded per line, as Life did)
 *   incl = excl + vat
 *
 * Out-of-range input throws instead of being clamped as Life did: a wrong
 * number here becomes a wrong tax document, so callers validate first.
 */
export function computeLine(line: LineInput): LineAmounts {
  assertInt(line.quantityHundredths, 0, MAX_QUANTITY_HUNDREDTHS, "Quantity");
  assertInt(line.unitPriceMinor, 0, MAX_UNIT_PRICE_MINOR, "Unit price");
  assertInt(line.discountBp, 0, MAX_DISCOUNT_BP, "Discount");
  assertInt(line.vatBp, 0, MAX_VAT_BP, "VAT rate");
  const product = BigInt(line.quantityHundredths) * BigInt(line.unitPriceMinor);
  const gross = divideRounded(product, BigInt(100));
  const excl = divideRounded(product * BigInt(MAX_DISCOUNT_BP - line.discountBp), BigInt(1_000_000));
  const vat = divideRounded(excl * BigInt(line.vatBp), BigInt(10_000));
  return {
    grossMinor: toSafeNumber(gross, "Line amount"),
    discountMinor: toSafeNumber(gross > excl ? gross - excl : BigInt(0), "Line discount"),
    exclMinor: toSafeNumber(excl, "Line amount"),
    vatMinor: toSafeNumber(vat, "Line VAT"),
    inclMinor: toSafeNumber(excl + vat, "Line amount"),
  };
}

/** The net, VAT and gross of one rate on an invoice: what the document's VAT summary prints. */
export type VatGroup = {
  category: VatLineCategory;
  vatBp: number;
  netMinor: number;
  vatMinor: number;
  grossMinor: number;
};

export type InvoiceTotals = {
  subtotalMinor: number;
  discountMinor: number;
  vatMinor: number;
  totalMinor: number;
  /** Per category and rate, highest rate first; the VAT amounts add up to `vatMinor`. */
  vatGroups: VatGroup[];
};

const CATEGORY_ORDER: Record<VatLineCategory, number> = { standard: 0, exempt: 1, reverse_charge: 2, outside_scope: 3 };

/**
 * An invoice's totals from its lines' amounts: the sums of what each line
 * rounded to (VAT per line, not per total, 4.3), so the document's lines add
 * up to its totals. Throws if a sum would not be a safe integer.
 */
export function totalsOf(lines: readonly (LineAmounts & Pick<LineInput, "vatBp" | "vatCategory">)[]): InvoiceTotals {
  const groups = new Map<string, { category: VatLineCategory; vatBp: number; net: bigint; vat: bigint }>();
  let subtotal = BigInt(0);
  let discount = BigInt(0);
  let vat = BigInt(0);
  for (const l of lines) {
    subtotal += BigInt(l.exclMinor);
    discount += BigInt(l.discountMinor);
    vat += BigInt(l.vatMinor);
    const key = `${l.vatCategory}:${l.vatBp}`;
    const group = groups.get(key) ?? { category: l.vatCategory, vatBp: l.vatBp, net: BigInt(0), vat: BigInt(0) };
    group.net += BigInt(l.exclMinor);
    group.vat += BigInt(l.vatMinor);
    groups.set(key, group);
  }
  const vatGroups = [...groups.values()]
    .sort((a, b) => b.vatBp - a.vatBp || CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category])
    .map((g) => ({
      category: g.category,
      vatBp: g.vatBp,
      netMinor: toSafeNumber(g.net, "Invoice total"),
      vatMinor: toSafeNumber(g.vat, "Invoice total"),
      grossMinor: toSafeNumber(g.net + g.vat, "Invoice total"),
    }));
  return {
    subtotalMinor: toSafeNumber(subtotal, "Invoice total"),
    discountMinor: toSafeNumber(discount, "Invoice total"),
    vatMinor: toSafeNumber(vat, "Invoice total"),
    totalMinor: toSafeNumber(subtotal + vat, "Invoice total"),
    vatGroups,
  };
}

/** Every line's amounts and the invoice's totals: what the editor's live footer and the issue step both call. */
export function computeInvoice(lines: readonly LineInput[]): { lines: LineAmounts[]; totals: InvoiceTotals } {
  const amounts = lines.map(computeLine);
  return {
    lines: amounts,
    totals: totalsOf(amounts.map((a, i) => ({ ...a, vatBp: lines[i].vatBp, vatCategory: lines[i].vatCategory }))),
  };
}

/**
 * Whether stored header totals equal what the lines come to: the check made
 * again in the database at issue, so a document is never issued with figures
 * its own lines do not add up to.
 */
export function totalsMatch(
  header: { subtotalMinor: number; vatMinor: number; totalMinor: number },
  lines: readonly LineInput[],
): boolean {
  const { totals } = computeInvoice(lines);
  return (
    header.subtotalMinor === totals.subtotalMinor &&
    header.vatMinor === totals.vatMinor &&
    header.totalMinor === totals.totalMinor
  );
}

/**
 * The net part of a VAT-inclusive amount, for recurring templates carried over
 * from Life (which kept them inclusive) and for anything typed gross:
 * excl = round(incl * 10000 / (10000 + vatBp)), vat = incl - excl.
 */
export function splitInclAmount(
  inclMinor: number,
  vatBp: number,
): { exclMinor: number; vatMinor: number; inclMinor: number } {
  assertInt(inclMinor, 0, Number.MAX_SAFE_INTEGER, "Amount");
  assertInt(vatBp, 0, MAX_VAT_BP, "VAT rate");
  const excl = toSafeNumber(divideRounded(BigInt(inclMinor) * BigInt(10_000), BigInt(10_000 + vatBp)), "Amount");
  return { exclMinor: excl, vatMinor: inclMinor - excl, inclMinor };
}

/** A rate as a fraction (0.25, as `order_lines.tax_rate` keeps it) as basis points (2500), exactly. */
export function rateToBp(rate: number): number {
  if (!Number.isFinite(rate) || rate < 0 || rate > 1)
    throw new RangeError(`VAT rate must be a fraction from 0 to 1: ${rate}`);
  return Math.round(rate * 10_000);
}

/** Basis points back as the fraction stored on a line, with four decimals (2500 → "0.2500"). */
export function bpToRateText(bp: number): string {
  assertInt(bp, 0, MAX_VAT_BP, "Basis points");
  return `${Math.floor(bp / 10_000)}.${String(bp % 10_000).padStart(4, "0")}`;
}

/**
 * The VAT of an invoice in the seller's own currency, for a foreign-currency
 * invoice (4.3): the amount times the reference rate, rounded to the minor
 * unit. `rate` is home-currency units per one unit of the invoice currency as
 * a decimal string (up to 8 decimals), so it never passes through a float.
 */
export function convertMinor(amountMinor: number, rate: string): number {
  const match = /^(\d{1,9})(?:\.(\d{1,8}))?$/.exec(rate.trim());
  if (!match) throw new RangeError(`Not an exchange rate: ${rate}`);
  const decimals = match[2] ?? "";
  const scaled = BigInt(match[1] + decimals.padEnd(8, "0"));
  if (scaled === BigInt(0)) throw new RangeError("An exchange rate cannot be zero");
  return toSafeNumber(divideRounded(BigInt(amountMinor) * scaled, BigInt(100_000_000)), "Converted amount");
}

// --- Lines and tasks are two views of one piece of work ----------------------

/**
 * Whether logged time may rewrite a draft line's quantity (1.4). Never for a
 * fixed fee, decided from the invoice's assignment or the line's own so hand
 * typed fixed-fee lines are not rewritten as hours times the fee (three past
 * bugs in Life), and never for a quantity the owner typed or rounded
 * (`quantity_manual`, an improvement on Life, which silently overwrote it).
 */
export function mayMirrorHours(args: {
  quantityManual: boolean;
  assignmentBilling: BillingType | null;
  lineAssignmentBilling?: BillingType | null;
}): boolean {
  if (args.quantityManual) return false;
  return args.assignmentBilling !== "fixed_fee" && args.lineAssignmentBilling !== "fixed_fee";
}

/** The quantity a task's line takes from its logged billable minutes, in hundredths of an hour. */
export const taskLineQuantity = (billableMinutes: number): number => minutesToHundredths(billableMinutes);

/**
 * A new task mirrored as a draft line (1.4): described as the task, priced at
 * the assignment's effective rate, quantity the task's estimate or nothing.
 */
export function lineFromTask(
  task: { title: string; estimatedMinutes: number | null },
  price: { rateMinor: number; vatBp: number; vatCategory: VatLineCategory },
): LineInput & { description: string } {
  return {
    description: lineDescription(task.title),
    quantityHundredths: task.estimatedMinutes ? minutesToHundredths(task.estimatedMinutes) : 0,
    unitPriceMinor: price.rateMinor,
    discountBp: 0,
    vatBp: price.vatBp,
    vatCategory: price.vatCategory,
  };
}

export type LineTaskPlan = {
  /** An unpaired line gets a task: estimate = the line's quantity, none when it is 0. */
  createTasks: { lineId: string; title: string; estimatedMinutes: number | null }[];
  /** A task is renamed to match its line. */
  renameTasks: { taskId: string; title: string }[];
  /** The tasks of removed lines go, unless a remaining line still uses one. */
  deleteTaskIds: string[];
};

/**
 * Saving lines on an invoice with an assignment: which tasks to create,
 * rename and delete so lines and tasks stay one piece of work (1.4). Pure; the
 * server applies it in the same transaction as the upsert of the lines.
 */
export function planLineTaskSync(args: {
  lines: readonly { id: string; taskId: string | null; description: string; quantityHundredths: number }[];
  tasks: readonly { id: string; title: string }[];
  removedTaskIds: readonly string[];
}): LineTaskPlan {
  const taskById = new Map(args.tasks.map((t) => [t.id, t]));
  const plan: LineTaskPlan = { createTasks: [], renameTasks: [], deleteTaskIds: [] };
  const inUse = new Set<string>();
  for (const line of args.lines) {
    const title = lineDescription(line.description);
    const task = line.taskId ? taskById.get(line.taskId) : undefined;
    if (!task) {
      plan.createTasks.push({
        lineId: line.id,
        title,
        estimatedMinutes: line.quantityHundredths > 0 ? hundredthsToMinutes(line.quantityHundredths) : null,
      });
      continue;
    }
    inUse.add(task.id);
    if (task.title !== title) plan.renameTasks.push({ taskId: task.id, title });
  }
  plan.deleteTaskIds = [...new Set(args.removedTaskIds)].filter((id) => !inUse.has(id));
  return plan;
}

// --- Text in and out ---------------------------------------------------------

/**
 * A typed decimal ("1,25", "1.25", " 12 ") as an integer scaled by 10^scale,
 * exactly and rounded half up past the last place, so no float is involved.
 * Null for anything that is not a plain non-negative number.
 */
export function parseDecimal(text: string, scale: number): number | null {
  const compact = text.replace(/[\s ]/g, "");
  const match = /^(\d*)(?:[.,](\d*))?$/.exec(compact);
  if (!match || (match[1] === "" && !match[2])) return null;
  const fraction = match[2] ?? "";
  let value = BigInt((match[1] || "0") + fraction.slice(0, scale).padEnd(scale, "0"));
  if (fraction.length > scale && fraction.charCodeAt(scale) >= 53) value += BigInt(1);
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

/** A quantity of hours or units typed as text, in hundredths; null if unreadable or over the limit. */
export function parseQuantityText(text: string): number | null {
  const n = parseDecimal(text, 2);
  return n !== null && n <= MAX_QUANTITY_HUNDREDTHS ? n : null;
}

/** A percentage typed as text ("12,5") in basis points; null if unreadable or over 100. */
export function parsePercentText(text: string): number | null {
  const n = parseDecimal(text, 2);
  return n !== null && n <= MAX_DISCOUNT_BP ? n : null;
}

/** An amount typed in major units ("1 249,50") as minor units, via the product editor's reader; null if unreadable or over the limit. */
export function parseMoneyText(text: string, currency: string): number | null {
  const minor = parsePrice(text, currency);
  return minor !== null && minor <= MAX_UNIT_PRICE_MINOR ? minor : null;
}

/** Basis points as a percentage for people and files: 2500 is "25", 1250 is "12.5", 1 is "0.01". */
export function bpToPercent(bp: number): string {
  assertInt(bp, 0, MAX_DISCOUNT_BP, "Basis points");
  const fraction = String(bp % 100)
    .padStart(2, "0")
    .replace(/0$/, "");
  return fraction === "" || fraction === "0" ? String(Math.floor(bp / 100)) : `${Math.floor(bp / 100)}.${fraction}`;
}

/** Minor units as a plain machine-readable decimal ("1234.50"), for CSV files and APIs, with the currency's own decimals. */
export function minorToDecimal(minor: number, currency: string): string {
  assertInt(minor, -Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, "Amount");
  const digits = minorUnitDigits(currency);
  const sign = minor < 0 ? "-" : "";
  const abs = Math.abs(minor);
  if (digits === 0) return `${sign}${abs}`;
  const unit = 10 ** digits;
  return `${sign}${Math.floor(abs / unit)}.${String(abs % unit).padStart(digits, "0")}`;
}

/** Hundredths as a plain decimal ("1.75"), for files. */
export const hundredthsToDecimal = (hundredths: number): string => minorToDecimal(hundredths, "EUR");

/** Hundredths of an hour for people: "1,75 h" in Norwegian. */
export function formatHours(quantityHundredths: number, locale: string): string {
  const text = new Intl.NumberFormat(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    quantityHundredths / 100,
  );
  return `${text} h`;
}
