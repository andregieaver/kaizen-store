import { z } from "zod";

import { formatMoney, minorUnitDigits } from "./money";

/**
 * Ad budgets moved inside the owner's own ad account (D585, step 1 of `docs/agent-spending.md`): the platform bills the owner as it always
 * has; Kaizena Flow reads what the account spends and changes a campaign's or an ad set's daily budget or switches it, within the monthly
 * limit the owner set. Pure: the platform's answers read, budgets listed, the month's spend projected and a change judged. Meta first;
 * Google Ads and TikTok are later steps.
 */

export const AD_ACCOUNT_PLATFORMS = ["meta"] as const;
export type AdAccountPlatform = (typeof AD_ACCOUNT_PLATFORMS)[number];

/** Meta's Marketing API, one version for every call (each version lives about two years). */
export const META_API = "https://graph.facebook.com/v24.0";

/**
 * Currencies an ad account may be in: ours (`money.ts`) whose minor unit Meta counts as we do (an offset of 100). HUF is ours, but Meta
 * counts it in whole forints, so an account in it is refused rather than read a hundred times wrong.
 */
export const AD_CURRENCIES: readonly string[] = ["EUR", "SEK", "DKK", "NOK", "PLN", "CZK", "RON", "CHF", "GBP", "USD"];

/** The account number from what the owner typed: digits, with or without Meta's `act_`. */
export function metaAccountNumber(text: string): string | null {
  const match = /^(?:act_)?(\d{5,20})$/i.exec(text.trim());
  return match ? match[1] : null;
}

/** Where the owner manages the account's campaigns themselves. */
export const adsManagerLink = (account: string) => `https://adsmanager.facebook.com/adsmanager/manage/campaigns?act=${encodeURIComponent(account)}`;

// The platform's answers, read as narrowly as they are used. Meta writes budgets in minor units as text, spend in major units as text.
const digits = z.string().regex(/^\d{1,15}$/);
export const metaAccountSchema = z.object({
  name: z.string().min(1).max(200),
  currency: z.string().regex(/^[A-Z]{3}$/),
  timezone_name: z.string().min(1).max(64),
  account_status: z.number().int(),
});
const metaObject = z.object({
  id: digits,
  name: z.string().max(400).default(""),
  status: z.string().max(40),
  daily_budget: digits.optional(),
  lifetime_budget: digits.optional(),
});
export const metaCampaignsSchema = z.object({ data: z.array(metaObject) });
export const metaAdSetsSchema = z.object({ data: z.array(metaObject.extend({ campaign_id: digits })) });
export const metaInsightsSchema = z.object({ data: z.array(z.object({ spend: z.string().optional(), campaign_id: digits.optional() })) });
export const metaErrorSchema = z.object({ error: z.object({ code: z.number().int().optional() }) });

/** An account Meta says is active (1); every other status (disabled, unsettled, under review, closing) runs no ads. */
export const META_ACTIVE = 1;

/** A spend Meta wrote in major units ("123.45") as minor units of the account's currency, rounded half up; null when it is not a number. */
export function spendMinor(text: string | undefined, currency: string): number | null {
  if (text === undefined || text === "") return 0;
  const match = /^(\d{1,13})(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return null;
  const places = minorUnitDigits(currency);
  const fraction = (match[2] ?? "").padEnd(places + 1, "0");
  const minor = Number(match[1] + fraction.slice(0, places)) + (Number(fraction[places]) >= 5 ? 1 : 0);
  return Number.isSafeInteger(minor) ? minor : null;
}

/** One budget the account holds: a campaign's own (spread over its ad sets by Meta), or an ad set's where its campaign has none. */
export type AdBudget = {
  id: string;
  kind: "campaign" | "ad_set";
  name: string;
  /** The campaign's name, for an ad set's budget. */
  campaign: string | null;
  /** Switched on, and its campaign too: it may spend today. */
  on: boolean;
  /** Its daily budget in minor units, or null for a lifetime budget (which this step never changes). */
  dailyMinor: number | null;
  lifetime: boolean;
  /** What its campaign spent this month (minor units); for an ad set, its campaign's whole spend. */
  spentMinor: number;
};

type Read<S extends z.ZodType> = z.output<S>;

/** The account's budgets, campaigns' first, each with what its campaign spent this month. Objects without a budget are left out. */
export function budgetsOf(
  campaigns: Read<typeof metaCampaignsSchema>["data"],
  adSets: Read<typeof metaAdSetsSchema>["data"],
  spend: Read<typeof metaInsightsSchema>["data"],
  currency: string,
): AdBudget[] {
  const spent = new Map<string, number>();
  for (const row of spend) if (row.campaign_id) spent.set(row.campaign_id, spendMinor(row.spend, currency) ?? 0);
  const byId = new Map(campaigns.map((c) => [c.id, c]));
  const out: AdBudget[] = [];
  for (const c of campaigns) {
    if (!c.daily_budget && !c.lifetime_budget) continue;
    out.push({
      id: c.id,
      kind: "campaign",
      name: c.name,
      campaign: null,
      on: c.status === "ACTIVE",
      dailyMinor: c.daily_budget ? Number(c.daily_budget) : null,
      lifetime: !c.daily_budget,
      spentMinor: spent.get(c.id) ?? 0,
    });
  }
  for (const a of adSets) {
    const parent = byId.get(a.campaign_id);
    if (!parent || parent.daily_budget || parent.lifetime_budget) continue;
    if (!a.daily_budget && !a.lifetime_budget) continue;
    out.push({
      id: a.id,
      kind: "ad_set",
      name: a.name,
      campaign: parent.name,
      on: a.status === "ACTIVE" && parent.status === "ACTIVE",
      dailyMinor: a.daily_budget ? Number(a.daily_budget) : null,
      lifetime: !a.daily_budget,
      spentMinor: spent.get(a.campaign_id) ?? 0,
    });
  }
  return out;
}

/** Days of the calendar month left in a time zone, today included (Meta counts a month in the account's own zone). */
export function daysLeftInMonth(now: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "numeric", day: "numeric" }).formatToParts(now);
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const [year, month, day] = [part("year"), part("month"), part("day")];
  const length = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return length - day + 1;
}

