import "server-only";

import { shopReport, type ShopAnswers, type ShopReport } from "@/lib/shopify-report";
import { shopifyEnv } from "@/lib/env";

import type { Membership } from "./auth";
import { log } from "./log";
import { memberCan } from "./permissions";
import { shopifyConnection, shopifyGraphql, type ShopifyDeps } from "./shopify-connect";

/**
 * *Check* (D445 step 3, `docs/moving-from-shopify.md` 4.3): what the connected Shopify shop holds and what its own settings answer, read
 * with a handful of small read queries (counts, the shop's settings, its markets, a sample of variants), never written anywhere: Kaizena
 * Flow keeps nothing of it, and the page asks again on each view. The queries are sent in groups, so a field Shopify refuses (a scope the
 * owner held back, a field of another plan) spoils only its own group; each missing answer is shown as unknown, never as 0. The owner's.
 */

const GROUPS: Record<string, string> = {
  shop: `query KaizenCheckShop { shop { name currencyCode taxesIncluded primaryDomain { host } billingAddress { countryCodeV2 } } }`,
  catalogue: `query KaizenCheckCatalogue {
    productsCount(limit: null) { count precision }
    productVariantsCount(limit: null) { count precision }
    collectionsCount(limit: null) { count precision }
    locationsCount(limit: null) { count precision }
    variants: productVariants(first: 250) { nodes { price compareAtPrice } }
  }`,
  content: `query KaizenCheckContent {
    pagesCount(limit: null) { count precision }
    blogs(first: 50) { nodes { articlesCount { count precision } } }
    urlRedirectsCount(limit: null) { count precision }
  }`,
  customers: `query KaizenCheckCustomers {
    customersCount(limit: null) { count precision }
    subscribers: customerSegmentMembers(first: 1, query: "email_subscription_status = 'SUBSCRIBED'") { totalCount }
  }`,
  orders: `query KaizenCheckOrders { ordersCount(limit: null) { count precision } }`,
  money: `query KaizenCheckMoney {
    giftCardsCount(limit: null, query: "balance_status:full OR balance_status:partial") { count precision }
    discountNodesCount(limit: null) { count precision }
  }`,
  markets: `query KaizenCheckMarkets { markets(first: 50) { nodes { name regions(first: 250) { nodes { ... on MarketRegionCountry { code } } } currencySettings { baseCurrency { currencyCode } } } } }`,
};

export type ShopCheck = { ok: true; report: ShopReport } | { ok: false; problem: "disconnected" | "failed" };

/** The connected shop's report (owner only), or why there is none. */
export async function checkShopify(member: Membership, deps: ShopifyDeps = {}): Promise<ShopCheck | null> {
  if (!memberCan(member, "owner")) return null;
  const connection = await shopifyConnection(member);
  if (!connection) return { ok: false, problem: "disconnected" };
  // The first call refreshes an expiring token under the row's lock; the rest then use the fresh one.
  const first = await shopifyGraphql<ShopAnswers>(member.store.id, GROUPS.shop, {}, deps);
  if (!first.ok) return first;
  const rest = await Promise.all(
    Object.entries(GROUPS)
      .filter(([name]) => name !== "shop")
      .map(async ([name, query]) => {
        const answer = await shopifyGraphql<ShopAnswers>(member.store.id, query, {}, deps);
        if (!answer.ok) log("warn", "shopify.check_group_failed", { storeId: member.store.id, group: name, problem: answer.problem });
        return answer.ok ? answer.data : {};
      }),
  );
  const answers: ShopAnswers = Object.assign({}, first.data, ...rest);
  let allOrders = false;
  try {
    allOrders = shopifyEnv()?.allOrders ?? false;
  } catch {
    allOrders = false;
  }
  return { ok: true, report: shopReport(answers, { missingScopes: connection.missing, allOrders }) };
}
