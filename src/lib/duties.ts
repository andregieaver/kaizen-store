/**
 * Customs and duties (wave 7 unit I, D343, `docs/wave-7-storefront.md` section 4, I): an ESTIMATE of the customs duty and import VAT a consignment
 * pays where it enters a country, from the platform's own rates table (`commerce.duty_rates`, decision 2), and what the order then says about who
 * pays them (DDP: collected at checkout; DAP: the recipient pays the carrier). Pure: the facts in, the arithmetic out, in integer minor units with
 * BigInt; `src/server/customs.ts` reads the facts and is the ONE function `cartSummary()` and `placeOrder()` both call.
 *
 * NOTHING HERE IS CUSTOMS ADVICE. The table's rows are read by hand from the address each cites and are unverified until a person checks them;
 * every figure is labelled an estimate wherever it is shown. A line with no HS code, a heading the table has no rate for, or an amount that cannot be
 * converted gives NO estimate and a reason, never a zero duty.
 *
 * The rules, in this order:
 *  1. Nothing shipped (downloads, bookings): nothing crosses a border.
 *  2. The goods stay inside one customs territory (the same country, or both in the EU's customs union): none.
 *  3. Every shipped line needs an HS code (6 to 10 digits); otherwise no estimate (`missing_hs`, the lines named).
 *  4. The destination's rows on the day: its base row (prefix `''`: thresholds, the import VAT rate where it differs, whether shipping is in the
 *     customs value, a default rate) and its heading rows (a rate for goods whose HS code starts with the prefix, maybe only for an origin). A
 *     row for `EU` covers every member state; a country's own row wins over it. `applies_to` picks rows for consignments whose VAT is collected
 *     at the sale under the destination's scheme (IOSS, VOEC) or not.
 *  5. The customs value of a line is its price after every discount, without the VAT charged at checkout, plus its share of the shipping (without
 *     VAT) when the destination counts shipping in the value. Thresholds compare the goods alone, converted to the threshold's currency and
 *     rounded up (a value on the border is never taken to be inside it), per consignment or per item as the row says.
 *  6. At or below the duty threshold no duty is due, except a fixed amount per distinct tariff sub-heading (six digits) where the row has one
 *     (the EU's 3 EUR from 1 July 2026). Above it each line pays its heading's rate (the longest prefix, an origin's row before any origin's), else
 *     the base row's default; with neither, no estimate (`no_rate`). Each line's duty is rounded half up.
 *  7. Import VAT: none at the border at or below the VAT threshold (the VAT is collected at the sale); above it, the row's import VAT rate (else the
 *     goods' own rate in that country) on the customs value plus the duty, rounded half up per line.
 *  8. What DDP collects at checkout is the duty plus the import VAT the price does not already carry (the order's prices include the destination's
 *     VAT: the VAT already charged on a line and its shipping share is taken off its import VAT, never below zero). What DAP's carrier may collect
 *     is the duty plus the whole import VAT, before the carrier's own fees (never estimated).
 */
import { isEuMemberCountry } from "./vat-number";

export const CUSTOMS_MODES = ["dap", "ddp"] as const;
export type CustomsMode = (typeof CUSTOMS_MODES)[number];
export const isCustomsMode = (value: unknown): value is CustomsMode => value === "dap" || value === "ddp";

export const APPLIES_TO = ["any", "scheme", "no_scheme"] as const;
export type AppliesTo = (typeof APPLIES_TO)[number];

export const HS_CODE = /^[0-9]{6,10}$/;

/** One row of `commerce.duty_rates`, as `src/server/customs.ts` reads it. */
export type DutyRow = {
  id: string;
  destination: string;
  hsPrefix: string;
  origin: string | null;
  appliesTo: AppliesTo;
  dutyRateBps: number | null;
  perItemMinor: number | null;
  thresholdMinor: number | null;
  vatThresholdMinor: number | null;
  thresholdCurrency: string | null;
  thresholdPer: "consignment" | "item";
  importVatBps: number | null;
  shippingInValue: boolean;
  source: string;
  verified: boolean;
  /** YYYY-MM-DD, inclusive; null for no bound. */
  validFrom: string | null;
  validTo: string | null;
};

