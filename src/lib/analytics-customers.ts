import { formatPercent, safeRatio } from "./analytics-core";

/**
 * Customer analytics (D152, docs/analytics.md): new and returning customers,
 * repeat purchase rate, purchase frequency, lifetime value, cohorts and RFM
 * segments. Pure: the server sums paid orders per customer (the "customer key"
 * of the doc) and hands the aggregates in; everything that is a rate, a score or a
 * verdict is worked out here, in code, never by a model.
 *
 * Amounts are minor units of the main currency, without VAT. Dates are ISO
 * instants. Months are `YYYY-MM` in the store's time zone, as SQL gives them.
 */

const DAY_MS = 86_400_000;

const finite = (n: unknown): n is number => typeof n === "number" && Number.isFinite(n);

/** An instant in ms, or null when it is not a date. */
function ms(value: string | Date | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const t = value instanceof Date ? value.getTime() : Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** One month in which a customer ordered: the orders they placed in it and what those came to. */
export type OrderMonth = {
  /** `YYYY-MM` in the store's time zone. */
  month: string;
  orders: number;
  revenueMinor: number;
};

/** One customer's paid orders to date. */
export type CustomerAggregate = {
  /** The customer key: `lower(coalesce(customers.email, orders.email))`. */
  key: string;
  /** Their first and last paid order, ISO. */
  firstOrderAt: string;
  lastOrderAt: string;
  /** Paid orders to date. */
  orders: number;
  /** Net revenue to date (without VAT, refunds taken off). */
  revenueMinor: number;
  /** Contribution to date, or null when the store has not entered the costs for their orders. */
  contributionMinor: number | null;
  /**
   * The date of their second paid order, null when they have only ever ordered once. Needed by `repeatRates()`;
   * left out where it is not.
   */
  secondOrderAt?: string | null;
  /** The months they ordered in, with orders and revenue in each. Needed by `buildCohorts()`; left out where it is not. */
  orderMonths?: readonly OrderMonth[];
};

// ---------------------------------------------------------------------------
// New and returning
// ---------------------------------------------------------------------------

/** A customer who ordered in a period: what they did in it, and when they first ordered at all. */
export type PeriodCustomer = {
  key: string;
  firstOrderAt: string;
  ordersInPeriod: number;
  /** Net revenue of those orders. */
  revenueMinor: number;
};

export type NewVsReturning = {
  newCustomers: number;
  returningCustomers: number;
  newOrders: number;
  returningOrders: number;
  newRevenueMinor: number;
  returningRevenueMinor: number;
  /** Returning customers over all who ordered; null with none. */
  returningShare: number | null;
  /** Returning customers' revenue over all revenue; null with none. */
  returningRevenueShare: number | null;
};

/**
 * Splits the customers who ordered in `[from, to)` into new (their first paid order is in it) and returning (it was
 * earlier). Customers with no orders in the period, or with a first order that is after it or not a date, are left
 * out: they did not order in it.
 */
export function newVsReturning(customers: readonly PeriodCustomer[], from: string | Date, to: string | Date): NewVsReturning {
  const start = ms(from);
  const end = ms(to);
  const out: NewVsReturning = {
    newCustomers: 0,
    returningCustomers: 0,
    newOrders: 0,
    returningOrders: 0,
    newRevenueMinor: 0,
    returningRevenueMinor: 0,
    returningShare: null,
    returningRevenueShare: null,
  };
  if (start === null || end === null) return out;
  for (const c of customers) {
    const first = ms(c.firstOrderAt);
    if (first === null || !(c.ordersInPeriod > 0) || first >= end) continue;
    if (first >= start) {
      out.newCustomers += 1;
      out.newOrders += c.ordersInPeriod;
      out.newRevenueMinor += c.revenueMinor;
    } else {
      out.returningCustomers += 1;
      out.returningOrders += c.ordersInPeriod;
      out.returningRevenueMinor += c.revenueMinor;
    }
  }
  out.returningShare = safeRatio(out.returningCustomers, out.newCustomers + out.returningCustomers);
  out.returningRevenueShare = safeRatio(out.returningRevenueMinor, out.newRevenueMinor + out.returningRevenueMinor);
  return out;
}

// ---------------------------------------------------------------------------
// Repeat purchase rate and frequency
// ---------------------------------------------------------------------------

/** The windows the doc defines: 30, 90, 180 and 365 days. */
export const REPEAT_WINDOWS = [30, 90, 180, 365] as const;

export type RepeatRate = {
  days: number;
  /** Customers whose first order is at least `days` old: only they have had the time to buy again. */
  base: number;
  /** Of them, those whose second order came within `days` of their first (inclusive). */
  repeaters: number;
  /** repeaters / base; null with an empty base. */
  rate: number | null;
};

/** The two dates of a customer's life that a repeat rate needs. `secondOrderAt` null means they never ordered again. */
export type RepeatCustomer = { firstOrderAt: string; secondOrderAt: string | null };

/**
 * Repeat purchase rate for each window, as the doc defines it: of the customers whose first order is at least N days
 * old at `now`, the share who bought again within N days of it. A second order dated before the first is bad data and
 * is treated as no second order; a customer with no usable first order is left out.
 */
export function repeatRates(customers: readonly RepeatCustomer[], now: string | Date, windows: readonly number[] = REPEAT_WINDOWS): RepeatRate[] {
  const current = ms(now);
  const parsed = customers.flatMap((c) => {
    const first = ms(c.firstOrderAt);
    if (first === null) return [];
    const second = ms(c.secondOrderAt);
    return [{ first, gap: second !== null && second >= first ? second - first : null }];
  });
  return windows.map((days) => {
    let base = 0;
    let repeaters = 0;
    if (current !== null) {
      for (const c of parsed) {
        if (current - c.first < days * DAY_MS) continue;
        base += 1;
        if (c.gap !== null && c.gap <= days * DAY_MS) repeaters += 1;
      }
    }
    return { days, base, repeaters, rate: safeRatio(repeaters, base) };
  });
}

/** Paid orders in the last 365 days over distinct customers in them; null with no customers. */
export function purchaseFrequency(orders365: number, customers365: number): number | null {
  return safeRatio(orders365, customers365);
}

// ---------------------------------------------------------------------------
// Lifetime value
// ---------------------------------------------------------------------------

export type HistoricLtv = {
  customers: number;
  /** Mean net revenue per customer to date, rounded; null with no customers. */
  revenueMinor: number | null;
  /** Mean contribution per customer to date over the customers whose costs are known, rounded; null when none are. */
  contributionMinor: number | null;
  /** The share of customers whose contribution is known: the contribution figure is only as good as this. */
  contributionCoverage: number | null;
};

/** What customers have been worth so far: the mean of what each has brought in, and of what each has left after costs. */
export function ltvHistoric(customers: readonly Pick<CustomerAggregate, "revenueMinor" | "contributionMinor">[]): HistoricLtv {
  const usable = customers.filter((c) => finite(c.revenueMinor));
  const known = usable.filter((c) => finite(c.contributionMinor));
  const mean = (values: number[]) => (values.length === 0 ? null : Math.round(values.reduce((a, b) => a + b, 0) / values.length));
  return {
    customers: usable.length,
    revenueMinor: mean(usable.map((c) => c.revenueMinor)),
    contributionMinor: mean(known.map((c) => c.contributionMinor as number)),
    contributionCoverage: safeRatio(known.length, usable.length),
  };
}

export type PredictedLtvInput = {
  /**
   * Contribution of one order before marketing spend (acquisition cost is compared to it by LTV:CAC, so it must not be
   * taken off twice); null when costs are not entered.
   */
  contributionPerOrderMinor: number | null;
  /** Net revenue of one order; the fallback. */
  revenuePerOrderMinor: number | null;
  /** Orders per customer per year: the purchase frequency. */
  ordersPerYear: number | null;
  /** Years a customer is expected to stay (`ltv_lifespan_years`). */
  lifespanYears: number;
};

export type PredictedLtv = {
  /** Null when something needed is missing. */
  minor: number | null;
  /** Which amount it is made of; null when there was none to use. */
  basis: "contribution" | "revenue" | null;
  /** What to call the figure, saying which basis it is. */
  label: string;
};

/**
 * Predicted lifetime value: an order's contribution times orders per year times the years a customer stays. With no
 * costs entered (no contribution) the order's revenue is used instead and the label says so: a revenue figure is never
 * passed off as profit. A contribution that is known but negative is used as it is.
 */
export function ltvPredicted(input: PredictedLtvInput): PredictedLtv {
  const { contributionPerOrderMinor: contribution, revenuePerOrderMinor: revenue, ordersPerYear, lifespanYears } = input;
  const basis = finite(contribution) ? "contribution" : finite(revenue) ? "revenue" : null;
  const label = basis === "contribution" ? "Predicted lifetime contribution" : basis === "revenue" ? "Predicted lifetime revenue (costs not entered)" : "Predicted lifetime value";
  const perOrder = basis === "contribution" ? contribution : basis === "revenue" ? revenue : null;
  if (perOrder === null || !finite(ordersPerYear) || ordersPerYear <= 0 || !finite(lifespanYears) || lifespanYears <= 0) return { minor: null, basis, label };
  return { minor: Math.round(perOrder * ordersPerYear * lifespanYears), basis, label };
}

// ---------------------------------------------------------------------------
// Cohorts
// ---------------------------------------------------------------------------

/**
 * The months after the first purchase that a cohort table shows, 0 being the month of the first purchase itself. The
 * table is cumulative: month 3 is "bought again at some time up to the end of month 3".
 */
export const COHORT_OFFSETS = [0, 1, 2, 3, 6, 12] as const;

/** A customer for the cohort table: `orderMonths` says everything. */
export type CohortCustomer = { orderMonths: readonly OrderMonth[] };

export type CohortRow = {
  /** The month of the first purchase, `YYYY-MM`. */
  cohort: string;
  /** Customers whose first purchase was in it. */
  size: number;
  /** For each offset of the table: how many bought again (2 or more orders in months 0 to the offset); null until the offset's month is over. */
  repeaters: (number | null)[];
  /** `repeaters / size`. */
  retention: (number | null)[];
  /** Cumulative net revenue to the end of the offset's month, per customer of the cohort, rounded. */
  revenuePerCustomerMinor: (number | null)[];
};

export type CohortTable = {
  /** The offsets of every row's arrays, `COHORT_OFFSETS` up to `maxMonths`. */
  offsets: number[];
  /** Oldest cohort first. */
  rows: CohortRow[];
};

const MONTH = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** A month's number on one line (`2026-10` is 24 321), or null when it is not a month. */
function monthIndex(month: string): number | null {
  const match = MONTH.exec(month);
  return match ? Number(match[1]) * 12 + Number(match[2]) - 1 : null;
}

const monthName = (index: number): string => `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, "0")}`;

/**
 * A cohort table: customers grouped by the month of their first purchase (their earliest month in `orderMonths`), and
 * for each of `COHORT_OFFSETS` up to `maxMonths` how many of them had bought again by the end of that month and what
 * each had spent. An offset is shown only when its month is over: a cohort's month 1 is null until the month after
 * the cohort's has ended, never a figure that is still growing. Only the latest `maxCohorts` months with new
 * customers are shown, oldest first. Customers with no valid month are left out.
 *
 * `now` is the store's today: a `YYYY-MM-DD` or `YYYY-MM` string (what the store's clock says, not UTC's), or a Date
 * read in UTC.
 */
export function buildCohorts(customers: readonly CohortCustomer[], now: string | Date, maxCohorts = 12, maxMonths = 12): CohortTable {
  const nowIndex = typeof now === "string" ? monthIndex(now.slice(0, 7)) : monthIndex(now.toISOString().slice(0, 7));
  const offsets = COHORT_OFFSETS.filter((o) => o <= maxMonths);
  const groups = new Map<number, { month: number; orders: number; revenue: number }[][]>();
  for (const customer of customers) {
    const months = new Map<number, { month: number; orders: number; revenue: number }>();
    for (const m of customer.orderMonths ?? []) {
      const index = monthIndex(m.month);
      if (index === null || !finite(m.orders) || m.orders <= 0) continue;
      const had = months.get(index);
      if (had) {
        had.orders += m.orders;
        had.revenue += finite(m.revenueMinor) ? m.revenueMinor : 0;
      } else {
        months.set(index, { month: index, orders: m.orders, revenue: finite(m.revenueMinor) ? m.revenueMinor : 0 });
      }
    }
    if (months.size === 0) continue;
    const list = [...months.values()].sort((a, b) => a.month - b.month);
    const cohort = list[0].month;
    (groups.get(cohort) ?? groups.set(cohort, []).get(cohort)!).push(list);
  }
  const cohorts = [...groups.keys()].sort((a, b) => a - b).slice(Math.max(0, groups.size - Math.max(0, maxCohorts)));
  const rows = cohorts.map((cohort): CohortRow => {
    const members = groups.get(cohort)!;
    const repeaters: (number | null)[] = [];
    const revenue: (number | null)[] = [];
    for (const offset of offsets) {
      if (nowIndex === null || cohort + offset >= nowIndex) {
        repeaters.push(null);
        revenue.push(null);
        continue;
      }
      let again = 0;
      let spent = 0;
      for (const list of members) {
        let orders = 0;
        for (const m of list) {
          if (m.month > cohort + offset) break;
          orders += m.orders;
          spent += m.revenue;
        }
        if (orders >= 2) again += 1;
      }
      repeaters.push(again);
      revenue.push(Math.round(spent / members.length));
    }
    return {
      cohort: monthName(cohort),
      size: members.length,
      repeaters,
      retention: repeaters.map((r) => (r === null ? null : r / members.length)),
      revenuePerCustomerMinor: revenue,
    };
  });
  return { offsets, rows };
}

/** A cohort needs this many customers to count in a comparison. */
export const MIN_COHORT_SIZE = 20;
/** Each side of a comparison (newer and older cohorts) needs this many customers in all. */
export const MIN_TREND_CUSTOMERS = 100;
/** And at least this many cohorts, so that one odd month is not a trend. */
export const MIN_TREND_COHORTS = 2;
/** A difference counts when it is this many standard errors (a two-sided 95 % level). */
export const TREND_Z = 1.96;

export type CohortTrend = {
  verdict: "better" | "worse" | "flat" | "unknown";
  /** The month offset compared (the latest one with enough cohorts and customers); null when unknown. */
  offset: number | null;
  /** Share who bought again by the offset: the newer cohorts together, and the older. */
  recentRate: number | null;
  olderRate: number | null;
  /** Newer minus older, as a ratio (0.05 is 5 points). */
  diff: number | null;
  recentCohorts: string[];
  olderCohorts: string[];
  /** One templated sentence. */
  sentence: string;
};

const UNKNOWN_TREND: CohortTrend = {
  verdict: "unknown",
  offset: null,
  recentRate: null,
  olderRate: null,
  diff: null,
  recentCohorts: [],
  olderCohorts: [],
  sentence: "Not enough customers yet to say whether newer customers come back more or less than older ones.",
};

/**
 * Whether recent cohorts keep customers better than older ones. At one month offset (the latest at which enough
 * data exists, never month 0) the cohorts that have reached it, and have `MIN_COHORT_SIZE` customers, are split in
 * time: the earlier half is "older", the rest "newer". Each side is pooled (total repeaters over total customers) and
 * needs `MIN_TREND_CUSTOMERS` customers and `MIN_TREND_COHORTS` cohorts. The two shares differ when a two-proportion
 * z-test is beyond `TREND_Z`; otherwise the verdict is "flat". With too little data it is "unknown", never a guess.
 */
export function cohortTrend(table: CohortTable): CohortTrend {
  const candidates = table.offsets.map((offset, i) => ({ offset, i })).filter(({ offset }) => offset >= 1).reverse();
  for (const { offset, i } of candidates) {
    const eligible = table.rows.filter((r) => r.size >= MIN_COHORT_SIZE && r.repeaters[i] !== null && r.repeaters[i] !== undefined);
    if (eligible.length < MIN_TREND_COHORTS * 2) continue;
    const half = Math.floor(eligible.length / 2);
    const older = eligible.slice(0, half);
    const recent = eligible.slice(half);
    const sum = (rows: CohortRow[], pick: (r: CohortRow) => number) => rows.reduce((a, r) => a + pick(r), 0);
    const olderSize = sum(older, (r) => r.size);
    const recentSize = sum(recent, (r) => r.size);
    if (olderSize < MIN_TREND_CUSTOMERS || recentSize < MIN_TREND_CUSTOMERS) continue;
    const olderRepeat = sum(older, (r) => r.repeaters[i] as number);
    const recentRepeat = sum(recent, (r) => r.repeaters[i] as number);
    const olderRate = olderRepeat / olderSize;
    const recentRate = recentRepeat / recentSize;
    const diff = recentRate - olderRate;
    const pooled = (olderRepeat + recentRepeat) / (olderSize + recentSize);
    const se = Math.sqrt(pooled * (1 - pooled) * (1 / olderSize + 1 / recentSize));
    const significant = se > 0 && Math.abs(diff) / se >= TREND_Z;
    const verdict = !significant ? "flat" : diff > 0 ? "better" : "worse";
    const figures = `${formatPercent(recentRate, 0)} of newer customers had bought again by month ${offset}, against ${formatPercent(olderRate, 0)} of older ones`;
    const sentence =
      verdict === "better"
        ? `Newer customers come back more often: ${figures}.`
        : verdict === "worse"
          ? `Newer customers come back less often: ${figures}.`
          : `Newer and older customers come back about as often: ${figures}.`;
    return {
      verdict,
      offset,
      recentRate,
      olderRate,
      diff,
      recentCohorts: recent.map((r) => r.cohort),
      olderCohorts: older.map((r) => r.cohort),
      sentence,
    };
  }
  return UNKNOWN_TREND;
}

// ---------------------------------------------------------------------------
// RFM
// ---------------------------------------------------------------------------

/** Below this many customers, segments are not worth showing: the page says so. */
export const RFM_MIN_CUSTOMERS = 20;
/** A customer with one order, the last of them within this many days, is New. */
export const NEW_CUSTOMER_DAYS = 30;

export const RFM_SEGMENTS = ["VIP", "Loyal", "Promising", "New", "At risk", "Lost"] as const;
export type RfmSegment = (typeof RFM_SEGMENTS)[number];

export type RfmRow = {
  key: string;
  /** Whole days since their last order at `now`, never negative. */
  recencyDays: number;
  orders: number;
  revenueMinor: number;
  /** 1 to 5, 5 being best: the most recent, the most orders, the most revenue. */
  r: number;
  f: number;
  m: number;
  /** `r`, `f` and `m` together: "545". */
  score: string;
  segment: RfmSegment;
};

/**
 * Quintile scores, 1 to 5, of values where a higher value is better, from rank percentiles. A value's percentile is
 * the share of all values below it plus half the share equal to it (equal values share the middle of their places, so
 * ties never favour or punish either end), and its score is `floor(5 × percentile) + 1`: 5 customers with different
 * values score 1 to 5 and 10 score two each. Equal values always share a score; when every value is the same the
 * percentile is one half of everyone's and all score 3, which only says "no one stands out", so `segmentOf()` never
 * reads a 3 as good or bad (a score of 4 or 5 needs a value above the middle).
 */
export function quintileScores(values: readonly number[]): number[] {
  const n = values.length;
  if (n === 0) return [];
  const sorted = [...values].sort((a, b) => a - b);
  // For each distinct value: how many are below it and how many equal it.
  const below = new Map<number, { below: number; equal: number }>();
  for (let i = 0; i < n; ) {
    let j = i;
    while (j < n && sorted[j] === sorted[i]) j++;
    below.set(sorted[i], { below: i, equal: j - i });
    i = j;
  }
  return values.map((value) => {
    const place = below.get(value) as { below: number; equal: number };
    const percentile = (place.below + place.equal / 2) / n;
    return Math.min(5, Math.floor(5 * percentile + 1e-9) + 1);
  });
}

/**
 * The segment of a customer, the first rule that fits:
 *
 * - **VIP**: R, F and M all 4 or 5.
 * - **Loyal**: F 4 or 5 and R 3 or better.
 * - **New**: one order only, placed within `NEW_CUSTOMER_DAYS` days.
 * - **Promising**: R 3 or better (recent, but not yet frequent or big).
 * - **At risk**: R 1 or 2 with F or M 4 or 5 (good customers who have gone quiet).
 * - **Lost**: R 1 or 2 and nothing above the middle: long quiet, and few and small orders.
 *
 * At risk and Lost are only reached by being quiet (R 1 or 2): a recent customer is never either, and a score of 3
 * (the middle, which is also what a measure everyone shares gets) never makes someone a good customer who left, so a
 * store whose customers have all ordered once does not see them all as At risk.
 */
export function segmentOf(c: { r: number; f: number; m: number; orders: number; recencyDays: number }): RfmSegment {
  if (c.r >= 4 && c.f >= 4 && c.m >= 4) return "VIP";
  if (c.f >= 4 && c.r >= 3) return "Loyal";
  if (c.orders === 1 && c.recencyDays <= NEW_CUSTOMER_DAYS) return "New";
  if (c.r >= 3) return "Promising";
  if (c.f >= 4 || c.m >= 4) return "At risk";
  return "Lost";
}

/**
 * Recency, frequency and monetary scores and segments for every customer. Recency is days since the last order at
 * `now`, frequency is paid orders and monetary is net revenue to date, each scored by `quintileScores()` across these
 * customers. A customer whose last order is not a date is left out. Under `RFM_MIN_CUSTOMERS` the scores are valid but
 * thin, and the page should say so.
 */
export function rfm(customers: readonly Pick<CustomerAggregate, "key" | "lastOrderAt" | "orders" | "revenueMinor">[], now: string | Date): RfmRow[] {
  const current = ms(now);
  if (current === null) return [];
  const base = customers.flatMap((c) => {
    const last = ms(c.lastOrderAt);
    if (last === null) return [];
    return [{ key: c.key, recencyDays: Math.max(0, Math.floor((current - last) / DAY_MS)), orders: c.orders, revenueMinor: c.revenueMinor }];
  });
  const r = quintileScores(base.map((c) => -c.recencyDays));
  const f = quintileScores(base.map((c) => c.orders));
  const m = quintileScores(base.map((c) => c.revenueMinor));
  return base.map((c, i) => ({
    ...c,
    r: r[i],
    f: f[i],
    m: m[i],
    score: `${r[i]}${f[i]}${m[i]}`,
    segment: segmentOf({ r: r[i], f: f[i], m: m[i], orders: c.orders, recencyDays: c.recencyDays }),
  }));
}

export type SegmentSummary = {
  segment: RfmSegment;
  customers: number;
  /** Of all customers scored. */
  customerShare: number | null;
  revenueMinor: number;
  /** Of all revenue of the customers scored. */
  revenueShare: number | null;
  /** Mean revenue per customer, rounded; null with none. */
  averageRevenueMinor: number | null;
  averageOrders: number | null;
  averageRecencyDays: number | null;
};

/** Count, revenue and revenue share per segment, in the order of `RFM_SEGMENTS`, with an empty segment shown as zero customers. */
export function segmentSummary(rows: readonly RfmRow[]): SegmentSummary[] {
  const totalRevenue = rows.reduce((a, r) => a + r.revenueMinor, 0);
  return RFM_SEGMENTS.map((segment) => {
    const members = rows.filter((r) => r.segment === segment);
    const revenue = members.reduce((a, r) => a + r.revenueMinor, 0);
    const mean = (pick: (r: RfmRow) => number) => (members.length === 0 ? null : members.reduce((a, r) => a + pick(r), 0) / members.length);
    const averageRevenue = mean((r) => r.revenueMinor);
    const averageRecency = mean((r) => r.recencyDays);
    return {
      segment,
      customers: members.length,
      customerShare: safeRatio(members.length, rows.length),
      revenueMinor: revenue,
      revenueShare: safeRatio(revenue, totalRevenue),
      averageRevenueMinor: averageRevenue === null ? null : Math.round(averageRevenue),
      averageOrders: mean((r) => r.orders),
      averageRecencyDays: averageRecency === null ? null : Math.round(averageRecency),
    };
  });
}
