/**
 * The demand forecast for reordering (`docs/100-day-challenge.md` C4, D636): how many units of a variant will sell per day over the days
 * ahead, from its own paid sales, and how many to order. Four things move it beyond a flat pace:
 *
 * - the recent weeks weigh more than older ones (`WEEK_WEIGHT` a week older);
 * - the season, once there is a year of sales: how the same days last year compared with the weeks before them (`seasonFactor()`);
 * - a campaign planned in the days ahead, by the lift this product itself had in the store's past campaigns (`campaignLift()`);
 * - the supplier's real delivery time, from received purchase orders (`observedLeadDays()`), and a safety stock for the days' ups and downs.
 *
 * Each adjustment is used only with enough data behind it, clamped, and named in `reasons` so the owner and the AI see why. Pure arithmetic;
 * the server reads the figures (`src/server/owner-insights.ts`).
 */

/** How much a week counts against the week after it in the pace. */
export const WEEK_WEIGHT = 0.85;
/** A year's season is used only with this many units in last year's matching weeks before. */
export const SEASON_MIN_UNITS = 10;
export const SEASON_CLAMP = { min: 0.5, max: 2.5 } as const;
/** A campaign's lift is measured over this many days back, and used only with this many campaign days and units sold on them. */
export const LIFT_DAYS = 180;
export const LIFT_MIN_DAYS = 7;
export const LIFT_MIN_UNITS = 5;
export const LIFT_CLAMP = { min: 1, max: 3 } as const;
/** Received purchase orders needed for the supplier's own delivery time. */
export const LEAD_MIN_ORDERS = 2;
/** The safety stock covers this share of the days' ups and downs over the delivery time (one-sided, about 95 %). */
export const SAFETY_Z = 1.65;

const round1 = (x: number) => Math.round(x * 10) / 10;
const clamp = (x: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, x));
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

/** Units per day from daily sales (oldest first), the latest weeks weighing more; a part-week at the start counts as a short week. */
export function weightedPace(daily: readonly number[]): number {
  if (daily.length === 0) return 0;
  let weighted = 0;
  let weights = 0;
  for (let end = daily.length, age = 0; end > 0; end -= 7, age++) {
    const week = daily.slice(Math.max(0, end - 7), end);
    const w = WEEK_WEIGHT ** age;
    weighted += w * sum(week);
    weights += w * week.length;
  }
  return weights > 0 ? weighted / weights : 0;
}

/** The standard deviation of daily sales, for the safety stock. */
export function dailySpread(daily: readonly number[]): number {
  if (daily.length < 2) return 0;
  const mean = sum(daily) / daily.length;
  return Math.sqrt(sum(daily.map((d) => (d - mean) ** 2)) / (daily.length - 1));
}

/**
 * The season: last year's units in the days ahead (`ahead`, the same calendar days a year back) against last year's units in the days before
 * them (`before`, as many days as the pace was taken from), per day. Null without enough of last year to say.
 */
export function seasonFactor(lastYear: { before: readonly number[]; ahead: readonly number[] }): number | null {
  const before = sum(lastYear.before);
  if (lastYear.before.length === 0 || lastYear.ahead.length === 0 || before < SEASON_MIN_UNITS) return null;
  const perDayBefore = before / lastYear.before.length;
  const perDayAhead = sum(lastYear.ahead) / lastYear.ahead.length;
  return round1(clamp(perDayAhead / perDayBefore, SEASON_CLAMP));
}

/** This product's lift in the store's past campaigns: units per day on days a campaign reached it against days none did. Null without enough. */
export function campaignLift(daily: readonly number[], onCampaign: readonly boolean[]): number | null {
  const on = daily.filter((_, i) => onCampaign[i]);
  const off = daily.filter((_, i) => !onCampaign[i]);
  if (on.length < LIFT_MIN_DAYS || off.length < LIFT_MIN_DAYS || sum(on) < LIFT_MIN_UNITS) return null;
  const offPace = sum(off) / off.length;
  if (offPace <= 0) return null;
  return round1(clamp(sum(on) / on.length / offPace, LIFT_CLAMP));
}

/** The supplier's delivery time from received purchase orders (days from ordered to received), the median, rounded up. Null with too few. */
export function observedLeadDays(days: readonly number[]): number | null {
  if (days.length < LEAD_MIN_ORDERS) return null;
  const sorted = [...days].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  // To a tenth of a day first: a time a few seconds past a whole day is that day.
  return Math.max(0, Math.ceil(Math.round(median * 10) / 10));
}

export type ForecastInput = {
  /** Paid units per day over the pace's days, oldest first. */
  daily: readonly number[];
  /** Last year's units per day: the pace's days a year back, and the days ahead a year back; empty without a year of sales. */
  lastYear: { before: readonly number[]; ahead: readonly number[] };
  /** Units per day and whether a campaign reached the product, over the last `LIFT_DAYS`, oldest first. */
  liftDaily: readonly number[];
  liftOnCampaign: readonly boolean[];
  /** The share of the days ahead (cover and delivery) a planned campaign reaches the product, 0 to 1. */
  plannedCampaignShare: number;
  /** Days from ordered to received of the variant's received purchase orders. */
  leadSamples: readonly number[];
  /** The delivery time to use without enough received orders. */
  leadDaysAsked: number;
  coverDays: number;
  onHand: number;
};

export type Forecast = {
  perDay: number;
  leadDays: number;
  safety: number;
  lastsDays: number | null;
  orderNow: boolean;
  suggested: number;
  /** Each adjustment used, in words, such as "the season: ×1.4 from last year". */
  reasons: string[];
};

/** The forecast and the suggested order: the pace × season × planned campaigns over cover and delivery, plus safety stock, less what is on hand. */
export function forecast(input: ForecastInput): Forecast {
  const reasons: string[] = [];
  const pace = weightedPace(input.daily);
  const season = seasonFactor(input.lastYear);
  if (season !== null && season !== 1) reasons.push(`the season: ×${season} from the same days last year`);
  const lift = input.plannedCampaignShare > 0 ? campaignLift(input.liftDaily, input.liftOnCampaign) : null;
  const campaign = lift !== null ? 1 + (lift - 1) * clamp(input.plannedCampaignShare, { min: 0, max: 1 }) : 1;
  if (lift !== null && lift > 1) reasons.push(`a planned campaign: ×${round1(campaign)} (this product sold ×${lift} in past campaigns)`);
  else if (lift !== null) reasons.push("a planned campaign: this product sold no more in past campaigns");
  else if (input.plannedCampaignShare > 0) reasons.push("a planned campaign, too few past campaigns to measure its lift");
  const observed = observedLeadDays(input.leadSamples);
  const leadDays = observed ?? input.leadDaysAsked;
  if (observed !== null) reasons.push(`delivery: ${observed} days, as the supplier's last received orders took`);
  const perDay = pace * (season ?? 1) * campaign;
  const safety = Math.ceil(SAFETY_Z * dailySpread(input.daily) * Math.sqrt(Math.max(leadDays, 0)) * (season ?? 1));
  const stock = Math.max(0, input.onHand);
  const need = Math.ceil(perDay * (input.coverDays + leadDays)) + safety;
  return {
    perDay: round1(perDay),
    leadDays,
    safety,
    lastsDays: perDay > 0 ? round1(stock / perDay) : null,
    orderNow: perDay > 0 && stock <= perDay * leadDays + safety,
    // On hand below zero is units owed to customers (sold on backorder): they are added to what to order.
    suggested: Math.max(0, need - input.onHand),
    reasons,
  };
}
