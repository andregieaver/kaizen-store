import { daysBetween, isDay } from "./analytics-period";
import { formatCount, formatPercent, formatSigned } from "./analytics-core";
import { formatAmount } from "./analytics-format";

/**
 * Why did revenue change? (D152, docs/analytics.md, "Alerts, targets, forecast,
 * diagnosis".) Pure and without a model: revenue = sessions x conversion x
 * average order, each factor's part of the change worked out with a log
 * decomposition (shares add to 100 and a factor working against the move has
 * the other sign), the segments that moved most, when the move began and a
 * place to look. The words are templates over those facts.
 *
 * Without sessions (visit counting off in either period) revenue is orders x
 * average order. Refunds are not covered here: revenue is net, and the
 * Finance page shows refunds.
 *
 * Amounts are minor units of the store's main currency, net of refunds and
 * without VAT, as everywhere in the analytics. Percentages named `changePct`
 * are ratios (0.124 is +12.4 %), like `Delta.pct`; `sharePct` and
 * `shareOfChangePct` are whole percent of the revenue change.
 */

/** A change smaller than this (2 %) is called flat: no direction, no shares, nothing to explain. */
export const FLAT_BAND = 0.02;

/** A period with fewer orders than this is explained with a warning that it may be chance, and gets no segments or start date. */
export const LOW_VOLUME_ORDERS = 10;

/** A segment explains the change only when it carries this share of it (25 %), in whole percent. */
export const MIN_SEGMENT_SHARE = 25;

/** A segment needs this many orders in at least one of the two periods to be named. */
export const MIN_SEGMENT_ORDERS = 10;

/** At most this many segments per dimension are returned. */
export const MAX_SEGMENTS_PER_DIMENSION = 2;

/** Days in the average that finds the start of a move. */
export const TIMING_WINDOW_DAYS = 7;

/** A 7-day average counts as moved when it is this far (10 %) from the previous period's daily mean, in the direction of the change. */
export const TIMING_THRESHOLD = 0.1;

/** The move must hold for this many consecutive 7-day averages up to the end of the period to be called sustained. */
export const TIMING_MIN_WINDOWS = 3;

/** Days needed in the current period's series before a start date is looked for: a window, the sustained run and one earlier window. */
export const TIMING_MIN_DAYS = TIMING_WINDOW_DAYS + TIMING_MIN_WINDOWS;

/** What one period brought. */
export type PeriodFigures = {
  /** Net revenue (after refunds, without VAT), minor units. */
  revenueMinor: number;
  /** Paid orders. */
  orders: number;
  /** Visits; null when visit counting was not on for the period (never 0 for "not known"). */
  sessions: number | null;
};

export type SegmentDimension = "device" | "channel" | "market" | "product";

/** One row of a table split by a dimension: what the segment brought now and before. */
export type SegmentRow = {
  /** Stable key (a device class, a channel key, a country code, a product id). */
  key: string;
  /** The words the owner sees (Mobile, Paid search, Norway, a product's name). */
  label: string;
  current: PeriodFigures;
  previous: PeriodFigures;
};

export type SegmentTable = { dimension: SegmentDimension; rows: readonly SegmentRow[] };

export type FactorKey = "traffic" | "conversion" | "basket" | "orders";

/** What the change in one factor did to revenue. */
export type Factor = {
  key: FactorKey;
  /** "Traffic", "Conversion", "Average order" or "Orders". */
  label: string;
  /** The factor's own change as a ratio (-0.11 is -11 %): the factors' (1 + changePct) multiply to the revenue ratio. */
  changePct: number;
  /**
   * Its part of the revenue change in whole percent, adding up to 100 over the factors. Positive when it moved revenue
   * the way revenue moved, negative when it worked against. Null when revenue was flat (a share of nothing).
   */
  sharePct: number | null;
};

/** A segment that carries a large part of the change. */
export type SegmentMover = {
  dimension: SegmentDimension;
  label: string;
  key: string;
  /** Its revenue now minus before (minor units); has the sign of the overall change. */
  changeMinor: number;
  /** Its part of the overall revenue change, whole percent (at least `MIN_SEGMENT_SHARE`). */
  shareOfChangePct: number;
};

/** A place in the analytics to look next; `href` is the path after the store's admin base. */
export type LookAt = { text: string; href: string };

