import type { CampaignKind, CampaignNext, TierBasis } from "./campaigns";
import type { Messages } from "./i18n";

/**
 * What a store's campaigns say on its product pages and cards (D115). The
 * same for every shopper, so it is kept with the catalogue and drawn into the
 * cached page: no per-request read. A campaign for chosen customer groups is
 * never announced (the page would say what only some can have), and one with
 * a limit only while it has uses left.
 */

export type CampaignNotice = {
  id: string;
  name: string;
  kind: CampaignKind;
  percent: number;
  buyQuantity: number;
  payQuantity: number;
  /** The free product's name, and what the basket must come to in the currency shown, for a gift. */
  giftTitle: string | null;
  /** What the basket must come to in the currency shown: a gift's, and an amount's or free shipping's when it has one (D299 E3). */
  thresholdMinor: number | null;
  /** What an amount campaign takes off, in the currency shown. */
  amountMinor: number | null;
  /** A tiered campaign's ladder in this market, lowest first: units, or an amount in the currency shown. */
  tierBasis: TierBasis | null;
  tiers: { at: number; percent: number }[];
  /** When it ends, so the page can stop announcing it on time; null for no end. */
  endsAt: string | null;
  /** The products it reaches; null for every product. */
  productIds: string[] | null;
  /** Given to signed-in customers, a number of orders each: the page says to sign in. */
  signIn: boolean;
};

export type CampaignNotices = { items: CampaignNotice[] };

export const NO_NOTICES: CampaignNotices = { items: [] };

/** The notices for one product. */
export function noticesFor(notices: CampaignNotices | undefined, productId: string): CampaignNotice[] {
  return (notices?.items ?? []).filter((notice) => notice.productIds === null || notice.productIds.includes(productId));
}

/**
 * What a campaign offers, in the shopper's words: "20 % off", "3 for 2", "Free notebook when you spend NOK 500", "NOK 100 off",
 * "Free shipping when you spend NOK 500", "10 % off when you buy 2 · 15 % off when you buy 4". A card (`card`) says a tiered campaign
 * as "Up to 15 % off".
 */
export function noticeText(notice: CampaignNotice, m: Messages, money: (minor: number) => string, { card = false }: { card?: boolean } = {}): string {
  const over = notice.thresholdMinor !== null && notice.thresholdMinor > 0 ? money(notice.thresholdMinor) : null;
  if (notice.kind === "percent") return m.campaigns.percent(notice.percent);
  if (notice.kind === "multi_buy") return m.campaigns.multiBuy(notice.buyQuantity, notice.payQuantity);
  if (notice.kind === "amount") return over ? m.campaigns.amountOver(money(notice.amountMinor ?? 0), over) : m.campaigns.amount(money(notice.amountMinor ?? 0));
  if (notice.kind === "free_shipping") return over ? m.campaigns.freeShippingOver(over) : m.campaigns.freeShipping;
  if (notice.kind === "tiered") {
    if (card) return m.campaigns.upTo(Math.max(0, ...notice.tiers.map((tier) => tier.percent)));
    return notice.tiers
      .map((tier) => (notice.tierBasis === "quantity" ? m.campaigns.tierQuantity(tier.percent, tier.at) : m.campaigns.tierSpend(tier.percent, money(tier.at))))
      .join(" · ");
  }
  return m.campaigns.gift(notice.giftTitle ?? "", money(notice.thresholdMinor ?? 0));
}

/**
 * The notices a product card carries: the offers on the price that need no amount, two at most (a percentage, "3 for 2", a tiered
 * campaign as "Up to 15 % off"); gifts, amounts off and free shipping are told on the product page.
 */
export const cardNotices = (notices: CampaignNotice[]) => notices.filter((notice) => CARD_KINDS.includes(notice.kind)).slice(0, 2);

const CARD_KINDS: readonly CampaignNotice["kind"][] = ["percent", "multi_buy", "tiered"];

/** How far a campaign's next step is, in the cart's words (D299 E3): "Buy 2 more to get 15 % off", "Spend NOK 120 more for free shipping". */
export function nextStepText(step: CampaignNext, m: Messages, money: (minor: number) => string): string {
  if (step.kind === "tiered") {
    return step.missingUnits !== null ? m.campaigns.nextQuantity(step.missingUnits, step.percent ?? 0) : m.campaigns.nextSpend(money(step.missingMinor ?? 0), step.percent ?? 0);
  }
  if (step.kind === "amount") return m.campaigns.nextAmount(money(step.missingMinor ?? 0), money(step.offMinor ?? 0));
  return m.campaigns.nextFreeShipping(money(step.missingMinor ?? 0));
}