/** One shipped line of the basket, as the estimate sees it. */
export type DutyLine = {
  key: string;
  title: string;
  hsCode: string | null;
  origin: string | null;
  quantity: number;
  /** The line's price after every discount, without the VAT charged at checkout, in the order's currency. */
  valueMinor: number;
  /** The VAT charged on the line at checkout. */
  vatMinor: number;
  /** The goods' own VAT rate in the destination, in basis points (2500 = 25 %). */
  vatRateBps: number;
};

export type DutyInput = {
  destination: string;
  /** Where the goods are sent from (ISO); null when the store has not said. */
  dispatch: string | null;
  /** The day the order is placed (YYYY-MM-DD), for the rows' validity. */
  on: string;
  /** The order's currency (the one shown). */
  currency: string;
  /** The consignment's VAT is collected at the sale under the destination's scheme (IOSS into the EU, VOEC into Norway). */
  scheme: boolean;
  lines: readonly DutyLine[];
  /** The shipping charged, without its VAT, and the VAT on it. */
  shippingMinor: number;
  shippingVatMinor: number;
  rows: readonly DutyRow[];
  /** How many minor units of a currency one minor unit of the order's currency is (`conversionFactor()`); null when there is no rate. */
  factorTo: (currency: string) => number | null;
};

export type DutyLineResult = {
  key: string;
  title: string;
  hsCode: string;
  origin: string | null;
  /** The customs value: the line's value plus its share of the shipping where that counts. */
  customsValueMinor: number;
  dutyMinor: number;
  /** The rate used, in basis points; null where the threshold made the duty a fixed amount or nothing. */
  rateBps: number | null;
  /** The import VAT at the border (0 when it is collected at the sale). */
  importVatMinor: number;
  /** The import VAT the price did not already carry. */
  importVatBeyondMinor: number;
  /** No duty under the threshold, or a fixed amount for it. */
  underThreshold: boolean;
};

export type DutyUnknownReason = "missing_hs" | "no_rate" | "not_in_table" | "no_currency_rate" | "no_dispatch";

export type DutyEstimate =
  | { kind: "none"; reason: "nothing_shipped" | "no_border" }
  | { kind: "unknown"; reason: DutyUnknownReason; /** The lines it is about (`missing_hs`, `no_rate`), by key and title. */ lines: { key: string; title: string }[] }
  | {
      kind: "estimate";
      currency: string;
      dutyMinor: number;
      /** The import VAT at the border, before anything the price carries. */
      importVatMinor: number;
      /** What DDP collects at checkout: the duty and the import VAT the price does not carry. */
      ddpMinor: number;
      /** What DAP's carrier may collect: the duty and the whole import VAT (its own fees not included). */
      dapMinor: number;
      lines: DutyLineResult[];
      /** Every row the estimate rests on was verified by a person. */
      verified: boolean;
      sources: string[];
    };

const ten4 = BigInt(10_000);

/** a / b rounded half up, for a ≥ 0 and b > 0. */
function halfUp(a: bigint, b: bigint): bigint {
  return (BigInt(2) * a + b) / (BigInt(2) * b);
}

/** a / b rounded up, for a ≥ 0 and b > 0. */
function ceilDiv(a: bigint, b: bigint): bigint {
  return (a + b - BigInt(1)) / b;
}

/** A conversion factor as a fraction (nine decimals is far finer than any rate the store keeps). */
function rational(factor: number | null): { num: bigint; den: bigint } | null {
  if (factor === null || !Number.isFinite(factor) || factor <= 0) return null;
  const den = BigInt(1_000_000_000);
  const num = BigInt(Math.round(factor * 1e9));
  return num > BigInt(0) ? { num, den } : null;
}

const inRange = (row: Pick<DutyRow, "validFrom" | "validTo">, on: string) =>
  (row.validFrom === null || row.validFrom <= on) && (row.validTo === null || row.validTo >= on);

const appliesTo = (row: Pick<DutyRow, "appliesTo">, scheme: boolean) =>
  row.appliesTo === "any" || (row.appliesTo === "scheme" ? scheme : !scheme);

