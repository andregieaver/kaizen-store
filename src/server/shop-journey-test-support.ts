import { headers } from "next/headers";

import { cartView } from "@/app/s/[store]/[market]/cart/cart-view";
import { t } from "@/lib/i18n";
import { parseListingParams } from "@/lib/listing-filters";
import type { OrderListInput } from "@/lib/order-list";
import { normalizeQuery } from "@/lib/search";
import { featureOn } from "@/lib/store-features";
import { termsIn } from "@/lib/term-texts";

import { ordersListReads, productsListReads, storeHomeReads } from "./admin-screens";
import { afterSaleOpenCached } from "./after-sale";
import type { Membership } from "./auth";
import { getBuyer } from "./b2b";
import { campaignNotices } from "./campaign-notices";
import { readCartId } from "./cart";
import { cartRemindersOn, checkoutOptedOut } from "./cart-reminders";
import { requestCartSummary } from "./cart-summary";
import { getProduct, getVariantStock, listGridProducts, listProducts } from "./catalog";
import { getOpenCheckout, placeOrder } from "./checkout";
import { termsDisplayFor } from "./checkout-terms";
import { storeAndMarket } from "./content-grid";
import { getCustomer } from "./customers";
import { deliveryView } from "./delivery-choice";
import { orderCodeOutcomes } from "./discounts";
import { checkoutGiftCards } from "./gift-card-cart";
import { legalLinksFor } from "./legal-links";
import { LISTING_LIMIT, listingFacets, listingPage } from "./listing";
import { getOrder } from "./orders";
import { productsPageOf, publishedPageById } from "./pages";
import { productLayoutForVisitor } from "./product-layouts";
import { understandQuery } from "./query-understanding";
import { queryVector } from "./query-vector";
import { getRecommendSettings } from "./recommend-settings";
import { budgetVisitor } from "./request-budget";
import { reviewFacts } from "./review-facts";
import { placePageForVisitor, rolePageForVisitor } from "./role-pages";
import { logSearch, searchProducts } from "./search";
import { runningExperiment } from "./search-experiment";
import { rulesOf } from "./search-rules";
import { listIndexedProducts } from "./seo";
import { resolveShop, sellingPageOr404, type Shop } from "./shop";
import { siteLayoutFor, siteLayoutForVisitor } from "./site-layouts";
import { smsOffered } from "./sms";
import { siteTerms } from "./taxonomy";
import { textStylesCssFor } from "./text-styles";
import { visitKeyOf } from "./analytics-visits";

/**
 * A shop-only store's journey (bloat review step 1.12, `shop-journey.int.test.ts`): one function per stop, each calling the server functions
 * its page calls, in the same order and under the same conditions, with what the page passes them. Each stop mirrors the awaits of the file
 * its comment names (and, where the page's data is read by a loader of its own, that loader's); the parts a page draws inside its own
 * components are held by the statements per page of `scripts/server-budget.mjs` on the built app, not here. Outside a render React's
 * `cache()` shares nothing, so a read two pieces of a page ask for (`perRequest()`) is sent twice here: the tables are the same, the
 * statements are not, and so no statement count is kept of these stops. The name ends in test-support.ts, so the code ratchet does not
 * count it. When a page's awaits change, change its stop in the same commit.
 */

/** Throws when a page would not draw for the shop-only store, so a stop never measures a 404 by mistake. */
async function shopOf(slug: string, market: string): Promise<Shop> {
  const shop = await resolveShop(slug, market);
  if (!shop) throw new Error(`no shop ${slug}/${market}`);
  return shop;
}

/** `src/app/s/[store]/[market]/layout.tsx` (`MarketLayout`): the shop, after-sale for a website, the header, footer and legal links, the text styles. */
export async function frame(slug: string, market: string): Promise<void> {
  const shop = await shopOf(slug, market);
  const { store, ab } = shop;
  const afterSale = featureOn(store, "shop") || (await afterSaleOpenCached(store.id));
  await Promise.all([siteLayoutForVisitor(store.id, "header", ab), siteLayoutForVisitor(store.id, "footer", ab), legalLinksFor(store, shop.market, afterSale)]);
  await textStylesCssFor(store.id);
}

