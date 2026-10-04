/**
 * Unit price indication (D160, `docs/wave-1d-unit-price.md`): the price per kilogram, litre, metre, square metre or
 * piece beside a price (Price Indication Directive 98/6/EC Art. 3).
 *
 * This file is the ONLY place a price is divided by a measure (`unit-price-readers.test.ts` scans for it). The figure
 * is worked out from the price **as the surface shows it**: the integer count of minor units of the currency shown,
 * after `shown()` has converted it for the market (D109) and after the VAT display (`withoutVat()` first for a business
 * buyer where the store shows prices without VAT). It is never converted from another currency's unit price and never
 * worked out from `PriceView.referenceMinor` (the 30-day reference). It is display and a snapshot, never an input to a
 * total.
 *
 * Naming: `unitPriceMinor` elsewhere in the code is the price per ITEM. The price per measure is `unit` or `measure`
 * in names, and `unitPrice()` here.
 *
 * Arithmetic is integers in `BigInt` (no float anywhere), rounded half up to the minor unit of the currency shown
 * (Swedish KOVFS 2012:1 4 §, read 2026-10-04; the other sources say nothing), and is not rounded to the market's `step`:
 * a unit price is information, not a payable amount. Pure, no I/O, runs in the browser. Needs review by a lawyer.
 */
import { withoutVat, type Buyer } from "./b2b";
import { shownAmount } from "./pricing";
import type { PriceVat } from "./pricing";

/** The units a variant's content is measured in (the pack's total). */
export const UNITS = ["g", "kg", "ml", "cl", "l", "cm", "m", "m2", "piece"] as const;
export type Unit = (typeof UNITS)[number];

/** What a price is compared in: one kilogram, 100 g, one litre, 100 ml, one metre, one square metre or one piece. */
export const BASES = ["kg", "100g", "l", "100ml", "m", "m2", "piece"] as const;
export type Base = (typeof BASES)[number];

export type Family = "mass" | "volume" | "length" | "area" | "count";

/** The largest content a variant can say (the database's check). */
export const MEASURE_AMOUNT_MAX = 1_000_000;
/** Decimals a content may have. */
export const MEASURE_DECIMALS = 4;

/**
 * A variant's total content: the amount as a decimal string as the database keeps it (`"250"`, `"0.7500"`) and its
 * unit. A string, never a float, so what was typed is what is stored.
 */
export type Measure = { amount: string; unit: Unit };

/** A measure as a market shows it: with the base that is in effect there (`effectiveBase()`), never null. */
export type ShownMeasure = Measure & { base: Base };

const FAMILY: Record<Unit, Family> = { g: "mass", kg: "mass", ml: "volume", cl: "volume", l: "volume", cm: "length", m: "length", m2: "area", piece: "count" };

/** Each unit in the smallest unit of its family (grams, millilitres, centimetres, square metres, pieces). */
const FACTOR: Record<Unit, number> = { g: 1, kg: 1000, ml: 1, cl: 10, l: 1000, cm: 1, m: 100, m2: 1, piece: 1 };

const BASE_FAMILY: Record<Base, Family> = { kg: "mass", "100g": "mass", l: "volume", "100ml": "volume", m: "length", m2: "area", piece: "count" };

/** Each base in the smallest unit of its family. */
const BASE_QUANTITY: Record<Base, number> = { kg: 1000, "100g": 100, l: 1000, "100ml": 100, m: 100, m2: 1, piece: 1 };

const FAMILY_DEFAULT: Record<Family, Base> = { mass: "kg", volume: "l", length: "m", area: "m2", count: "piece" };

export const isUnit = (value: unknown): value is Unit => typeof value === "string" && (UNITS as readonly string[]).includes(value);
export const isBase = (value: unknown): value is Base => typeof value === "string" && (BASES as readonly string[]).includes(value);

export const unitFamily = (unit: Unit): Family => FAMILY[unit];
export const baseFamily = (base: Base): Family => BASE_FAMILY[base];

