import {
  AFFILIATE_REJECTION_LABELS,
  AFFILIATE_STATUS_LABELS,
  affiliateSettingsInput,
  friendDiscount,
  referrerReward,
  type AffiliateAttributionRow,
  type AffiliateOverview,
  type AffiliateSettings,
} from "./affiliates";
import { bpsToPercentText, percentTextToBps, type MoneyFormat } from "./bonus-admin";
import { formatMoney, minorUnitDigits } from "./money";
import { formatPriceInput, parsePrice } from "./product-input";

/**
 * What the owner's screens for the store's referral program (D131) need besides the contract in `affiliates.ts`: the
 * settings form's text in and out, the sentences that explain the rules, and how an attribution is worded. Pure, so the
 * browser and the tests use it as the server does (which checks everything again with `affiliateSettingsInput`).
 */

/** The form as typed: every number is text until it has been read. */
export type AffiliateFormValues = {
  enabled: boolean;
  /** The referrer's credits, in percent of what the friend pays for goods. */
  rewardPercent: string;
  /** Whether only the friend's first orders earn credits (`limited`), or every one. */
  rewardScope: "limited" | "every";
  rewardOrders: string;
  /** The friend's welcome discount, in percent of goods; 0 for none. */
  friendPercent: string;
  /** The most it takes off, an amount in the credits' currency; empty for no limit. */
  friendMax: string;
  /** The most a referrer earns a calendar month, in the credits' currency; empty for no limit. */
  monthlyCap: string;
  cookieDays: string;
};

export type AffiliateField = Exclude<keyof AffiliateFormValues, "enabled" | "rewardScope">;

/** The order the fields are in, so the first problem gets the focus. */
export const AFFILIATE_FIELD_ORDER: readonly AffiliateField[] = [
  "friendPercent",
  "friendMax",
  "rewardPercent",
  "rewardOrders",
  "monthlyCap",
  "cookieDays",
];

export function formFromSettings(settings: AffiliateSettings, currency: string): AffiliateFormValues {
  return {
    enabled: settings.enabled,
    rewardPercent: bpsToPercentText(settings.rewardBps),
    rewardScope: settings.rewardOrders === null ? "every" : "limited",
    rewardOrders: String(settings.rewardOrders ?? 1),
    friendPercent: String(settings.friendPercent),
    friendMax: settings.friendMaxMinor === null ? "" : formatPriceInput(settings.friendMaxMinor, currency),
    monthlyCap: settings.monthlyCapMinor === null ? "" : formatPriceInput(settings.monthlyCapMinor, currency),
    cookieDays: String(settings.cookieDays),
  };
}

export type AffiliateFormRead =
  | { ok: true; settings: AffiliateSettings }
  | { ok: false; errors: Partial<Record<AffiliateField, string>> };