/** The daily budgets that may spend from today: on, and daily (a running lifetime budget makes the month's spend unknown). */
export const dailyOn = (budgets: readonly AdBudget[]) => budgets.reduce((sum, b) => sum + (b.on && b.dailyMinor !== null ? b.dailyMinor : 0), 0);

/**
 * About what the account spends this month at today's budgets: what it spent, and each daily budget that is on for every day left, today
 * included (so a little more than it will, as today is partly spent). Null when a lifetime budget is running, as its days cannot be told.
 */
export function projectedMonthMinor(spentMinor: number, budgets: readonly AdBudget[], daysLeft: number): number | null {
  if (budgets.some((b) => b.on && b.lifetime)) return null;
  return spentMinor + dailyOn(budgets) * daysLeft;
}

/** A change to one budget: its new daily amount, or switched on or off, or both. */
export type AdBudgetChange = { id: string; dailyMinor?: number; on?: boolean };

export type AdChangeFacts = {
  budgets: readonly AdBudget[];
  spentMinor: number;
  daysLeft: number;
  currency: string;
  /** What the owner lets the autopilot let the account spend in a month; null: it never raises one itself. */
  limitMinor: number | null;
};

/** What a change does to the money: whether it can spend more, and the month's projection after it. */
export function adChangeEffect(facts: AdChangeFacts, change: AdBudgetChange): { raises: boolean; projectedMinor: number | null; before: AdBudget; after: AdBudget } | null {
  const before = facts.budgets.find((b) => b.id === change.id);
  if (!before) return null;
  const after: AdBudget = { ...before, dailyMinor: change.dailyMinor ?? before.dailyMinor, on: change.on ?? before.on };
  const worth = (b: AdBudget) => (b.on ? (b.dailyMinor ?? Number.POSITIVE_INFINITY) : 0);
  const budgets = facts.budgets.map((b) => (b.id === after.id ? after : b));
  return { raises: worth(after) > worth(before), projectedMinor: projectedMonthMinor(facts.spentMinor, budgets, facts.daysLeft), before, after };
}

const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");

/**
 * Whether the autopilot may make a change to an ad budget itself, by the owner's budgets (the area's level is checked before, by
 * `autonomyDecision()`): a change that cannot spend more always may; a raise needs a monthly limit, stays within the largest raise in percent
 * of today's daily budget (switching a paused one on is not a percentage), and keeps the month's projection within the limit. Null: it may;
 * otherwise why it asks, in words.
 */
export function adChangeProblem(facts: AdChangeFacts, change: AdBudgetChange, raisePercentMax: number): string | null {
  const effect = adChangeEffect(facts, change);
  if (!effect) return "That budget is not in the ad account.";
  if (!effect.raises) return null;
  if (facts.limitMinor === null) return "No monthly limit for the ads is set on the Ads page, so a budget that spends more always waits for your yes.";
  const { before, after } = effect;
  if (before.on && change.dailyMinor !== undefined && before.dailyMinor) {
    const percent = ((after.dailyMinor! - before.dailyMinor) / before.dailyMinor) * 100;
    if (percent > raisePercentMax) return `It raises a daily budget by ${Math.round(percent)} %, more than your limit of ${raisePercentMax} %.`;
  }
  if (effect.projectedMinor === null) return "A running lifetime budget makes the month's spend unknown, so a budget that spends more waits for your yes.";
  if (effect.projectedMinor > facts.limitMinor) {
    return `At these budgets the ads would spend about ${money(effect.projectedMinor, facts.currency)} this month, more than your limit of ${money(facts.limitMinor, facts.currency)}.`;
  }
  return null;
}

/** A budget change in words made from the figures, never the model's: for the approval, the audit and what the autopilot tells. */
export function adChangeWords(before: AdBudget, after: AdBudget, currency: string): string {
  const what = `${before.kind === "campaign" ? "the campaign" : "the ad set"} "${before.name}"`;
  const parts: string[] = [];
  if (after.dailyMinor !== before.dailyMinor && after.dailyMinor !== null) {
    parts.push(`set the daily budget of ${what} from ${before.dailyMinor === null ? "a lifetime budget" : money(before.dailyMinor, currency)} to ${money(after.dailyMinor, currency)}`);
  }
  if (after.on !== before.on) parts.push(parts.length > 0 ? (after.on ? "switch it on" : "pause it") : `${after.on ? "switch on" : "pause"} ${what}`);
  if (parts.length === 0) return `Leave ${what} as it is.`;
  const text = parts.join(" and ");
  return `${text[0].toUpperCase()}${text.slice(1)}.`;
}