/** The comparison base a unit takes when the owner chose none: 1 kg, 1 l, 1 m, 1 m², 1 piece. */
export const defaultBase = (unit: Unit): Base => FAMILY_DEFAULT[FAMILY[unit]];

/** Whether a base can compare this unit (a mass in kg or 100 g, a volume in l or 100 ml, ...). */
export const baseFits = (unit: Unit, base: Base): boolean => FAMILY[unit] === BASE_FAMILY[base];

/** The bases an owner can choose for a unit: its family's default, and for a mass or volume the small one. */
export function basesFor(unit: Unit): Base[] {
  return BASES.filter((b) => baseFits(unit, b));
}

/** Whether a base is the small one (100 g, 100 ml), which a market's rule may not allow (`unit-price-rules.ts`). */
export const isSmallBase = (base: Base): boolean => base === "100g" || base === "100ml";

// --- Amounts --------------------------------------------------------------------------------------------------------

const AMOUNT = /^(\d{1,7})(?:[.,](\d{1,4}))?$/;

/**
 * A typed content ("0,75", "1.5", "250") as an integer count of ten-thousandths, or null when it is not a positive
 * decimal of at most four decimals up to one million. Never a float; "0", "-1", "1e3", " ", "1,000.5" and five
 * decimals are refused.
 */
export function parseMeasureAmount(input: unknown): number | null {
  if (typeof input !== "string") return null;
  const match = AMOUNT.exec(input.trim());
  if (!match) return null;
  const whole = match[1];
  const fraction = (match[2] ?? "").padEnd(MEASURE_DECIMALS, "0");
  // At most 7 + 4 digits: always a safe integer.
  const tenThousandths = Number.parseInt(whole + fraction, 10);
  if (tenThousandths <= 0 || tenThousandths > MEASURE_AMOUNT_MAX * 10 ** MEASURE_DECIMALS) return null;
  return tenThousandths;
}

/**
 * The canonical decimal text of a count of ten-thousandths: no trailing zeros ("250", "0.75", "1.5"), a point for the
 * decimal. What `parseMeasureAmount` accepts and the database column holds, up to its trailing zeros.
 */