const forDestination = (row: Pick<DutyRow, "destination">, destination: string) =>
  row.destination === destination || (row.destination === "EU" && isEuMemberCountry(destination));

const originFits = (row: Pick<DutyRow, "origin">, origin: string | null) =>
  row.origin === null || (origin !== null && (row.origin === origin || (row.origin === "EU" && isEuMemberCountry(origin))));

/** Whether the goods cross a customs border between the two countries (the EU's member states are one customs territory). */
export function crossesBorder(dispatch: string | null, destination: string): boolean {
  if (!dispatch) return true;
  if (dispatch === destination) return false;
  return !(isEuMemberCountry(dispatch) && isEuMemberCountry(destination));
}

/** Most specific first: a country's own row before the EU's, a row for the scheme (or not) before one for any. */
function specificity(row: DutyRow): number {
  return (row.destination === "EU" ? 0 : 2) + (row.appliesTo === "any" ? 0 : 1);
}

/** The heading row for a line: the longest prefix its HS code starts with, an origin's row before any origin's, then the most specific. */
export function headingRowFor(rows: readonly DutyRow[], hsCode: string, origin: string | null): DutyRow | null {
  const fits = rows.filter((r) => r.hsPrefix !== "" && hsCode.startsWith(r.hsPrefix) && originFits(r, origin));
  fits.sort(
    (a, b) =>
      b.hsPrefix.length - a.hsPrefix.length ||
      Number(b.origin !== null) - Number(a.origin !== null) ||
      Number(b.origin !== null && b.origin !== "EU") - Number(a.origin !== null && a.origin !== "EU") ||
      specificity(b) - specificity(a),
  );
  return fits[0] ?? null;
}

/** The rows that apply to this destination, day and scheme. */
export function rowsFor(rows: readonly DutyRow[], destination: string, on: string, scheme: boolean): DutyRow[] {
  return rows.filter((r) => forDestination(r, destination) && inRange(r, on) && appliesTo(r, scheme));
}

/** Shares of `total` over `weights`, largest remainder, never negative; all to the first when the weights are zero. */
export function shareOut(total: number, weights: readonly number[]): number[] {
  if (weights.length === 0) return [];
  const t = BigInt(Math.max(0, Math.round(total)));
  const w = weights.map((x) => BigInt(Math.max(0, Math.round(x))));
  const sum = w.reduce((a, b) => a + b, BigInt(0));
  if (sum === BigInt(0)) return weights.map((_, i) => (i === 0 ? Number(t) : 0));
  const floors = w.map((x) => (t * x) / sum);
  let left = t - floors.reduce((a, b) => a + b, BigInt(0));
  const order = w.map((x, i) => ({ i, rem: (t * x) % sum })).sort((a, b) => (b.rem > a.rem ? 1 : b.rem < a.rem ? -1 : a.i - b.i));
  for (const { i } of order) {
    if (left <= BigInt(0)) break;
    floors[i] += BigInt(1);
    left -= BigInt(1);
  }
  return floors.map(Number);
}

