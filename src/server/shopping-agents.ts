import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { marketPath, marketUrl, storeSiteUrl } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import {
  askedCountry,
  cartLines,
  LOOKUP_MAX,
  productGid,
  readGid,
  searchArgs,
  TOOL_CAPABILITY,
  toolArgs,
  ucpMeta,
  variantGid,
  type AgentToolName,
} from "@/lib/shopping-agents";
import { featureOn } from "@/lib/store-features";
import { HANDOFF_MINUTES } from "@/lib/wordpress-cart";
import type { Market } from "@/lib/markets";

import { getProduct, getVariantStock, listGridProducts, type ProductDetail } from "./catalog";
import { createHandoffCart } from "./cart-handoff";
import { log } from "./log";
import { OFFERED } from "./product-conditions";
import { rankedSearch } from "./search";
import { offeredMarketIn } from "./shop";
import { getStore, type Store } from "./stores";
import { col, typedRows } from "./typed-rows";
import { quoteCart } from "./wordpress-shop";

/**
 * A store's public endpoint for AI shopping agents (wave 8 unit I, D353): the UCP profile and the MCP server's tools, answered from the
 * store's own reads only (the catalogue's cached product reads, stock per request, the WordPress quote for a cart's totals and D170's hand-off
 * for the cart itself), so a price, a stock state or a cart is never worked out a second way. Nothing is ordered or paid here and nothing of a
 * person is asked for or kept; the route counts calls per store and per caller (`takeBudget()`, `agent`) and logs counts only.
 */

/** Why a store does not serve shopping agents, or null when it does. */
export function agentProblem(store: Store): "closed" | "off" | "private" | "no_shop" | "no_assistants" | null {
  if (store.status !== "active" || store.isTemplate || store.starter) return "closed";
  if (!store.shoppingAgents) return "off";
  if (store.privateMode) return "private";
  if (!featureOn(store, "shop")) return "no_shop";
  // The store's own switch for AI assistants (SEO & Reach): an agent is one, so it is shut out with them.
  if (!store.seo.aiAssistants) return "no_assistants";
  return null;
}

/** The store an agent asks for, when it serves agents. */
export async function agentStore(slug: string): Promise<Store | null> {
  if (!/^[a-z0-9][a-z0-9-]{0,62}$/.test(slug)) return null;
  const store = await getStore(slug);
  return store && agentProblem(store) === null ? store : null;
}

/** The endpoint's address and the profile's, for the store. */
export const agentEndpoint = (slug: string) => `${siteUrl()}/api/ucp/${slug}/mcp`;
export const agentProfileUrl = (slug: string) => `${storeSiteUrl(slug)}/.well-known/ucp`;

export class AgentToolError extends Error {}
const fail = (message: string): never => {
  throw new AgentToolError(message);
};

function marketFor(store: Store, args: Record<string, unknown>): Market {
  const country = askedCountry(args);
  const market = offeredMarketIn(store, country ? country.toLowerCase() : null);
  return market ?? fail(`The store does not sell to ${country}. It sells to: ${store.markets.map((m) => m.code).join(", ")}.`);
}

const money = (amount: number, currency: string) => ({ amount, currency });

/** A product as UCP's catalog describes it, from the product page's own read and the stock now. */
async function ucpProduct(store: Store, market: Market, detail: ProductDetail) {
  const origin = storeSiteUrl(store.slug);
  const absolute = (url: string) => (url.startsWith("/") ? `${origin}${url}` : url);
  const stock = await getVariantStock(store.id, detail.variants.map((v) => v.id));
  const cartable = detail.kind === "goods" && !detail.subscriptionOnly;
  const prices = detail.variants.map((v) => v.price.amountMinor);
  const description = detail.description.replace(/\s+/g, " ").trim();
  return {
    id: productGid(detail.id),
    handle: detail.handle,
    title: detail.title,
    description: { plain: description },
    url: `${origin}${marketPath(store.slug, market.slug, `/p/${detail.handle}`)}`,
    media: detail.images.filter((image) => image.kind === "image").map((image) => ({ type: "image", url: absolute(image.url), alt_text: image.alt || detail.title })),
    price_range: { min: money(Math.min(...prices), market.currency), max: money(Math.max(...prices), market.currency) },
    variants: detail.variants.map((variant) => {
      const held = stock.get(variant.id);
      const title = Object.values(variant.options).join(" / ") || detail.title;
      return {
        id: variantGid(variant.id),
        title,
        description: { plain: title },
        sku: variant.sku,
        ...(variant.gtin ? { barcodes: [{ type: "gtin", value: variant.gtin }] } : {}),
        // With VAT, as the store charges it, in the market's currency (UCP: minor units).
        price: money(variant.price.amountMinor, market.currency),
        ...(variant.price.referenceMinor !== null ? { list_price: money(variant.price.referenceMinor, market.currency) } : {}),
        availability: { available: cartable && (held ? held.canBuy : variant.delivery !== "physical") },
        options: Object.entries(variant.options).map(([name, value]) => ({ name, value })),
        ...(variant.image ? { media: [{ type: "image", url: absolute(variant.image.url), alt_text: variant.image.alt || title }] } : {}),
      };
    }),
    // What the endpoint can put in a cart: goods bought once (an appointment, a stay or a subscription is booked in the store).
    metadata: { vat: "included", cartable },
  };
}