export function formatMeasureAmount(tenThousandths: number): string {
  const whole = Math.trunc(tenThousandths / 10 ** MEASURE_DECIMALS);
  const fraction = String(tenThousandths % 10 ** MEASURE_DECIMALS).padStart(MEASURE_DECIMALS, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}

/** A column or typed amount in its canonical form, or null when it is not a valid content. */
export function normaliseMeasureAmount(input: unknown): string | null {
  const parsed = parseMeasureAmount(input);
  return parsed === null ? null : formatMeasureAmount(parsed);
}

/** A measure's amount for words ("250", "0.75"): the canonical text, or the input as it is when it cannot be read. */
export const measureText = (measure: Measure): string => normaliseMeasureAmount(measure.amount) ?? measure.amount;

/**
 * A measure from what the database holds (`measure_amount` as the driver returns a numeric, a string such as
 * `"250.0000"`, and `measure_unit`), or null when the variant has none or the data is not valid.
 */
export function measureFromColumns(amount: unknown, unit: unknown): Measure | null {
  if (amount === null || amount === undefined || !isUnit(unit)) return null;
  const normal = normaliseMeasureAmount(String(amount));
  return normal === null ? null : { amount: normal, unit };
}

// --- The one function ------------------------------------------------------------------------------------------------

export type UnitPriceReason =
  /** The base compares another kind of thing than the unit measures (kg for litres). */
  | "family"
  /** No price, or a free one (a gift line): nothing to compare. */
  | "free"
  /** The content is the base quantity itself: the unit price is the price (Directive Art. 3(1)). */
  | "same_as_price"
  /** The figure would be under half a minor unit: never shown as 0,00. */
  | "rounds_to_zero"
  /** Not a content the arithmetic can hold. */
  | "too_large"
  | "invalid";

export type UnitPriceResult =
  | { ok: true; /** The price per base, in minor units of the currency shown. */ minor: number; base: Base }
  | { ok: false; reason: UnitPriceReason };

const fail = (reason: UnitPriceReason): UnitPriceResult => ({ ok: false, reason });

/** `round_half_up(n / d)` for `n >= 0`, `d > 0`. */
const halfUp = (n: bigint, d: bigint): bigint => (BigInt(2) * n + d) / (BigInt(2) * d);

/**
 * The price per base of a content, from the price the surface shows for the whole pack.
 *
 * `unit = round_half_up(shown x R x 10000 / (A x f))`: `R` the base's quantity and `f` the unit's factor in the
 * family's smallest unit, `A` the amount in ten-thousandths. Returns a reason instead of a figure when none can be
 * stated truthfully; it never throws.
 *
 * Its parameters take the price shown only: the 30-day reference price (`PriceView.referenceMinor`) is not a price
 * the indication is ever worked out from.
 */
export function unitPrice(shownMinor: number, measure: Measure, base: Base): UnitPriceResult {
  if (!isUnit(measure?.unit) || !isBase(base)) return fail("invalid");
  if (FAMILY[measure.unit] !== BASE_FAMILY[base]) return fail("family");
  if (!Number.isSafeInteger(shownMinor)) return fail("invalid");
  const amount = parseMeasureAmount(measure.amount);
  if (amount === null) return fail("invalid");
  if (shownMinor <= 0) return fail("free");

  const denominator = BigInt(amount) * BigInt(FACTOR[measure.unit]);
  const baseTotal = BigInt(BASE_QUANTITY[base]) * BigInt(10 ** MEASURE_DECIMALS);
  if (denominator === baseTotal) return fail("same_as_price");

  const result = halfUp(BigInt(shownMinor) * baseTotal, denominator);
  if (result === BigInt(0)) return fail("rounds_to_zero");
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) return fail("too_large");
  // A safe integer by the check above, so the parse is exact.
  return { ok: true, minor: Number.parseInt(result.toString(), 10), base };
}

/**
 * The unit price for each VAT display a surface may have, from the price KEPT with VAT (`amountMinor`): the one place
 * a surface asks.
 *
 * - `incl` (consumer stores): the price with VAT, as shown.
 * - `excl` (business-only stores): the price without VAT, netted and rounded to the minor unit first, as the page
 *   shows it, and the unit price from that integer.
 * - `choice` (both): both, the page draws each inside `for-private` / `for-business` like `VatAmount`.
 *
 * With a `buyer` (a per-request page that knows who is looking) only the one that buyer sees is returned. A value
 * that is absent is not shown on this surface; a value that is `{ ok: false }` is shown as nothing, with its reason.
 */
export type UnitPriceShown = { incl?: UnitPriceResult; excl?: UnitPriceResult };

export function unitPriceShown(
  amountMinor: number,
  vat: PriceVat,
  measure: Measure,
  base: Base,
  buyer?: Buyer,
): UnitPriceShown {
  if (buyer) {
    const amount = shownAmount(amountMinor, vat, buyer);
    const result = unitPrice(amount, measure, base);
    return vat.shown !== "incl" && buyer === "business" ? { excl: result } : { incl: result };
  }
  const incl = () => unitPrice(amountMinor, measure, base);
  const excl = () => unitPrice(withoutVat(amountMinor, vat.rate), measure, base);
  if (vat.shown === "incl") return { incl: incl() };
  if (vat.shown === "excl") return { excl: excl() };
  return { incl: incl(), excl: excl() };
}

/** Whether any of the unit prices of a surface can be drawn. */
export const hasUnitPrice = (shown: UnitPriceShown): boolean => shown.incl?.ok === true || shown.excl?.ok === true;

// --- Structured data --------------------------------------------------------------------------------------------------

/**
 * UN/CEFACT unit codes for a unit, as schema.org and Google's merchant listing documentation take them. Written from
 * memory and NOT checked against Merchant Center's list: needs review.
 */
const UNIT_CODE: Record<Unit, string> = { g: "GRM", kg: "KGM", ml: "MLT", cl: "CLT", l: "LTR", cm: "CMT", m: "MTR", m2: "MTK", piece: "C62" };