const wholeNumber = (text: string): number | null => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * The form read into settings, checked with `affiliateSettingsInput` (the server's own check). Every field that is
 * wrong gets its own message, in the words of the contract where it has them.
 */
export function readAffiliateForm(values: AffiliateFormValues, currency: string): AffiliateFormRead {
  const errors: Partial<Record<AffiliateField, string>> = {};

  const friendPercent = wholeNumber(values.friendPercent);
  if (friendPercent === null) errors.friendPercent = "Write a whole percentage such as 10, or 0 for no welcome discount.";

  let friendMaxMinor: number | null = null;
  if (values.friendMax.trim() !== "") {
    friendMaxMinor = parsePrice(values.friendMax, currency);
    if (friendMaxMinor === null) errors.friendMax = `Write an amount in ${currency} such as 100 or 99,50, or leave it empty for no limit.`;
  }

  const rewardBps = percentTextToBps(values.rewardPercent);
  if (rewardBps === null) errors.rewardPercent = "Write a percentage such as 5 or 2.5.";

  let rewardOrders: number | null = null;
  if (values.rewardScope === "limited") {
    rewardOrders = wholeNumber(values.rewardOrders);
    if (rewardOrders === null) errors.rewardOrders = "Write how many orders earn credits, such as 1.";
  }

  let monthlyCapMinor: number | null = null;
  if (values.monthlyCap.trim() !== "") {
    monthlyCapMinor = parsePrice(values.monthlyCap, currency);
    if (monthlyCapMinor === null) errors.monthlyCap = `Write an amount in ${currency} such as 500, or leave it empty for no limit.`;
  }

  const cookieDays = wholeNumber(values.cookieDays);
  if (cookieDays === null) errors.cookieDays = "Write a number of days, such as 30.";

  const parsed = affiliateSettingsInput.safeParse({
    enabled: values.enabled,
    rewardBps: rewardBps ?? 0,
    rewardOrders: values.rewardScope === "limited" ? (rewardOrders ?? 1) : null,
    friendPercent: friendPercent ?? 0,
    friendMaxMinor,
    monthlyCapMinor,
    cookieDays: cookieDays ?? 30,
  });
  if (!parsed.success) {
    const fieldOf: Record<string, AffiliateField> = {
      rewardBps: "rewardPercent",
      rewardOrders: "rewardOrders",
      friendPercent: "friendPercent",
      friendMaxMinor: "friendMax",
      monthlyCapMinor: "monthlyCap",
      cookieDays: "cookieDays",
    };
    for (const issue of parsed.error.issues) {
      const field = fieldOf[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = friendly(field, issue.message);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: parsed.data as AffiliateSettings };
}

/** The contract's own messages are kept; the ones zod writes itself (a number out of range) are put in words. */
function friendly(field: AffiliateField, message: string): string {
  if (/^(Too small|Too big|Invalid|Number must|Expected)/i.test(message) || message === "Invalid input") {
    switch (field) {
      case "rewardOrders":
        return "Write a number of orders from 1 to 100.";
      case "cookieDays":
        return "Write a number of days from 1 to 90.";
      case "friendPercent":
        return "Write a whole percentage from 0 to 50.";
      default:
        return "Check this number.";
    }
  }
  return message;
}

/** The problems in the order of the form, for the summary at its end and for the first field to focus. */
export function orderedProblems(errors: Partial<Record<AffiliateField, string>>): { field: AffiliateField; message: string }[] {
  return AFFILIATE_FIELD_ORDER.flatMap((field) => (errors[field] ? [{ field, message: errors[field] as string }] : []));
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

/** What the program is, for the owner who has not turned it on. */
export const AFFILIATE_EXPLANATION =
  "Signed-in customers get their own link to share. When a friend orders for the first time through it, the friend gets a welcome discount and the customer who shared it earns bonus credits. Only new customers count, and credits are taken back if the order is refunded or cancelled.";

/** Why the program needs the bonus program. */
export const AFFILIATE_NEEDS_BONUS =
  "The reward is bonus credits, so the referral program works only while the bonus program is on. Turn the bonus program on under Bonus credits first.";

/** What turning it on or off does, in the order the owner needs to know it. */
export const AFFILIATE_ON_NOTES = [
  "Every signed-in customer gets a link the first time they open Refer a friend in My account. Nobody has to be approved; you can block a customer who abuses it.",
  "A friend must be signed in to get the welcome discount, and only on their first paid order. Guests are asked to sign in.",
  "Nobody can refer themselves, and a customer who has ordered before does not count as a friend.",
  "The link is remembered only for visitors who allow marketing cookies, so the store asks about cookies once the program is on.",
  "Orders copied from another store and hosts' orders never earn or use it.",
];
export const AFFILIATE_OFF_NOTE =
  "Turning it off stops links working and stops rewards. Credits already earned stay with customers, and orders already placed are rewarded if they are paid while the program is on.";

/** Days as words. */
const days = (n: number) => `${n} ${n === 1 ? "day" : "days"}`;

/**
 * The rules in sentences, the way an owner reads them back: the friend's discount, what the referrer earns and when it
 * counts, the limits. `money` formats the credits' currency.
 */
export function rulesSummary(settings: AffiliateSettings, money: MoneyFormat, pendingDays: number): string[] {
  const lines: string[] = [];
  lines.push(
    settings.friendPercent > 0
      ? `A friend gets ${settings.friendPercent}% off the goods in their first order${settings.friendMaxMinor !== null ? `, at most ${money(settings.friendMaxMinor)}` : ""}.`
      : "A friend gets no welcome discount.",
  );
  const who =
    settings.rewardOrders === null ? "every order" : settings.rewardOrders === 1 ? "the friend's first order" : `the friend's first ${settings.rewardOrders} orders`;
  lines.push(
    settings.rewardBps > 0
      ? `The customer who shared the link earns ${bpsToPercentText(settings.rewardBps)}% of what the friend pays online for goods, as bonus credits, for ${who}. The credits can be used ${pendingDays <= 0 ? "right after the friend pays" : `${days(pendingDays)} after the friend pays`}.`
      : "The customer who shared the link earns nothing: the reward is 0%.",
  );
  if (settings.monthlyCapMinor !== null) lines.push(`One customer can earn at most ${money(settings.monthlyCapMinor)} a month.`);
  lines.push(`A visitor's link is remembered for ${days(settings.cookieDays)}, if they allow marketing cookies.`);
  return lines;
}

/** A worked example for the form: a friend's first order of 1,000 (in the credits' currency). */
export function example(settings: AffiliateSettings, currency: string, locale: string, orderMajor = 1000): string {
  const goods = orderMajor * 10 ** minorUnitDigits(currency);
  const off = friendDiscount(goods, settings);
  const reward = referrerReward(goods - off, settings.rewardBps);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  return `A first order of ${money(goods)} in goods: the friend saves ${money(off)} and pays ${money(goods - off)}; the customer who shared the link earns ${money(reward)} in credits.`;
}

/** The overview as rows of a list: label and value. */
export function overviewRows(overview: AffiliateOverview, money: MoneyFormat): { label: string; value: string; hint?: string }[] {
  return [
    { label: "Customers with a link", value: String(overview.affiliates) },
    { label: "Visits to links, last 30 days", value: String(overview.visits30d) },
    { label: "Orders through links, last 30 days", value: String(overview.orders30d) },
    { label: "Credits earned by referrers, last 30 days", value: money(overview.rewarded30dMinor) },
    { label: "Referral credits usable now", value: money(overview.outstandingMinor), hint: "What the store still owes in price reductions for referrals." },
    { label: "Referral credits pending", value: money(overview.pendingMinor), hint: "Earned, but waiting for the return period." },
    { label: "Orders that earned nothing, last 30 days", value: String(overview.rejected30d) },
  ];
}

/** How an attribution's status reads, with the reason when a guard stopped the reward. */
export function attributionStatus(row: Pick<AffiliateAttributionRow, "status" | "reason">): string {
  const base = AFFILIATE_STATUS_LABELS[row.status];
  return row.status === "rejected" && row.reason ? `${base}: ${AFFILIATE_REJECTION_LABELS[row.reason]}` : base;
}

/** A person for the owner's lists: their name and email, or just the email. */
export const personLabel = (name: string, email: string): string => (name.trim() ? `${name.trim()} (${email})` : email);

/** The most a block reason takes, and the least. */
export const BLOCK_NOTE_MIN = 3;
export const BLOCK_NOTE_MAX = 200;
