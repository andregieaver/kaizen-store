import { AFFILIATE_REJECTION_LABELS, AFFILIATE_STATUS_LABELS, friendDiscount, referrerReward, type AffiliateAttributionRow, type AffiliateOverview, type AffiliateSettings } from "./affiliates";
import { countWords, fillWords } from "./admin-fill";
import type { LoyaltyMessages } from "./admin-messages/loyalty.en";
import { bpsToPercentText, percentNumber, type MoneyFormat } from "./bonus-admin";
import { formatMoney, minorUnitDigits } from "./money";
import { formatPriceInput } from "./product-input";

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

/** The problems in the order of the form, for the summary at its end and for the first field to focus. */
export function orderedProblems(errors: Partial<Record<AffiliateField, string>>): { field: AffiliateField; message: string }[] {
  return AFFILIATE_FIELD_ORDER.flatMap((field) => (errors[field] ? [{ field, message: errors[field] as string }] : []));
}

// ---------------------------------------------------------------------------
// Words
// ---------------------------------------------------------------------------

type RuleWords = LoyaltyMessages["affiliateRules"];

/**
 * The rules in sentences, the way an owner reads them back: the friend's discount, what the referrer earns and when it
 * counts, the limits. `money` formats the credits' currency.
 */
export function rulesSummary(settings: AffiliateSettings, money: MoneyFormat, pendingDays: number, w: RuleWords): string[] {
  const lines: string[] = [];
  const days = (n: number) => countWords(n, w.days);
  lines.push(
    settings.friendPercent > 0
      ? fillWords(w.friend, {
          percent: settings.friendPercent,
          max: settings.friendMaxMinor !== null ? fillWords(w.friendMax, { amount: money(settings.friendMaxMinor) }) : "",
        })
      : w.noFriend,
  );
  const who =
    settings.rewardOrders === null ? w.every : settings.rewardOrders === 1 ? w.first : fillWords(w.firstN, { n: settings.rewardOrders });
  lines.push(
    settings.rewardBps > 0
      ? fillWords(w.reward, {
          percent: percentNumber(settings.rewardBps, w),
          who,
          wait: pendingDays <= 0 ? w.rightAfter : fillWords(w.after, { days: days(pendingDays) }),
        })
      : w.noReward,
  );
  if (settings.monthlyCapMinor !== null) lines.push(fillWords(w.cap, { amount: money(settings.monthlyCapMinor) }));
  lines.push(fillWords(w.cookie, { days: days(settings.cookieDays) }));
  return lines;
}

/** A worked example for the form: a friend's first order of 1,000 (in the credits' currency). */
export function example(
  settings: AffiliateSettings,
  currency: string,
  locale: string,
  orderMajor = 1000,
  template: string,
): string {
  const goods = orderMajor * 10 ** minorUnitDigits(currency);
  const off = friendDiscount(goods, settings);
  const reward = referrerReward(goods - off, settings.rewardBps);
  const money = (minor: number) => formatMoney(minor, currency, locale);
  return fillWords(template, { goods: money(goods), off: money(off), pays: money(goods - off), reward: money(reward) });
}

/** The overview as rows of a list: label and value. */
export function overviewRows(
  overview: AffiliateOverview,
  money: MoneyFormat,
  w: LoyaltyMessages["affiliateOverview"],
): { label: string; value: string; hint?: string }[] {
  return [
    { label: w.affiliates, value: String(overview.affiliates) },
    { label: w.visits, value: String(overview.visits30d) },
    { label: w.orders, value: String(overview.orders30d) },
    { label: w.rewarded, value: money(overview.rewarded30dMinor) },
    { label: w.outstanding, value: money(overview.outstandingMinor), hint: w.outstandingHint },
    { label: w.pending, value: money(overview.pendingMinor), hint: w.pendingHint },
    { label: w.rejected, value: String(overview.rejected30d) },
  ];
}

/** How an attribution's status reads, with the reason when a guard stopped the reward. */
export function attributionStatus(
  row: Pick<AffiliateAttributionRow, "status" | "reason">,
  w: { statuses: typeof AFFILIATE_STATUS_LABELS; reasons: typeof AFFILIATE_REJECTION_LABELS } = {
    statuses: AFFILIATE_STATUS_LABELS,
    reasons: AFFILIATE_REJECTION_LABELS,
  },
): string {
  const base = w.statuses[row.status];
  return row.status === "rejected" && row.reason ? `${base}: ${w.reasons[row.reason]}` : base;
}

/** A person for the owner's lists: their name and email, or just the email. */
export const personLabel = (name: string, email: string): string => (name.trim() ? `${name.trim()} (${email})` : email);

/** The most a block reason takes, and the least. */
export const BLOCK_NOTE_MIN = 3;
export const BLOCK_NOTE_MAX = 200;