export const unitCode = (unit: Unit): string => UNIT_CODE[unit];

/** A base as a quantity for `valueReference`: `100g` is 100 with GRM, `kg` is 1 with KGM. */
export function baseQuantity(base: Base): { value: string; unitCode: string } {
  switch (base) {
    case "kg":
      return { value: "1", unitCode: UNIT_CODE.kg };
    case "100g":
      return { value: "100", unitCode: UNIT_CODE.g };
    case "l":
      return { value: "1", unitCode: UNIT_CODE.l };
    case "100ml":
      return { value: "100", unitCode: UNIT_CODE.ml };
    case "m":
      return { value: "1", unitCode: UNIT_CODE.m };
    case "m2":
      return { value: "1", unitCode: UNIT_CODE.m2 };
    case "piece":
      return { value: "1", unitCode: UNIT_CODE.piece };
  }
}

/** A measure as a quantity for `referenceQuantity`: the pack's total as typed. */
export function measureQuantity(measure: Measure): { value: string; unitCode: string } {
  return { value: normaliseMeasureAmount(measure.amount) ?? measure.amount, unitCode: UNIT_CODE[measure.unit] };
}

// --- Checking a typed measure -----------------------------------------------------------------------------------------

/** What a measure may be set on: physical goods only (not an appointment, stay, rental or download). */
export type MeasureContext = { kind: string; delivery: string };

/**
 * Why a typed measure cannot be saved, in the admin's English, or null. `amount` is typed text; `base` null takes the
 * family's default.
 */
export function measureProblem(
  input: { amount: string; unit: string; base: string | null } | null,
  context: MeasureContext,
): string | null {
  if (input === null) return null;
  if (context.kind !== "goods" || context.delivery !== "physical") {
    return "Content can only be given for physical goods, not for appointments, stays, rentals or downloads.";
  }
  if (parseMeasureAmount(input.amount) === null) {
    return `Content must be a number above 0 and up to ${MEASURE_AMOUNT_MAX.toLocaleString("en")}, with at most ${MEASURE_DECIMALS} decimals.`;
  }
  if (!isUnit(input.unit)) return "Choose a unit for the content.";
  if (input.base !== null) {
    if (!isBase(input.base)) return "Choose what the price is compared per.";
    if (!baseFits(input.unit, input.base)) return `A content in ${input.unit} cannot be compared per ${input.base}.`;
  }
  return null;
}

// --- What the product editor types ------------------------------------------------------------------------------------

/**
 * A typed content as a measure, or null while it is empty or not a valid number: the editor's live checks and its preview
 * work from what is typed so far. The text is normalised ("0,75" becomes "0.75").
 */
export function typedMeasure(input: { amount: string; unit: string } | null): Measure | null {
  if (!input || !isUnit(input.unit)) return null;
  const amount = normaliseMeasureAmount(input.amount);
  return amount === null ? null : { amount, unit: input.unit };
}

/** The most items the editor's pack helper multiplies by. */
export const PACK_COUNT_MAX = 1000;

/**
 * The total of a pack of `count` items of `each` content ("6" x "33" = "198"), as text for the content field, or null when
 * `each` is not a valid content, `count` is not a whole number from 1 to `PACK_COUNT_MAX`, or the total is too large.
 * Integer arithmetic on ten-thousandths; the editor only types it, nothing about the pack is stored.
 */
export function packTotal(count: unknown, each: string): string | null {
  const n = typeof count === "number" ? count : typeof count === "string" && /^\d{1,4}$/.test(count.trim()) ? Number.parseInt(count, 10) : NaN;
  if (!Number.isInteger(n) || n < 1 || n > PACK_COUNT_MAX) return null;
  const parsed = parseMeasureAmount(each);
  if (parsed === null) return null;
  const total = parsed * n;
  return total > MEASURE_AMOUNT_MAX * 10 ** MEASURE_DECIMALS ? null : formatMeasureAmount(total);
}
