/**
 * Loyalty rewards (wave 13 unit A, D401, `docs/bonus.md` "Rewards and the birthday credit"): the pure parts, free of zod so the shopper's and the
 * owner's pages can use them. A reward is something a signed-in customer spends bonus credits on besides a price reduction: free shipping, one unit
 * of a product free, or an amount off. Each is a discount code of the store's own (`discount_codes.reward`), so what it takes off a basket is the
 * code engine's (`applyDiscount()`), and redeeming hands the customer one generated code of it.
 */

export const REWARD_KINDS = ["free_shipping", "product", "amount"] as const;
export type RewardKind = (typeof REWARD_KINDS)[number];

/** At most so many rewards a store. */
export const REWARDS_MAX = 10;
export const REWARD_NAME_MAX = 80;
/** A reward's code works for so many months when the program's credits never expire. */
export const REWARD_CODE_MONTHS = 12;

/** A reward as the owner keeps it: the cost in the credits' currency, the amounts off per market for `amount`. */
export type BonusReward = {
  id: string;
  name: string;
  /** The name in the store's other languages, by locale. */
  names: Record<string, string>;
  costMinor: number;
  kind: RewardKind;
  productId: string | null;
  /** For `amount`: minor units off per market, in the market's own currency. */
  amounts: Record<string, number>;
  active: boolean;
};

/** A reward as a customer sees it: its name in their language and its cost in the currency shown. */
export type ShopperReward = {
  id: string;
  name: string;
  kind: RewardKind;
  costMinor: number;
  /** Whether their usable credits cover it now. */
  affordable: boolean;
};

/** A code a customer redeemed, as My account lists it. */
export type RedeemedCode = {
  code: string;
  rewardName: string;
  endsAt: string | null;
  used: boolean;
  ended: boolean;
};

/** A reward's name in a language: its own, else the language's first match, else the main name. */
export function rewardName(reward: Pick<BonusReward, "name" | "names">, locale: string): string {
  const own = reward.names[locale];
  if (own) return own;
  const lang = locale.split("-")[0];
  return Object.entries(reward.names).find(([l]) => l.split("-")[0] === lang)?.[1] || reward.name;
}

/** When a redeemed code stops working: as long as the program's credits last, else a year (D401). */
export function rewardCodeEnds(now: Date, expiresMonths: number | null): Date {
  const months = expiresMonths ?? REWARD_CODE_MONTHS;
  const end = new Date(now);
  end.setUTCMonth(end.getUTCMonth() + months);
  return end;
}
