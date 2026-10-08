import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { featureOn } from "@/lib/store-features";
import { t } from "@/lib/i18n";
import { storeSiteUrl, marketPath } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { categoryTree } from "@/lib/taxonomy";
import { summarize } from "@/lib/seo";
import { HANDOFFS_PER_HOUR, cartLabels, type CartLabels } from "@/lib/wordpress-cart";
import {
  CALLS_PER_HOUR,
  CODE_MINUTES,
  CODE_PREFIX,
  EXCHANGES_PER_HOUR,
  
  TOKEN_PREFIX,
  hashSecret,
  looksLikeCode,
  looksLikeToken,
  siteOrigin,
  verifierMatches,
  viewIsComplete,
  type ApprovalRequest,
  type ViewQuery,
} from "@/lib/wordpress";
import { wordpressPrice, type WordpressPrice } from "@/lib/wordpress-view";

import { listGridProducts } from "./catalog";
import { cardCarts, type CardCart } from "./wordpress-shop";
import { gridScope } from "./content-grid";
import { offeredMarketIn } from "./shop";
import { getStore, type Store } from "./stores";
import { currentTerms } from "./taxonomy";
import { OFFERED } from "./product-conditions";

type Row = Record<string, unknown>;

/**
 * The WordPress plugin's side of Kaizen (D169, `docs/wordpress-plugin.md`): an owner approves a site in the admin, the plugin swaps the
 * one-time code for a token, and the token reads the public catalogue of the stores the account belongs to: their markets, categories,
 * tags and products, priced and worded as the storefront does. A token cannot change anything, reads no order, customer or setting, and
 * is kept only as a hash. Everything is looked up again on each call, so removing someone from a store, or disabling their account,
 * ends what the site can see at once.
 */

export type WpConnection = { id: string; siteUrl: string; siteName: string; createdAt: string; connectedAt: string | null; lastUsedAt: string | null };

/** The slice an hour is counted in, and the bucket a connection's calls go in (`commerce.chat_usage`, no store). */
async function take(bucket: string, limit: number): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (null, ${bucket}, date_trunc('hour', now()), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number(row?.count ?? 0) <= limit;
}

/** Keeps the approval and returns the code to hand to the plugin (never kept in clear; five minutes). */
export async function startApproval(accountId: string, request: ApprovalRequest): Promise<string> {
  // Approvals nobody collected, a day after they ran out, are no use to anyone.
  await db().execute(sql`
    delete from commerce.wordpress_connections
    where token_hash is null and code_expires_at < now() - interval '1 day'
  `);
  const code = `${CODE_PREFIX}${randomBytes(32).toString("base64url")}`;
  await db().execute(sql`
    insert into commerce.wordpress_connections (account_id, site_url, site_name, code_hash, code_challenge, code_expires_at)
    values (${accountId}::uuid, ${request.site}, ${request.name}, ${hashSecret(code)}, ${request.challenge}, now() + make_interval(mins => ${CODE_MINUTES}))
  `);
  return code;
}

export type Exchange = { ok: true; token: string; account: { email: string; name: string | null }; connectionId: string } | { ok: false; reason: "invalid" | "limited" };

/**
 * Swaps a code for a token: once, within its minutes, for the site that was approved and the plugin that holds the verifier. Every
 * failure is the same answer, so nothing says which part was wrong.
 */
export async function exchangeCode(input: { code: unknown; verifier: unknown; site: unknown }): Promise<Exchange> {
  const code = typeof input.code === "string" ? input.code : "";
  const verifier = typeof input.verifier === "string" ? input.verifier : "";
  const site = siteOrigin(input.site);
  if (!looksLikeCode(code) || !site || verifier.length > 100) return { ok: false, reason: "invalid" };
  if (!(await take("wp:exchange", EXCHANGES_PER_HOUR))) return { ok: false, reason: "limited" };
  const [row] = await db().execute<Row>(sql`
    select id, code_challenge from commerce.wordpress_connections
    where code_hash = ${hashSecret(code)} and token_hash is null and revoked_at is null
      and code_expires_at > now() and site_url = ${site}
  `);
  if (!row || !verifierMatches(verifier, String(row.code_challenge ?? ""))) return { ok: false, reason: "invalid" };
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  // The claim: only one of two simultaneous swaps of the same code gets the row.
  const [claimed] = await db().execute<Row>(sql`
    update commerce.wordpress_connections
    set token_hash = ${hashSecret(token)}, code_hash = null, code_challenge = null, code_expires_at = null, connected_at = now()
    where id = ${String(row.id)}::uuid and token_hash is null
    returning id, account_id
  `);
  if (!claimed) return { ok: false, reason: "invalid" };
  const [account] = await db().execute<Row>(sql`select email, name from commerce.accounts where id = ${String(claimed.account_id)}::uuid`);
  return { ok: true, token, connectionId: String(claimed.id), account: { email: String(account?.email ?? ""), name: account?.name ? String(account.name) : null } };
}

