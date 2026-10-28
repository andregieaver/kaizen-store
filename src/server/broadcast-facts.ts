import "server-only";

import { factIds, NO_FACTS, type BroadcastContent, type CampaignFact, type EmailFacts, type ProductFact } from "@/lib/broadcasts";
import { noticeText } from "@/lib/campaign-notices";
import { t } from "@/lib/i18n";
import type { Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { wordpressPrice } from "@/lib/wordpress-view";

import { campaignNotices } from "./campaign-notices";
import { listGridProducts, type GridProduct } from "./catalog";
import { rankedSearch } from "./search";
import type { EmailStore } from "./shopper-emails";

/**
 * The store's own facts in marketing email (wave 8 unit H, D352): what the writer's tools hand the model, and what code draws into each
 * recipient's email. Both read the catalogue's cached reads for one market (`listGridProducts()`: offered products with a price there,
 * as the storefront shows them) and the campaigns' notices (`campaignNotices()`), so a price is written by `<Price>`'s rules
 * (`wordpressPrice()`, in the market's currency) and an offer by the shop's own words (`noticeText()`). A model never writes either.
 */

/** The market a recipient's facts are read in: their country (else the store's own), in the email's language when the store keeps it. */
export function emailMarket(store: Pick<EmailStore, "markets" | "localization">, marketCode: string | null, language: string): Market | null {
  const market = (marketCode && store.markets.find((m) => m.code === marketCode)) || store.markets[0];
  if (!market) return null;
  return store.localization.keptLocales.includes(language) ? { ...market, locale: language, lang: language.slice(0, 2) } : market;
}

/** A product's price lines as the store shows it in the market: the amount (with "From" where variants differ) and the small print. */
export function priceLines(product: Pick<GridProduct, "price" | "priceVaries">, market: Market): { price: string; small: string[] } {
  const m = t(market.lang);
  const shown = wordpressPrice(product.price, product.priceVaries, market.locale, m);
  return {
    price: shown.from_label ? `${shown.from_label} ${shown.text}` : shown.text,
    small: [shown.vat_label, ...(shown.prior_text ? [`${shown.prior_label} ${shown.prior_text}`] : []), ...(shown.unit_text ? [shown.unit_text] : [])],
  };
}

/** What code draws into one recipient's email: the content's products and campaigns read in their market and language; none, nothing read. */
export async function emailFactsFor(store: EmailStore, content: BroadcastContent, marketCode: string | null, language: string): Promise<EmailFacts> {
  const ids = factIds(content);
  if (ids.products.length === 0 && ids.campaigns.length === 0) return NO_FACTS;
  const market = emailMarket(store, marketCode, language);
  if (!market) return NO_FACTS;
  const m = t(market.lang);
  const [products, notices] = await Promise.all([
    ids.products.length > 0 ? listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "given", limit: 48, ids: ids.products }) : [],
    ids.campaigns.length > 0 ? campaignNotices(store.id, market) : { items: [] },
  ]);
  const money = (minor: number) => formatMoney(minor, market.currency, market.locale);
  const date = new Intl.DateTimeFormat(market.locale, { dateStyle: "long" });
  return {
    products: new Map(products.map((p) => [p.id, { title: p.title, image: p.image?.url ?? null, alt: p.image?.alt || p.title, ...priceLines(p, market) }])),
    campaigns: new Map(
      notices.items
        .filter((notice) => ids.campaigns.includes(notice.id))
        .map((notice) => [notice.id, { title: notice.name, text: noticeText(notice, m, money), until: notice.endsAt ? date.format(new Date(notice.endsAt)) : null }]),
    ),
    linkText: m.viewProduct,
  };
}

const FIND_MAX = 8;

/**
 * `find_products`: the store's products offered in the market, those the words find by keyword (`rankedSearch()`, never a meaning model)
 * or, without words or with none found, the newest.
 */
export async function findProductFacts(store: Pick<EmailStore, "id">, market: Market, query: string): Promise<ProductFact[]> {
  const words = query.trim().slice(0, 120);
  const found = words ? (await rankedSearch({ storeId: store.id, market }, words, FIND_MAX, null)).ids : [];
  const products = await listGridProducts(
    store.id,
    market,
    found.length > 0 ? { categoryIds: [], tagIds: [], sort: "given", limit: FIND_MAX, ids: found } : { categoryIds: [], tagIds: [], sort: "newest", limit: FIND_MAX },
  );
  return products.map((p) => ({
    id: p.id,
    handle: p.handle,
    title: p.title,
    picture: p.image !== null,
    price: priceLines(p, market).price,
    summary: (p.excerpt || p.description).replace(/\s+/g, " ").trim().slice(0, 200),
  }));
}

/** `running_campaigns`: the campaigns the store announces in the market now (the same for every shopper), in the shop's words. */
export async function campaignFacts(store: Pick<EmailStore, "id">, market: Market): Promise<CampaignFact[]> {
  const m = t(market.lang);
  const money = (minor: number) => formatMoney(minor, market.currency, market.locale);
  const notices = await campaignNotices(store.id, market);
  return notices.items.map((notice) => ({
    id: notice.id,
    name: notice.name,
    offer: noticeText(notice, m, money),
    ends: notice.endsAt ? notice.endsAt.slice(0, 10) : null,
    reaches: notice.productIds === null ? "every product" : `${notice.productIds.length} product${notice.productIds.length === 1 ? "" : "s"}`,
  }));
}