/** `src/app/s/[store]/[market]/page.tsx` (`load()` and `MarketHome`): the chosen front page or its test, then the products and campaigns. */
export async function home(slug: string, market: string): Promise<void> {
  const shop = await shopOf(slug, market);
  const { store } = shop;
  const chosen = store.frontPageId ? await publishedPageById(store.id, store.frontPageId) : null;
  await placePageForVisitor(store.id, "front", chosen, shop.ab);
  if (featureOn(store, "shop")) await Promise.all([listProducts(store.id, shop.market), campaignNotices(store.id, shop.market)]);
}

/**
 * `src/app/s/[store]/[market]/products/page.tsx` (`load()` and `ProductsPage`), then the standard list's `ProductListing`
 * (`src/components/product-listing.tsx`) for an address with no filter: the buyer, the facets, the page of products, the terms, the campaigns.
 */
export async function listing(slug: string, market: string): Promise<void> {
  const shop = await shopOf(slug, market);
  const { store } = shop;
  const placed = await placePageForVisitor(store.id, "products", await productsPageOf(store), shop.ab);
  await sellingPageOr404(shop, "/products");
  if (placed.page) {
    await productsPageOf(store);
    return;
  }
  const m = t(shop.market.lang);
  await Promise.all([
    listGridProducts(store.id, shop.market, { categoryIds: [], tagIds: [], sort: "oldest", limit: 48 }),
    campaignNotices(store.id, shop.market),
  ]);
  const buyer = await getBuyer(store);
  const viewer = { buyer, audienceBoth: store.audience === "both" };
  await Promise.all([
    listingFacets(store.id, shop.market, {}, viewer, m.options as Record<string, string>),
    listingPage(store.id, shop.market, {}, parseListingParams({}), viewer, 1),
    siteTerms(store.id, "product").then((list) => termsIn(list, shop.market.locale)),
    campaignNotices(store.id, shop.market),
  ]);
}

/**
 * `src/app/s/[store]/[market]/p/[handle]/page.tsx` (`load()`, `generateMetadata()`'s product list and `ProductPage`), then the stock read the
 * buy part streams in (`stockOnce()` in `src/components/product-parts.tsx`, `getVariantStock()`).
 */
export async function product(slug: string, market: string, handle: string): Promise<void> {
  const shop = await shopOf(slug, market);
  const { store, ab } = shop;
  if (!featureOn(store, "shop")) throw new Error("the product page is the store's 404 while the shop is off");
  const found = await getProduct(store.id, shop.market, handle);
  if (!found) throw new Error(`no product ${handle}`);
  await listIndexedProducts(store.id);
  await productsPageOf(store);
  await Promise.all([
    productLayoutForVisitor(store.id, found.id, ab),
    siteLayoutFor(store.id, "header"),
    campaignNotices(store.id, shop.market),
    getRecommendSettings(store.id),
    featureOn(store, "reviews") ? reviewFacts(store.id, found.id) : Promise.resolve(null),
  ]);
  await getVariantStock(store.id, found.variants.map((v) => v.id));
}

/**
 * `src/app/s/[store]/[market]/search/page.tsx` (`SearchPage` and `Search`: the shop, the search page's own page) and the search it draws
 * (`Search` in `src/components/search-section.tsx`): the store's search rules, the search test, the search itself with the page's own
 * vector and understanding, the log it writes after the answer, the terms for no results or filters, and the recommendations' switch.
 */
export async function search(slug: string, market: string, query = "product"): Promise<void> {
  const shop = await shopOf(slug, market);
  await sellingPageOr404(shop, "/search");
  const { store } = shop;
  await rolePageForVisitor(store, "search", {});
  const placed = await storeAndMarket(store.id, shop.market.slug);
  if (!placed || !featureOn(placed.store, "shop")) throw new Error("search draws nothing while the shop is off");
  const where = { storeId: store.id, market: placed.market };
  const text = normalizeQuery(query);
  await rulesOf(store.id);
  const experiment = text ? await runningExperiment() : null;
  const found = await searchProducts(
    where,
    text,
    (storeId, space, words, visitor) => queryVector(storeId, space, words, "search", visitor),
    understandQuery,
    LISTING_LIMIT,
    budgetVisitor(await headers()),
  );
  const visit = visitKeyOf(placed.store, await headers());
  await logSearch(where, text, found.products.length, found, { id: crypto.randomUUID(), experimentId: experiment?.id ?? null, arm: null }, visit);
  if (found.products.length === 0 || found.filters) await siteTerms(store.id, "product");
  await getRecommendSettings(store.id);
}