export type WpCaller = { connectionId: string; accountId: string; email: string };

/** Who a bearer token is: a live connection of an active account, or why not. Counts the call against the connection's hour. */
export async function authenticate(header: string | null): Promise<{ ok: true; caller: WpCaller } | { ok: false; reason: "unauthorized" | "limited" }> {
  const token = header?.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!looksLikeToken(token)) return { ok: false, reason: "unauthorized" };
  const [row] = await db().execute<Row>(sql`
    select c.id, c.account_id, a.email, c.last_used_at
    from commerce.wordpress_connections c
    join commerce.accounts a on a.id = c.account_id and a.disabled_at is null
    where c.token_hash = ${hashSecret(token)} and c.revoked_at is null
  `);
  if (!row) return { ok: false, reason: "unauthorized" };
  const id = String(row.id);
  if (!(await take(`wp:${id}`, CALLS_PER_HOUR))) return { ok: false, reason: "limited" };
  // Noted at most every ten minutes: a busy site is not a write on every call.
  await db().execute(sql`
    update commerce.wordpress_connections set last_used_at = now()
    where id = ${id}::uuid and (last_used_at is null or last_used_at < now() - interval '10 minutes')
  `);
  return { ok: true, caller: { connectionId: id, accountId: String(row.account_id), email: String(row.email) } };
}

/** A connection's hand-overs of carts in the hour (`HANDOFFS_PER_HOUR`): false once it is over. */
export async function takeHandoff(connectionId: string): Promise<boolean> {
  return take(`wp:cart:${connectionId}`, HANDOFFS_PER_HOUR);
}

/** The sites an account has connected, newest first (the ones whose approval was never collected are not listed). */
export async function connectionsOf(accountId: string): Promise<WpConnection[]> {
  const rows = await db().execute<Row>(sql`
    select id, site_url, site_name, created_at, connected_at, last_used_at
    from commerce.wordpress_connections
    where account_id = ${accountId}::uuid and token_hash is not null and revoked_at is null
    order by connected_at desc
  `);
  return rows.map((r) => ({
    id: String(r.id),
    siteUrl: String(r.site_url),
    siteName: String(r.site_name ?? r.site_url),
    createdAt: new Date(String(r.created_at)).toISOString(),
    connectedAt: r.connected_at ? new Date(String(r.connected_at)).toISOString() : null,
    lastUsedAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null,
  }));
}

/** Ends a connection of the account's (the plugin's next call is refused). False when it was not theirs or already ended. */
export async function revokeConnection(accountId: string, connectionId: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(connectionId)) return false;
  const rows = await db().execute<Row>(sql`
    update commerce.wordpress_connections set revoked_at = now(), token_hash = null
    where id = ${connectionId}::uuid and account_id = ${accountId}::uuid and revoked_at is null
    returning id
  `);
  return rows.length > 0;
}

/** Ends the connection a token belongs to, from the plugin's own Disconnect. */
export async function revokeOwn(caller: WpCaller): Promise<void> {
  await revokeConnection(caller.accountId, caller.connectionId);
}

export type WpMarket = { slug: string; country: string; name: string; currency: string; language: string };
export type WpStore = { slug: string; name: string; role: string; open: boolean; url: string; markets: WpMarket[] };

/** The stores the account belongs to now (an owner or staff, not ended, not closed), with their markets. */
export async function storesOf(accountId: string): Promise<WpStore[]> {
  const rows = await db().execute<Row>(sql`
    select s.slug, m.role
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${accountId}::uuid and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now())
      and s.status <> 'closed' and not (s.is_template or s.starter)
    order by lower(s.name), s.slug
  `);
  const out: WpStore[] = [];
  for (const row of rows) {
    const store = await getStore(String(row.slug));
    // A website (D178 step 5: the online shop off) has nothing for the plugin to show or sell.
    if (!store || !featureOn(store, "shop")) continue;
    out.push({
      slug: store.slug,
      name: store.name,
      role: String(row.role),
      open: store.status === "active",
      url: storeSiteUrl(store.slug) + (marketPath(store.slug, store.markets[0]?.slug ?? "") || "/"),
      markets: store.markets.map((m) => ({ slug: m.slug, country: m.code, name: m.name, currency: m.currency, language: m.lang })),
    });
  }
  return out;
}