export type ChangeInput = {
  current: PeriodFigures;
  previous: PeriodFigures;
  /** Tables split by device, channel, market and product; any may be missing. */
  segments?: readonly SegmentTable[];
  /** The current period's net revenue per day, every day present (zeros included). */
  daily?: readonly { day: string; revenueMinor: number }[];
  /** Days in the previous period, for its daily mean; defaults to the length of `daily`. */
  previousDays?: number;
  /** The main currency and locale, for amounts in the words; without a currency the words give percentages instead. */
  currency?: string;
  locale?: string;
};

export type ChangeExplanation = {
  /** `unknown` when nothing can be explained (see `reason`); `flat` within `FLAT_BAND`. */
  direction: "up" | "down" | "flat" | "unknown";
  /** Current minus previous revenue, minor units. */
  changeMinor: number;
  /** As a ratio of the previous revenue; null when that was 0. */
  changePct: number | null;
  /** Empty when unknown. Three factors with sessions, two (orders, average order) without. */
  factors: Factor[];
  /** The factor with the largest share of the change; null when flat or unknown. */
  mainFactor: FactorKey | null;
  /** The biggest movers, largest share first. */
  segments: SegmentMover[];
  /** The first day of the sustained move, `YYYY-MM-DD`; null when it is not clear. */
  startedOn: string | null;
  /** The explanation in words, ready to show in order. */
  sentences: string[];
  /** Where to look next; null when no rule points anywhere. */
  lookAt: LookAt | null;
  /** Why nothing can be explained; null otherwise. */
  reason: string | null;
  /** A caveat that applies to an explanation that was given (traffic not separated, few orders); null otherwise. */
  note: string | null;
  /** A period had fewer than `LOW_VOLUME_ORDERS` orders. */
  lowVolume: boolean;
};

const FACTOR_LABEL: Record<FactorKey, string> = {
  traffic: "Traffic",
  conversion: "Conversion",
  basket: "Average order",
  orders: "Orders",
};

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** Sessions that can be used in a ratio: a known, positive count. */
const usable = (n: number | null | undefined): n is number => finite(n) && n > 0;

// ---------- the decomposition ----------

/**
 * Whole-percent shares of `values` (which add up to `total`) that add up to exactly 100: each is rounded down and the
 * rest handed out, one point each, in order of the largest fractions (largest remainder). Works with negative shares.
 */
