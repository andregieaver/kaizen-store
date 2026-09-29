import type { CampaignKind } from "./campaigns";
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
  thresholdMinor: number | null;
  /** When it ends, so the page can stop announcing it on time; null for no end. */
  endsAt: string | null;
  /** The products it reaches; null for every product. */
  productIds: string[] | null;
};

export type CampaignNotices = { items: CampaignNotice[] };

export const NO_NOTICES: CampaignNotices = { items: [] };

/** The notices for one product. */
export function noticesFor(notices: CampaignNotices | undefined, productId: string): CampaignNotice[] {
  return (notices?.items ?? []).filter((notice) => notice.productIds === null || notice.productIds.includes(productId));
}

/** What a campaign offers, in the shopper's words: "20 % off", "3 for 2", "Free notebook when you spend NOK 500". */
export function noticeText(notice: CampaignNotice, m: Messages, money: (minor: number) => string): string {
  if (notice.kind === "percent") return m.campaigns.percent(notice.percent);
  if (notice.kind === "multi_buy") return m.campaigns.multiBuy(notice.buyQuantity, notice.payQuantity);
  return m.campaigns.gift(notice.giftTitle ?? "", money(notice.thresholdMinor ?? 0));
}

/** The notices a product card carries: the offers on the price, two at most, not the gifts, which the product page tells. */
export const cardNotices = (notices: CampaignNotice[]) => notices.filter((notice) => notice.kind !== "gift").slice(0, 2);