/**
 * `src/app/s/[store]/[market]/cart/page.tsx` (`CartPage`: the shop, the cart's own page) and its contents (`CartContents` in `cart-contents.tsx`):
 * `cartView()` of `cart/cart-view.ts`, which reads the cookie's cart (`getCart()` of `src/server/cart.ts`) and its `cartSummary()` once, with
 * the buyer, the gift box, the questions, express checkout and a quote; then the recommendations' switch for the upsell.
 */
export async function cart(slug: string, market: string): Promise<void> {
  const shop = await shopOf(slug, market);
  await sellingPageOr404(shop, "/cart");
  const { store } = shop;
  await rolePageForVisitor(store, "cart", shop.ab);
  const view = await cartView(store, shop.market, t(shop.market.lang));
  if (view.empty) throw new Error("the cart stop needs a cart with lines in the cookie");
  await getRecommendSettings(store.id);
}

/**
 * `src/app/s/[store]/[market]/checkout/page.tsx` (`CheckoutPage`: the shop, the checkout's own page) and `Checkout` in `checkout-section.tsx`,
 * which has one step: the order placed from the cookie's cart, waiting for payment. Its view (the open checkout, the order, the credits while
 * Bonus is on, the gift cards), the codes' outcomes, the delivery choice (whose summary starts with `getCheckoutInfo()`) and the payment form's
 * reads. The brief's "first step" with `getCheckoutInfo()` is this: the checkout has no step before the order.
 */
export async function checkout(slug: string, market: string): Promise<void> {
  const shop = await shopOf(slug, market);
  await sellingPageOr404(shop, "/checkout");
  const { store } = shop;
  await rolePageForVisitor(store, "checkout", shop.ab);
  const where = { storeId: store.id, market: shop.market };
  const cartId = await readCartId(where);
  const open = cartId ? await getOpenCheckout(store.id, cartId) : null;
  const order = open ? await getOrder(store.id, open.orderId) : null;
  if (!cartId || !open || !order) throw new Error("the checkout stop needs an order waiting for payment from the cookie's cart");
  if (featureOn(store, "bonus")) await requestCartSummary(store, shop.market);
  await checkoutGiftCards(store.id, cartId, open.orderId, shop.market.currency);
  await orderCodeOutcomes(where, open.orderId);
  if (!(open.expired || open.changed || open.subscription)) {
    await deliveryView(where, cartId, t(shop.market.lang).shipping, async () => (await requestCartSummary(store, shop.market)).summary);
  }
  const [customer, reminders] = await Promise.all([getCustomer(store.id), cartRemindersOn(store.id), termsDisplayFor(store, shop.market), smsOffered(store.id)]);
  if (reminders && !customer) await checkoutOptedOut(store.id, cartId);
}

/** The cart's checkout button (`src/app/s/[store]/[market]/cart/actions.ts`): `placeOrder()` for a guest's cart. */
export async function order(shop: Pick<Shop, "market"> & { storeId: string }, cartId: string): Promise<void> {
  const placed = await placeOrder({ storeId: shop.storeId, market: shop.market }, cartId, {});
  if (!placed.ok) throw new Error(`placeOrder: ${placed.problem}`);
}

/** The store Home (`src/app/admin/(gated)/[store]/page.tsx`), through `storeHomeReads()`. */
export const ownerHome = (member: Membership) => storeHomeReads(member);

/** The orders list (`src/app/admin/(gated)/[store]/orders/page.tsx`), through `ordersListReads()`, with an address of no filter. */
export const adminOrders = (member: Membership, input: OrderListInput = {}) => ordersListReads(member.store, input);

/** The products list (`src/app/admin/(gated)/[store]/products/page.tsx`), through `productsListReads()`, as an owner sees it. */
export const adminProducts = (member: Membership) => productsListReads(member, { archived: false, needsFilter: false, canWrite: true, locale: "en" });