/** The handles of the store's offered products among these ids (a product's or a variant's), in the order asked. */
async function handlesOf(store: Store, ids: { kind: "product" | "variant" | "either"; id: string }[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await typedRows(
    z.object({ asked: col.uuid, handle: col.text }),
    sql`
      select x.asked, p.handle
      from unnest(${`{${ids.map((i) => i.id).join(",")}}`}::uuid[]) with ordinality as x(asked, n)
      join commerce.products p on p.store_id = ${store.id}::uuid
        and (p.id = x.asked or exists (select 1 from commerce.product_variants v where v.store_id = p.store_id and v.product_id = p.id and v.id = x.asked))
      where p.status = 'active' and ${OFFERED}
      order by x.n
    `,
  );
  return [...new Set(rows.map((row) => row.handle))];
}

async function products(store: Store, market: Market, handles: string[]) {
  const details = (await Promise.all(handles.map((handle) => getProduct(store.id, market, handle)))).filter((d): d is ProductDetail => d !== null);
  return Promise.all(details.filter((d) => d.variants.length > 0).map((detail) => ucpProduct(store, market, detail)));
}

/** Runs one tool for an agent; a refusal is an `AgentToolError` with plain words. */
export async function runAgentTool(store: Store, name: string, raw: Record<string, unknown>): Promise<Record<string, unknown>> {
  const tool = name as AgentToolName;
  if (!(tool in TOOL_CAPABILITY)) return fail(`No tool called ${name}.`);
  const ucp = ucpMeta([TOOL_CAPABILITY[tool]]);
  if (tool === "search_catalog") {
    const args = toolArgs(raw, "catalog");
    const market = marketFor(store, args);
    const { query, limit } = searchArgs(args);
    // Keyword search only (never a model): the same ranking as the store's own search page without meaning.
    const ids = query ? (await rankedSearch({ storeId: store.id, market }, query, limit, null)).ids : null;
    const found = ids === null ? await listGridProducts(store.id, market, { categoryIds: [], tagIds: [], sort: "newest", limit }) : null;
    const handles = found ? found.map((p) => p.handle) : await handlesOf(store, (ids ?? []).map((id) => ({ kind: "product" as const, id })));
    const answer = await products(store, market, handles.slice(0, limit));
    log("info", "ucp.search", { storeId: store.id, products: answer.length });
    return { ucp, products: answer };
  }
  if (tool === "lookup_catalog") {
    const args = toolArgs(raw, "catalog");
    const market = marketFor(store, args);
    const asked = (Array.isArray(args.ids) ? args.ids : []).slice(0, LOOKUP_MAX).map(readGid).filter((id): id is NonNullable<ReturnType<typeof readGid>> => id !== null);
    if (asked.length === 0) return fail("Give ids: products' or variants' ids.");
    const answer = await products(store, market, await handlesOf(store, asked));
    log("info", "ucp.lookup", { storeId: store.id, products: answer.length });
    return { ucp, products: answer };
  }
  if (tool === "get_product") {
    const args = toolArgs(raw, "catalog");
    const market = marketFor(store, args);
    const id = readGid(args.id) ?? fail("Give id: a product's or a variant's id.");
    const [handle] = await handlesOf(store, [id]);
    const [product] = handle ? await products(store, market, [handle]) : [];
    if (!product) return fail("The store sells no such product in that country.");
    log("info", "ucp.product", { storeId: store.id });
    return { ucp, product };
  }
  const args = toolArgs(raw, "cart");
  const market = marketFor(store, args);
  const read = cartLines(args);
  if ("problem" in read) return fail(read.problem);
  const quote = await quoteCart(store, market.slug, read.lines);
  if (!quote) return fail("The store does not sell to that country.");
  const made = await createHandoffCart({ storeId: store.id, market }, read.lines, "cart", { source: "agent" });
  if (!made.ok) return fail("Nothing asked for can be bought in the store now.");
  const kept = new Map(made.lines.map((line) => [line.variantId, line.quantity]));
  const lines = quote.lines.filter((line) => (kept.get(line.variant_id) ?? 0) > 0);
  const subtotal = lines.reduce((sum, line) => sum + (line.unit?.amount_minor ?? 0) * (kept.get(line.variant_id) ?? 0), 0);
  log("info", "ucp.cart", { storeId: store.id, lines: lines.length });
  return {
    ucp,
    id: made.cartId,
    currency: market.currency,
    line_items: lines.map((line) => {
      const quantity = kept.get(line.variant_id) ?? 0;
      const total = (line.unit?.amount_minor ?? 0) * quantity;
      return {
        id: variantGid(line.variant_id),
        item: { id: variantGid(line.variant_id), title: line.title, price: line.unit?.amount_minor ?? 0 },
        quantity,
        totals: [{ type: "subtotal", amount: total }],
      };
    }),
    // Shipping, discounts and the total are worked out in the store's checkout, with the address.
    totals: [{ type: "subtotal", amount: subtotal, display_text: quote.vat_label }],
    continue_url: `${marketUrl(store.slug, market.slug, "/cart/resume")}?t=${encodeURIComponent(made.token)}`,
    expires_at: new Date(Date.now() + HANDOFF_MINUTES * 60_000).toISOString(),
    messages: made.lines
      .filter((line) => line.quantity === 0)
      .map((line) => ({ type: "warning", code: "unavailable", content: `${variantGid(line.variantId)} cannot be bought now and was left out.` })),
  };
}