export function dutyEstimate(input: DutyInput): DutyEstimate {
  const lines = input.lines;
  if (lines.length === 0) return { kind: "none", reason: "nothing_shipped" };
  if (!input.dispatch) return { kind: "unknown", reason: "no_dispatch", lines: [] };
  if (!crossesBorder(input.dispatch, input.destination)) return { kind: "none", reason: "no_border" };

  const missing = lines.filter((l) => !l.hsCode || !HS_CODE.test(l.hsCode));
  if (missing.length > 0) return { kind: "unknown", reason: "missing_hs", lines: missing.map((l) => ({ key: l.key, title: l.title })) };

  const valid = rowsFor(input.rows, input.destination, input.on, input.scheme);
  const base = valid.filter((r) => r.hsPrefix === "").sort((a, b) => specificity(b) - specificity(a))[0] ?? null;
  const headings = valid.filter((r) => r.hsPrefix !== "");
  if (!base && headings.length === 0) return { kind: "unknown", reason: "not_in_table", lines: [] };

  // The order's currency to the threshold's, as a fraction (thresholds compare the goods, rounded up).
  const thresholdCurrency = base?.thresholdCurrency ?? null;
  let factor: { num: bigint; den: bigint } | null = null;
  if (thresholdCurrency) {
    factor = thresholdCurrency === input.currency ? { num: BigInt(1), den: BigInt(1) } : rational(input.factorTo(thresholdCurrency));
    if (!factor) return { kind: "unknown", reason: "no_currency_rate", lines: [] };
  }
  const inThresholdCurrency = (minor: bigint) => (factor ? ceilDiv(minor * factor.num, factor.den) : minor);

  const shippingIn = base?.shippingInValue ?? true;
  const values = lines.map((l) => Math.max(0, l.valueMinor));
  const shipShares = shippingIn ? shareOut(input.shippingMinor, values) : values.map(() => 0);
  const shipVatShares = shippingIn ? shareOut(input.shippingVatMinor, values) : values.map(() => 0);
  const goodsTotal = values.reduce((sum, v) => sum + BigInt(v), BigInt(0));

  const under = (threshold: number | null, line: DutyLine, value: number): boolean => {
    if (threshold === null || !base) return false;
    const measured =
      base.thresholdPer === "item" ? ceilDiv(BigInt(value), BigInt(Math.max(1, line.quantity))) : goodsTotal;
    return inThresholdCurrency(measured) <= BigInt(threshold);
  };

  const used = new Set<DutyRow>(base ? [base] : []);
  const noRate: { key: string; title: string }[] = [];
  const vatAtSale: boolean[] = [];
  const results: DutyLineResult[] = lines.map((line, i) => {
    const value = values[i];
    const customsValue = BigInt(value + shipShares[i]);
    const dutyFree = under(base?.thresholdMinor ?? null, line, value);
    vatAtSale[i] = under(base?.vatThresholdMinor ?? null, line, value);
    const heading = headingRowFor(headings, line.hsCode as string, line.origin);
    let duty = BigInt(0);
    let rateBps: number | null = null;
    if (!dutyFree) {
      rateBps = heading?.dutyRateBps ?? base?.dutyRateBps ?? null;
      if (rateBps === null) noRate.push({ key: line.key, title: line.title });
      else {
        if (heading) used.add(heading);
        duty = halfUp(customsValue * BigInt(rateBps), ten4);
      }
    }
    return {
      key: line.key,
      title: line.title,
      hsCode: line.hsCode as string,
      origin: line.origin,
      customsValueMinor: Number(customsValue),
      dutyMinor: Number(duty),
      rateBps,
      importVatMinor: 0,
      importVatBeyondMinor: 0,
      underThreshold: dutyFree,
    };
  });
  if (noRate.length > 0) return { kind: "unknown", reason: "no_rate", lines: noRate };

  // A fixed amount per distinct tariff sub-heading under the threshold (per consignment), given to the first line of each, converted back.
  if (base && base.perItemMinor !== null && base.thresholdPer === "consignment" && factor && results.every((r) => r.underThreshold)) {
    const seen = new Set<string>();
    for (const r of results) {
      const sub = r.hsCode.slice(0, 6);
      if (seen.has(sub)) continue;
      seen.add(sub);
      r.dutyMinor = Number(halfUp(BigInt(base.perItemMinor) * factor.den, factor.num));
    }
  }

  // Import VAT at the border on the customs value and the duty; what the price already carries is taken off for DDP.
  for (const [i, r] of results.entries()) {
    const line = lines[i];
    if (vatAtSale[i]) continue;
    const heading = headingRowFor(headings, r.hsCode, r.origin);
    const rate = heading?.importVatBps ?? base?.importVatBps ?? line.vatRateBps;
    const vat = halfUp((BigInt(r.customsValueMinor) + BigInt(r.dutyMinor)) * BigInt(Math.max(0, rate)), ten4);
    r.importVatMinor = Number(vat);
    const inPrice = BigInt(Math.max(0, line.vatMinor) + shipVatShares[i]);
    r.importVatBeyondMinor = Number(vat > inPrice ? vat - inPrice : BigInt(0));
  }

  const dutyMinor = results.reduce((s, r) => s + r.dutyMinor, 0);
  const importVatMinor = results.reduce((s, r) => s + r.importVatMinor, 0);
  const beyond = results.reduce((s, r) => s + r.importVatBeyondMinor, 0);
  const rowsUsed = [...used];
  return {
    kind: "estimate",
    currency: input.currency,
    dutyMinor,
    importVatMinor,
    ddpMinor: dutyMinor + beyond,
    dapMinor: dutyMinor + importVatMinor,
    lines: results,
    verified: rowsUsed.length > 0 && rowsUsed.every((r) => r.verified),
    sources: [...new Set(rowsUsed.map((r) => r.source))],
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// What the order says
// ---------------------------------------------------------------------------------------------------------------------

/** Why DDP was not used for an order the store wanted it for: kinds of purchase whose payment is not the checkout's alone. */
export type DdpFallback = "subscription" | "host" | "venue" | "terms";

export type CustomsDecision = {
  /** The store's choice for the country. */
  chosen: CustomsMode;
  /** Who pays: the store's choice, or DAP where DDP cannot be collected for this purchase. */
  mode: CustomsMode;
  fallback: DdpFallback | null;
  estimate: DutyEstimate;
  /** What checkout collects beside the order's total (DDP with an estimate); 0 otherwise. */
  collectMinor: number;
  /** DDP was chosen and allowed but there is no estimate: the checkout is blocked with the reason, never a zero duty. */
  blocked: boolean;
};

export function customsDecision(chosen: CustomsMode, estimate: DutyEstimate, fallback: DdpFallback | null): CustomsDecision {
  const mode: CustomsMode = chosen === "ddp" && fallback === null ? "ddp" : "dap";
  const crossing = estimate.kind !== "none";
  return {
    chosen,
    mode,
    fallback: chosen === "ddp" ? fallback : null,
    estimate,
    collectMinor: crossing && mode === "ddp" && estimate.kind === "estimate" ? estimate.ddpMinor : 0,
    blocked: crossing && mode === "ddp" && estimate.kind === "unknown",
  };
}

/** What `orders.customs` keeps (version 1). */
export type OrderCustoms = {
  v: 1;
  /** Who pays duties and import VAT: `ddp` (paid at checkout, `collectedMinor`) or `dap` (the recipient pays the carrier on delivery). */
  mode: CustomsMode;
  /** The store's choice, when it differs (a purchase DDP cannot be collected for). */
  chosen: CustomsMode;
  fallback: DdpFallback | null;
  destination: string;
  currency: string;
  /** What was collected at checkout (DDP), in the order's currency. */
  collectedMinor: number;
  /** The estimate: duty, import VAT at the border, and what DAP's carrier may collect; null when there is none (`reason`). */
  estimate: { dutyMinor: number; importVatMinor: number; dapMinor: number; verified: boolean; sources: string[] } | null;
  reason: DutyUnknownReason | null;
  /** The day the rates were read for. */
  on: string;
};

/** The record an order keeps, or null when the goods cross no border. */
export function orderCustomsOf(decision: CustomsDecision, destination: string, currency: string, on: string): OrderCustoms | null {
  const e = decision.estimate;
  if (e.kind === "none") return null;
  return {
    v: 1,
    mode: decision.mode,
    chosen: decision.chosen,
    fallback: decision.fallback,
    destination,
    currency,
    collectedMinor: decision.collectMinor,
    estimate: e.kind === "estimate" ? { dutyMinor: e.dutyMinor, importVatMinor: e.importVatMinor, dapMinor: e.dapMinor, verified: e.verified, sources: e.sources } : null,
    reason: e.kind === "unknown" ? e.reason : null,
    on,
  };
}

const int = (v: unknown): number | null => (typeof v === "number" && Number.isSafeInteger(v) ? v : null);

/** `orders.customs` read defensively (null for an order with none, or one not shaped as a record). */
export function parseOrderCustoms(value: unknown): OrderCustoms | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.v !== 1 || !isCustomsMode(v.mode) || typeof v.destination !== "string" || typeof v.currency !== "string") return null;
  const collected = int(v.collectedMinor) ?? 0;
  const raw = typeof v.estimate === "object" && v.estimate !== null ? (v.estimate as Record<string, unknown>) : null;
  const estimate =
    raw && int(raw.dutyMinor) !== null && int(raw.importVatMinor) !== null && int(raw.dapMinor) !== null
      ? {
          dutyMinor: int(raw.dutyMinor) as number,
          importVatMinor: int(raw.importVatMinor) as number,
          dapMinor: int(raw.dapMinor) as number,
          verified: raw.verified === true,
          sources: Array.isArray(raw.sources) ? raw.sources.filter((s): s is string => typeof s === "string") : [],
        }
      : null;
  const reasons: DutyUnknownReason[] = ["missing_hs", "no_rate", "not_in_table", "no_currency_rate", "no_dispatch"];
  const fallbacks: DdpFallback[] = ["subscription", "host", "venue", "terms"];
  return {
    v: 1,
    mode: v.mode,
    chosen: isCustomsMode(v.chosen) ? v.chosen : v.mode,
    fallback: fallbacks.find((f) => f === v.fallback) ?? null,
    destination: v.destination,
    currency: v.currency,
    collectedMinor: collected,
    estimate,
    reason: reasons.find((r) => r === v.reason) ?? null,
    on: typeof v.on === "string" ? v.on : "",
  };
}