export function roundShares(values: readonly number[], total: number): number[] {
  if (values.length === 0 || !finite(total) || total === 0) return values.map(() => 0);
  const exact = values.map((v) => (v / total) * 100);
  const floors = exact.map((e) => Math.floor(e + 1e-9));
  let left = 100 - floors.reduce((a, b) => a + b, 0);
  const order = exact
    .map((e, i) => ({ i, frac: e - floors[i] }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; left > 0 && order.length > 0; k = (k + 1) % order.length) {
    floors[order[k].i] += 1;
    left -= 1;
  }
  return floors.map((f) => (Object.is(f, -0) ? 0 : f));
}

type Decomposition = { factors: Factor[]; usesSessions: boolean; ratio: number; mainFactor: FactorKey | null };

/**
 * Revenue ratio as a product of factor ratios. With sessions in both periods: traffic (sessions), conversion
 * (orders per session) and average order (revenue per order). Without: orders and average order. Null when a log
 * cannot be taken: revenue or orders zero (or less) in either period.
 */
export function decompose(current: PeriodFigures, previous: PeriodFigures): Decomposition | null {
  const { revenueMinor: r1, orders: o1 } = current;
  const { revenueMinor: r0, orders: o0 } = previous;
  if (!finite(r1) || !finite(r0) || !finite(o1) || !finite(o0) || r1 <= 0 || r0 <= 0 || o1 <= 0 || o0 <= 0) return null;
  const usesSessions = usable(current.sessions) && usable(previous.sessions);
  const ratios: { key: FactorKey; ratio: number }[] = [];
  const basket = r1 / o1 / (r0 / o0);
  if (usesSessions) {
    const s1 = current.sessions as number;
    const s0 = previous.sessions as number;
    ratios.push({ key: "traffic", ratio: s1 / s0 }, { key: "conversion", ratio: o1 / s1 / (o0 / s0) }, { key: "basket", ratio: basket });
  } else {
    ratios.push({ key: "orders", ratio: o1 / o0 }, { key: "basket", ratio: basket });
  }
  const total = Math.log(r1 / r0);
  const flat = Math.abs(r1 / r0 - 1) < FLAT_BAND;
  const logs = ratios.map((x) => Math.log(x.ratio));
  const shares = flat ? null : roundShares(logs, total);
  const factors: Factor[] = ratios.map((x, i) => ({
    key: x.key,
    label: FACTOR_LABEL[x.key],
    changePct: x.ratio - 1,
    sharePct: shares ? shares[i] : null,
  }));
  let main: FactorKey | null = null;
  if (shares) {
    let best = -Infinity;
    factors.forEach((f) => {
      if ((f.sharePct as number) > best) {
        best = f.sharePct as number;
        main = f.key;
      }
    });
  }
  return { factors, usesSessions, ratio: r1 / r0, mainFactor: main };
}

// ---------- words ----------

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** `2026-09-12` as "12 September". */
export function dayText(day: string): string {
  return `${Number(day.slice(8, 10))} ${MONTH_NAMES[Number(day.slice(5, 7)) - 1]}`;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** "Traffic +3 %, conversion -11 %, average order -6 %." (changes in whole percent). */
function factorSentence(factors: readonly Factor[]): string {
  const parts = factors.map((f, i) => `${i === 0 ? f.label : lower(f.label)} ${formatSigned(f.changePct, 0)}`);
  return `${parts.join(", ")}.`;
}

/** Where on the page a segment sits in a sentence: "on mobile", "in the paid search channel", "in Norway", "in a product". */
function segmentPlace(dimension: SegmentDimension, label: string): string {
  switch (dimension) {
    case "device":
      return `on ${label.toLowerCase()}`;
    case "channel":
      return `in the ${label.toLowerCase()} channel`;
    case "market":
      return `in ${label}`;
    case "product":
      return `for ${label}`;
  }
}

function money(minor: number, ctx: { currency?: string; locale?: string }): string | null {
  if (!ctx.currency) return null;
  try {
    return formatAmount(Math.round(minor), ctx.currency, ctx.locale ?? "en");
  } catch {
    return null;
  }
}

/**
 * What happened inside one segment, in words that follow its own biggest factor ("conversion fell from 3.8 % to 2.9 %").
 * A segment that cannot be decomposed (nothing sold in one period) says so in revenue.
 */
function segmentMetric(row: SegmentRow, ctx: { currency?: string; locale?: string }): string {
  const d = decompose(row.current, row.previous);
  const verb = (a: number, b: number) => (b < a ? "fell" : "rose");
  if (d && d.mainFactor) {
    const f = d.factors.find((x) => x.key === d.mainFactor) as Factor;
    const c = row.current;
    const p = row.previous;
    if (f.key === "conversion") {
      return `conversion ${verb(p.orders / (p.sessions as number), c.orders / (c.sessions as number))} from ${formatPercent(p.orders / (p.sessions as number))} to ${formatPercent(c.orders / (c.sessions as number))}`;
    }
    if (f.key === "traffic") {
      return `sessions ${verb(p.sessions as number, c.sessions as number)} from ${formatCount(p.sessions)} to ${formatCount(c.sessions)}`;
    }
    if (f.key === "orders") {
      return `orders ${verb(p.orders, c.orders)} from ${formatCount(p.orders)} to ${formatCount(c.orders)}`;
    }
    const a0 = p.revenueMinor / p.orders;
    const a1 = c.revenueMinor / c.orders;
    const m0 = money(a0, ctx);
    const m1 = money(a1, ctx);
    return m0 && m1 ? `average order ${verb(a0, a1)} from ${m0} to ${m1}` : `average order ${verb(a0, a1)} ${formatPercent(Math.abs(f.changePct), 0)}`;
  }
  const { current: c, previous: p } = row;
  if (p.revenueMinor <= 0) return "there were no sales in the previous period";
  if (c.revenueMinor <= 0) return "there were no sales in this period";
  return `revenue ${verb(p.revenueMinor, c.revenueMinor)} ${formatPercent(Math.abs(c.revenueMinor / p.revenueMinor - 1), 0)}`;
}

// ---------- segments ----------

const DIMENSION_ORDER: readonly SegmentDimension[] = ["device", "channel", "market", "product"];

function moversOf(tables: readonly SegmentTable[] | undefined, changeMinor: number): { mover: SegmentMover; row: SegmentRow }[] {
  if (!tables || changeMinor === 0) return [];
  const out: { mover: SegmentMover; row: SegmentRow }[] = [];
  for (const table of tables) {
    const rows = table.rows
      .filter((r) => finite(r.current.revenueMinor) && finite(r.previous.revenueMinor))
      .filter((r) => Math.max(r.current.orders, r.previous.orders) >= MIN_SEGMENT_ORDERS)
      .map((row) => {
        const delta = row.current.revenueMinor - row.previous.revenueMinor;
        return { row, delta, share: Math.round((delta / changeMinor) * 100) };
      })
      // Only segments moving the way revenue moved explain it; the rest work against it.
      .filter((x) => x.delta !== 0 && Math.sign(x.delta) === Math.sign(changeMinor) && x.share >= MIN_SEGMENT_SHARE)
      .sort((a, b) => b.share - a.share || a.row.key.localeCompare(b.row.key, "en"))
      .slice(0, MAX_SEGMENTS_PER_DIMENSION);
    for (const x of rows) {
      out.push({ row: x.row, mover: { dimension: table.dimension, label: x.row.label, key: x.row.key, changeMinor: x.delta, shareOfChangePct: x.share } });
    }
  }
  return out.sort(
    (a, b) =>
      b.mover.shareOfChangePct - a.mover.shareOfChangePct ||
      DIMENSION_ORDER.indexOf(a.mover.dimension) - DIMENSION_ORDER.indexOf(b.mover.dimension) ||
      a.mover.key.localeCompare(b.mover.key, "en"),
  );
}

// ---------- when it started ----------

/**
 * The first day of a sustained move, or null when it is not clear. 7-day averages of the period's days are
 * compared with the previous period's daily mean: the move is the run of averages, ending with the period's last day,
 * that all sit at least `TIMING_THRESHOLD` from it in the direction of the change. It must be at least
 * `TIMING_MIN_WINDOWS` long, and must not cover every average (then it began before the period). The start is the
 * first day, in the first average of the run, that is itself beyond the threshold.
 */
export function movedOn(
  daily: readonly { day: string; revenueMinor: number }[] | undefined,
  previousMeanMinor: number,
  direction: "up" | "down",
): string | null {
  if (!daily || !(previousMeanMinor > 0)) return null;
  const perDay = new Map<string, number>();
  for (const d of daily) {
    if (isDay(d.day) && finite(d.revenueMinor)) perDay.set(d.day, (perDay.get(d.day) ?? 0) + d.revenueMinor);
  }
  const days = [...perDay.keys()].sort();
  if (days.length < TIMING_MIN_DAYS) return null;
  // The series must be one unbroken run of days: a gap is not a quiet day.
  for (let i = 1; i < days.length; i++) if (daysBetween(days[i - 1], days[i]) !== 1) return null;
  const values = days.map((d) => perDay.get(d) as number);
  const sign = direction === "up" ? 1 : -1;
  const beyond = (v: number) => sign * (v / previousMeanMinor - 1) >= TIMING_THRESHOLD - 1e-9;
  const windows: boolean[] = [];
  for (let end = TIMING_WINDOW_DAYS - 1; end < values.length; end++) {
    let sum = 0;
    for (let k = end - TIMING_WINDOW_DAYS + 1; k <= end; k++) sum += values[k];
    windows.push(beyond(sum / TIMING_WINDOW_DAYS));
  }
  let run = 0;
  while (run < windows.length && windows[windows.length - 1 - run]) run += 1;
  if (run < TIMING_MIN_WINDOWS || run === windows.length) return null;
  const firstEnd = TIMING_WINDOW_DAYS - 1 + (windows.length - run);
  for (let k = firstEnd - TIMING_WINDOW_DAYS + 1; k <= firstEnd; k++) {
    if (beyond(values[k])) return days[k];
  }
  return null;
}

// ---------- where to look ----------

/** The page and words for the place to look, from the main factor and the segments found. Refunds are not covered here. */
export function lookAtFor(main: FactorKey | null, movers: readonly SegmentMover[]): LookAt | null {
  const has = (dimension: SegmentDimension) => movers.some((m) => m.dimension === dimension);
  switch (main) {
    case "conversion":
      if (has("device")) return { text: "Conversion by device, in the Traffic page's device table", href: "/analytics/traffic" };
      if (has("channel")) return { text: "Conversion by channel, in the Marketing page's channel table", href: "/analytics/marketing" };
      return { text: "The funnel on the Traffic page", href: "/analytics/traffic" };
    case "traffic":
      return { text: "Where visits come from, in the Marketing page's channel table", href: "/analytics/marketing" };
    case "basket":
      return { text: "The product mix on the Products page", href: "/analytics/products" };
    case "orders":
      if (has("channel")) return { text: "Orders by channel, in the Marketing page's channel table", href: "/analytics/marketing" };
      if (has("product")) return { text: "Orders by product on the Products page", href: "/analytics/products" };
      return null;
    default:
      return null;
  }
}

// ---------- the explanation ----------

const unknown = (base: Omit<ChangeExplanation, "direction" | "sentences" | "reason" | "factors" | "mainFactor" | "segments" | "startedOn" | "lookAt" | "note">, reason: string): ChangeExplanation => ({
  ...base,
  direction: "unknown",
  factors: [],
  mainFactor: null,
  segments: [],
  startedOn: null,
  sentences: [reason],
  lookAt: null,
  reason,
  note: null,
});

/**
 * Explains the change in net revenue between two periods. See the module comment and `ChangeExplanation`. With no
 * orders in a period, or revenue of zero or less, nothing is explained (`unknown`, with the reason); the change in
 * revenue is still given.
 */
export function explainChange(input: ChangeInput): ChangeExplanation {
  const { current, previous } = input;
  const changeMinor = current.revenueMinor - previous.revenueMinor;
  const changePct = previous.revenueMinor === 0 ? null : changeMinor / Math.abs(previous.revenueMinor);
  const lowVolume = current.orders < LOW_VOLUME_ORDERS || previous.orders < LOW_VOLUME_ORDERS;
  const base = { changeMinor, changePct, lowVolume };

  if (![current.revenueMinor, previous.revenueMinor, current.orders, previous.orders].every(finite)) {
    return unknown({ ...base, changeMinor: 0, changePct: null, lowVolume: true }, "The figures for a period are missing, so the change cannot be explained.");
  }
  if (previous.orders <= 0 && current.orders <= 0) return unknown(base, "There were no orders in either period, so there is nothing to explain.");
  if (previous.orders <= 0) return unknown(base, "There were no orders in the previous period, so there is nothing to compare with.");
  if (current.orders <= 0) return unknown(base, "There were no orders in this period, so there is nothing to explain beyond the fall itself.");
  if (previous.revenueMinor <= 0 || current.revenueMinor <= 0) {
    return unknown(base, "Net revenue was zero or negative in a period (refunds are larger than sales), so the change cannot be split into factors.");
  }

  const d = decompose(current, previous) as Decomposition;
  const ratio = d.ratio;
  const direction: "up" | "down" | "flat" = Math.abs(ratio - 1) < FLAT_BAND ? "flat" : ratio > 1 ? "up" : "down";
  const word = direction === "up" ? "up" : "down";

  const sentences: string[] = [];
  sentences.push(
    direction === "flat"
      ? `Revenue is about level with the previous period (${formatSigned(ratio - 1)}).`
      : `Revenue is ${word} ${formatPercent(Math.abs(ratio - 1), 0)} on the previous period.`,
  );
  sentences.push(factorSentence(d.factors));

  let note: string | null = null;
  if (!d.usesSessions) {
    note = "Visits were not counted in both periods, so traffic and conversion are not separated: only orders and average order are.";
  }
  if (lowVolume) {
    const few = `Based on few orders (${formatCount(current.orders)} now, ${formatCount(previous.orders)} before), so this may be chance.`;
    note = note ? `${note} ${few}` : few;
  }

  let movers: { mover: SegmentMover; row: SegmentRow }[] = [];
  let startedOn: string | null = null;
  if (direction !== "flat" && !lowVolume) {
    movers = moversOf(input.segments, changeMinor);
    const days = input.previousDays ?? input.daily?.length ?? 0;
    if (days > 0) startedOn = movedOn(input.daily, previous.revenueMinor / days, direction);
  }

  if (direction !== "flat") {
    const noun = direction === "down" ? "fall" : "rise";
    const ctx = { currency: input.currency, locale: input.locale };
    const [first, second] = movers;
    if (first) {
      sentences.push(`The biggest ${noun} is ${segmentPlace(first.mover.dimension, first.row.label)}, where ${segmentMetric(first.row, ctx)}.`);
      const other = movers.find((m) => m.mover.dimension !== first.mover.dimension) ?? (second && second !== first ? second : undefined);
      if (other) {
        sentences.push(`Another large part is ${segmentPlace(other.mover.dimension, other.row.label)}, where ${segmentMetric(other.row, ctx)}.`);
      }
    }
    if (startedOn) sentences.push(`The move began around ${dayText(startedOn)}.`);
  }
  if (note) sentences.push(note);

  const moverList = movers.map((m) => m.mover);
  return {
    ...base,
    direction,
    factors: d.factors,
    mainFactor: d.mainFactor,
    segments: moverList,
    startedOn,
    sentences,
    lookAt: direction === "flat" ? null : lookAtFor(d.mainFactor, moverList),
    reason: null,
    note,
  };
}