/** One of the account's stores by slug, or null (never says whether the slug exists for someone else). */
export async function storeFor(accountId: string, slug: string): Promise<Store | null> {
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) return null;
  const [row] = await db().execute<Row>(sql`
    select 1 as found
    from commerce.store_members m
    join commerce.stores s on s.id = m.store_id
    where m.account_id = ${accountId}::uuid and s.slug = ${slug} and m.disabled_at is null
      and (m.expires_at is null or m.expires_at > now()) and s.status <> 'closed' and not (s.is_template or s.starter)
  `);
  if (!row) return null;
  const store = await getStore(slug);
  // A website (D178 step 5: the online shop off) is the plain 404 of a store that is not there: no products, views, quotes or carts.
  return store && featureOn(store, "shop") ? store : null;
}

export type WpTerms = { categories: { id: string; name: string; depth: number }[]; tags: { id: string; name: string }[] };

/** A store's categories (as a tree, with their depth) and tags, to choose from. */
export async function termsOf(store: Store): Promise<WpTerms> {
  const terms = await currentTerms(store.id, "product");
  return {
    categories: categoryTree(terms).map((c) => ({ id: c.id, name: c.name, depth: c.depth })),
    tags: terms.filter((x) => x.kind === "tag").sort((a, b) => a.name.localeCompare(b.name)).map((x) => ({ id: x.id, name: x.name })),
  };
}

export type WpProduct = {
  id: string;
  handle: string;
  title: string;
  excerpt: string;
  url: string;
  image: { url: string; alt: string } | null;
  price: WordpressPrice;
  /** Whether it can be put in a cart held on this site, with its variant when it has only one. */
  cart: CardCart;
};

export type WpView = { store: { slug: string; name: string }; market: WpMarket; open: boolean; products: WpProduct[]; shop_url: string; labels?: CartLabels };

const absolute = (url: string) => (url.startsWith("/") ? `${siteUrl()}${url}` : url);

/**
 * The products a view asks for, as the storefront would list them in the market (open stores only: a store not open has no products
 * to show, so the view is empty). The same read as a content grid (D51), so a price, a reduction and a unit price are the shop's own.
 */
export async function viewOf(store: Store, view: ViewQuery): Promise<WpView | null> {
  const market = offeredMarketIn(store, view.market || null);
  if (!market) return null;
  const marketOut: WpMarket = { slug: market.slug, country: market.code, name: market.name, currency: market.currency, language: market.lang };
  const base = { store: { slug: store.slug, name: store.name }, market: marketOut, shop_url: storeSiteUrl(store.slug) + (marketPath(store.slug, market.slug) || "/") };
  if (store.status !== "active" || !viewIsComplete(view)) return { ...base, open: store.status === "active", products: [] };
  const scope = await gridScope(store.id, { categories: view.categories, tags: view.tags });
  if (!scope) return { ...base, open: true, products: [] };
  const products = await listGridProducts(store.id, market, { ...scope, sort: view.sort, limit: view.limit, ...(view.source === "products" && { ids: view.ids }) });
  const words = t(market.lang);
  const carts = await cardCarts(store, market, products.map((p) => p.id));
  return {
    ...base,
    open: true,
    labels: cartLabels(words, { viewInStore: "" }),
    products: products.map((p) => ({
      id: p.id,
      handle: p.handle,
      title: p.title,
      excerpt: summarize(p.description, 200),
      url: storeSiteUrl(store.slug) + marketPath(store.slug, market.slug, `/p/${p.handle}`),
      image: p.image ? { url: absolute(p.image.url), alt: p.image.alt } : null,
      price: wordpressPrice(p.price, p.priceVaries, market.locale, words),
      cart: carts.get(p.id) ?? { cartable: false, reason: "service", variant_id: null, variant_count: 0, sold_out: false },
    })),
  };
}

/** Products to choose from by hand: a store's active products, found by name, newest first. */
export async function pickProducts(store: Store, query: string, limit: number): Promise<{ id: string; title: string; handle: string; image: string | null }[]> {
  const needle = query.trim().slice(0, 80).replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = await db().execute<Row>(sql`
    select p.id, p.handle, coalesce(tl.title, tf.title) as title, coalesce(m.thumbnail_url, m.url) as image
    from commerce.products p
    left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${store.markets[0]?.locale ?? "en-GB"}
    left join lateral (select title from commerce.product_translations where product_id = p.id order by locale limit 1) tf on true
    left join lateral (select url, thumbnail_url from commerce.product_media where product_id = p.id order by position limit 1) m on true
    where p.store_id = ${store.id}::uuid and p.status = 'active' and ${OFFERED}
      and (${needle} = '' or coalesce(tl.title, tf.title) ilike ${`%${needle}%`} escape '\\' or p.handle ilike ${`%${needle}%`} escape '\\')
    order by p.created_at desc, p.handle
    limit ${Math.max(1, Math.min(50, limit))}
  `);
  return rows.map((r) => ({ id: String(r.id), handle: String(r.handle), title: String(r.title ?? r.handle), image: r.image ? absolute(String(r.image)) : null }));
}