// ---------------------------------------------------------------------------------------------------------------------
// The rates table's rows as a platform admin enters them
// ---------------------------------------------------------------------------------------------------------------------

export type DutyRowInput = Omit<DutyRow, "id" | "verified"> & { note: string; checkedOn: string; verified: boolean };

/** What is wrong with a row before it is saved (the database checks the same), or null. Plain English for the platform's admin. */
export function dutyRowProblem(row: DutyRowInput): string | null {
  if (!/^[A-Z]{2}$/.test(row.destination)) return "The destination is a two-letter country code, or EU for every member state.";
  if (!/^[0-9]{0,10}$/.test(row.hsPrefix)) return "The HS heading is digits only, at most ten (empty for the country's base row).";
  if (row.origin !== null && !/^[A-Z]{2}$/.test(row.origin)) return "The origin is a two-letter country code, EU, or empty for any origin.";
  if (!APPLIES_TO.includes(row.appliesTo)) return "Choose whom the row applies to.";
  if (row.dutyRateBps !== null && (!Number.isInteger(row.dutyRateBps) || row.dutyRateBps < 0 || row.dutyRateBps > 100_000)) return "The duty rate is between 0 and 1000 %.";
  if (row.importVatBps !== null && (!Number.isInteger(row.importVatBps) || row.importVatBps < 0 || row.importVatBps > 10_000)) return "The import VAT rate is between 0 and 100 %.";
  const amounts = [row.thresholdMinor, row.vatThresholdMinor, row.perItemMinor];
  if (amounts.some((a) => a !== null && (!Number.isSafeInteger(a) || a < 0))) return "Amounts are zero or more.";
  if (amounts.some((a) => a !== null) && !(row.thresholdCurrency && /^[A-Z]{3}$/.test(row.thresholdCurrency))) return "An amount needs its currency.";
  if (row.hsPrefix !== "") {
    if (row.dutyRateBps === null) return "A heading's row needs its duty rate.";
    if (amounts.some((a) => a !== null)) return "Thresholds and fixed amounts belong on the country's base row (an empty HS heading).";
  } else if (row.origin !== null) return "The base row is for every origin.";
  if (!/^https:\/\/\S+$/.test(row.source) || row.source.length > 400) return "Give the address (https) the rate was read from.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.checkedOn)) return "Give the day the source was read.";
  if (row.validFrom && row.validTo && row.validTo < row.validFrom) return "The row cannot end before it begins.";
  if (row.note.length > 1000) return "The note is at most 1000 characters.";
  return null;
}

/** A rate in basis points as people write it (12.5 → 1250), or null for an empty field; NaN for something that is not a number. */
export function bpsOfPercent(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return Number.NaN;
  const [whole, frac = ""] = t.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

/** A rate in basis points as a percentage in words (1250 → "12.5 %"). */
export function percentOfBps(bps: number): string {
  const whole = Math.floor(bps / 100);
  const frac = bps % 100;
  return `${whole}${frac === 0 ? "" : `.${String(frac).padStart(2, "0").replace(/0$/, "")}`} %`;
}
