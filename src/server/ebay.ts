import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  EBAY_API,
  EBAY_MARKETPLACES,
  EBAY_SCOPES,
  EBAY_TOKEN,
  ebayAuthorizeUrl,
  ebayOrderSchema,
  ebaySettingsInput,
  inventoryItemBody,
  offerBody,
  ordersFilter,
  readEbayOrder,
  shippingFulfillmentBody,
  type EbaySettings,
  type ListingSource,
} from "@/lib/ebay";
import { ebayApp } from "@/lib/env";
import { openFikenState, randomToken, sealFikenState } from "@/lib/fiken";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { NO_ACCESS, checkPermission, memberCan } from "./permissions";
import { setStockContext } from "./stock-context";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * eBay as a sales channel (D555, `src/lib/ebay.ts`): the owner connects the store's eBay seller account on eBay's consent page; Kaizena Flow keeps
 * the grant encrypted, lists the variants the owner chooses (an inventory item and a fixed-price offer each, at the store's price in the
 * marketplace's currency, with the store's own stock), keeps quantities in step, fetches the orders buyers place there every five minutes (each
 * drawing stock from the store's own locations) and posts their tracking back when the owner marks one sent. Every call goes through `ebayCall()`
 * with an injectable `fetch`, so the tests run against a stand-in. The only writer of `commerce.marketplace_*`. Every action is the owner's (the
 * connection reaches the store's buyers and sells in its name, as an integration does, D41).
 */

export type EbayDeps = { fetch?: typeof fetch; now?: () => Date; app?: ReturnType<typeof ebayApp> };

const OWNER = "owner" as const;
const key = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
const appOf = (deps: EbayDeps) => (deps.app !== undefined ? deps.app : ebayApp());
const nowOf = (deps: EbayDeps) => (deps.now ?? (() => new Date()))();
const fetchOf = (deps: EbayDeps) => deps.fetch ?? fetch;

/** The cookie that carries eBay's consent round trip (signed as Fiken's is, D460). */
export const EBAY_STATE_COOKIE = "kaizen_ebay";
export const EBAY_STATE_PATH = "/api/integrations/ebay";
export const EBAY_STATE_MINUTES = 15;

/** Whether eBay can be offered: Kaizena Flow's app is set up and secrets can be kept. */
export const ebayOffered = (deps: EbayDeps = {}): boolean => appOf(deps) !== null && key() !== null;

export type EbayConnection = { id: string; state: "connected" | "refused" | "off"; settings: EbaySettings | null; lastError: string | null; lastSyncedAt: string | null };

export async function getEbayConnection(storeId: string): Promise<EbayConnection | null> {
  const row = await typedRow(
    z.object({ id: col.uuid, state: z.enum(["connected", "refused", "off"]), settings: z.unknown(), last_error: col.textOrNull, last_synced_at: col.timestampOrNull }),
    sql`select id, state, settings, last_error, last_synced_at from commerce.marketplace_connections where store_id = ${storeId}::uuid and channel = 'ebay'`,
  );
  if (!row) return null;
  const settings = ebaySettingsInput.safeParse(row.settings);
  return { id: row.id, state: row.state, settings: settings.success ? settings.data : null, lastError: row.last_error, lastSyncedAt: row.last_synced_at };
}

// ---------------------------------------------------------------------------------------------------------------------
// Connect
// ---------------------------------------------------------------------------------------------------------------------

/** The owner's press: a signed state for the cookie, and eBay's consent page. */
export async function startEbayConnect(member: Membership, deps: EbayDeps = {}): Promise<{ ok: true; url: string; cookie: string } | { ok: false; problem: "off" | "forbidden" }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const app = appOf(deps);
  const secret = key();
  if (!app || !secret) return { ok: false, problem: "off" };
  const value = { state: randomToken(), store: member.store.slug, account: member.account.id, verifier: randomToken() };
  return { ok: true, cookie: sealFikenState(secret, value, nowOf(deps).getTime()), url: ebayAuthorizeUrl({ clientId: app.clientId, ruName: app.ruName, state: value.state }) };
}

type Tokens = { access: string; refresh: string | null; expiresAt: Date };

async function tokenCall(form: Record<string, string>, deps: EbayDeps): Promise<Tokens | null> {
  const app = appOf(deps);
  if (!app) return null;
  try {
    const response = await fetchOf(deps)(EBAY_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}` },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const body = z.object({ access_token: z.string().min(1), expires_in: z.number().int().positive(), refresh_token: z.string().optional() }).safeParse(await response.json());
    if (!body.success) return null;
    return { access: body.data.access_token, refresh: body.data.refresh_token ?? null, expiresAt: new Date(nowOf(deps).getTime() + (body.data.expires_in - 60) * 1000) };
  } catch (error) {
    log("warn", "ebay.token_failed", {}, error);
    return null;
  }
}

/**
 * eBay's return to `/api/integrations/ebay/callback`: the state checked against the cookie and the owner signed in now the one who pressed; the
 * code exchanged and the grant kept encrypted. The answer is the admin page to go back to.
 */
export async function finishEbayConnect(params: URLSearchParams, cookie: string | undefined, deps: EbayDeps & { owner?: (slug: string) => Promise<Membership | null> } = {}): Promise<string> {
  const secret = key();
  const state = secret ? openFikenState(secret, cookie, nowOf(deps).getTime()) : null;
  if (!secret || !state) return "/admin";
  const back = (outcome: string) => `/admin/${state.store}/integrations/ebay?ebay=${outcome}`;
  if (params.get("state") !== state.state) return back("failed");
  const code = params.get("code");
  if (!code || code.length > 4000) return back(params.get("error") ? "declined" : "failed");
  const member = await (deps.owner ?? ((slug: string) => checkPermission(slug, OWNER)))(state.store);
  if (!member || member.account.id !== state.account) return back("failed");
  const app = appOf(deps);
  if (!app) return back("failed");
  const tokens = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: app.ruName }, deps);
  if (!tokens) return back("failed");
  await db().execute(sql`
    insert into commerce.marketplace_connections (store_id, channel, state, access_token_encrypted, access_expires_at, refresh_token_encrypted, orders_since, updated_by)
    values (${member.store.id}::uuid, 'ebay', 'connected', ${encryptSecret(tokens.access, secret)}, ${tokens.expiresAt.toISOString()}::timestamptz,
            ${tokens.refresh ? encryptSecret(tokens.refresh, secret) : null}, now(), ${member.account.id}::uuid)
    on conflict (store_id, channel) do update set state = 'connected', access_token_encrypted = excluded.access_token_encrypted,
      access_expires_at = excluded.access_expires_at, refresh_token_encrypted = coalesce(excluded.refresh_token_encrypted, commerce.marketplace_connections.refresh_token_encrypted),
      last_error = null, updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(member.account.id, member.store.id, "integration.ebay_connected", {});
  return back("connected");
}

/** A working access token for the store's connection, refreshed with the grant when it has run out; null when there is none or eBay refuses. */
async function accessToken(storeId: string, deps: EbayDeps): Promise<string | null> {
  const secret = key();
  if (!secret) return null;
  const row = await typedRow(
    z.object({ state: col.text, access: col.textOrNull, expires: col.timestampOrNull, refresh: col.textOrNull }),
    sql`select state, access_token_encrypted as access, access_expires_at as expires, refresh_token_encrypted as refresh
        from commerce.marketplace_connections where store_id = ${storeId}::uuid and channel = 'ebay'`,
  );
  if (!row || row.state !== "connected") return null;
  if (row.access && row.expires && Date.parse(row.expires) > nowOf(deps).getTime()) return decryptSecret(row.access, secret);
  if (!row.refresh) return null;
  const tokens = await tokenCall({ grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh, secret), scope: EBAY_SCOPES.join(" ") }, deps);
  if (!tokens) {
    await db().execute(sql`update commerce.marketplace_connections set state = 'refused', last_error = 'eBay no longer takes the connection: connect again.', updated_at = now() where store_id = ${storeId}::uuid and channel = 'ebay'`);
    return null;
  }
  await db().execute(sql`update commerce.marketplace_connections set access_token_encrypted = ${encryptSecret(tokens.access, secret)}, access_expires_at = ${tokens.expiresAt.toISOString()}::timestamptz where store_id = ${storeId}::uuid and channel = 'ebay'`);
  return tokens.access;
}

type CallResult = { ok: true; status: number; body: unknown } | { ok: false; status: number; error: string };

/** One call to eBay's APIs for the store, with its token; eBay's first error message is kept as the reason, never the token. */
async function ebayCall(storeId: string, method: string, path: string, body: unknown, deps: EbayDeps, headers: Record<string, string> = {}): Promise<CallResult> {
  const token = await accessToken(storeId, deps);
  if (!token) return { ok: false, status: 401, error: "eBay is not connected." };
  try {
    const response = await fetchOf(deps)(`${EBAY_API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json", ...(body === undefined ? {} : { "Content-Type": "application/json" }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (response.status === 401) {
      await db().execute(sql`update commerce.marketplace_connections set access_expires_at = null where store_id = ${storeId}::uuid and channel = 'ebay'`);
    }
    if (!response.ok) {
      const first = z.object({ errors: z.array(z.object({ message: z.string() })).min(1) }).safeParse(parsed);
      return { ok: false, status: response.status, error: (first.success ? first.data.errors[0].message : `eBay answered ${response.status}.`).slice(0, 400) };
    }
    return { ok: true, status: response.status, body: parsed };
  } catch (error) {
    log("warn", "ebay.call_failed", { storeId, path: path.split("?")[0] }, error);
    return { ok: false, status: 0, error: "eBay could not be reached." };
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Settings, listings
// ---------------------------------------------------------------------------------------------------------------------

export type EbayStep = { ok: true } | { ok: false; problem: string };

/** The marketplace and the seller's policies, location and category eBay asks every offer to name (the owner's). */
export async function saveEbaySettings(member: Membership, raw: unknown): Promise<EbayStep> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: NO_ACCESS };
  const parsed = ebaySettingsInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: parsed.error.issues[0]?.message ?? "Check the settings." };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`update commerce.marketplace_connections set settings = ${JSON.stringify(parsed.data)}::jsonb, updated_by = ${member.account.id}::uuid, updated_at = now()
        where store_id = ${member.store.id}::uuid and channel = 'ebay' returning id`,
  );
  if (!row) return { ok: false, problem: "Connect eBay first." };
  await audit(member.account.id, member.store.id, "integration.ebay_settings_saved", { marketplace: parsed.data.marketplace });
  return { ok: true };
}

/** Disconnects eBay: the grant is forgotten; listings stay on eBay until ended there, and orders already fetched stay here. */
export async function disconnectEbay(member: Membership): Promise<EbayStep> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: NO_ACCESS };
  await db().execute(sql`update commerce.marketplace_connections set state = 'off', access_token_encrypted = null, refresh_token_encrypted = null, access_expires_at = null, updated_at = now()
    where store_id = ${member.store.id}::uuid and channel = 'ebay'`);
  await audit(member.account.id, member.store.id, "integration.ebay_disconnected", {});
  return { ok: true };
}

/** Chooses variants to list on eBay (`on`), or stops listing them (they are ended at eBay by the owner; here they are marked ended). */
export async function chooseForEbay(member: Membership, variantIds: readonly string[], on: boolean): Promise<{ ok: true; changed: number } | { ok: false; problem: string }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: NO_ACCESS };
  const ids = [...new Set(variantIds)].filter((v) => /^[0-9a-f-]{36}$/i.test(v));
  if (ids.length === 0 || ids.length > 500) return { ok: false, problem: "Choose 1 to 500 variants." };
  const connection = await getEbayConnection(member.store.id);
  if (!connection) return { ok: false, problem: "Connect eBay first." };
  const list = sql.join(ids.map((v) => sql`${v}::uuid`), sql`, `);
  const rows = on
    ? await db().execute(sql`
        insert into commerce.marketplace_listings (store_id, connection_id, variant_id, state)
        select v.store_id, ${connection.id}::uuid, v.id, 'pending' from commerce.product_variants v
        join commerce.products p on p.store_id = v.store_id and p.id = v.product_id and p.kind = 'goods'
        where v.store_id = ${member.store.id}::uuid and v.id in (${list}) and v.delivery = 'physical' and v.sku is not null
        on conflict (connection_id, variant_id) do update set state = 'pending', error = null
        returning variant_id`)
    : await db().execute(sql`update commerce.marketplace_listings set state = 'ended' where store_id = ${member.store.id}::uuid and connection_id = ${connection.id}::uuid and variant_id in (${list}) returning variant_id`);
  return { ok: true, changed: rows.length };
}

/** What the store sends for a variant on a marketplace: its words, pictures, stock and the price of a market in that currency. */
async function listingSource(storeId: string, variantId: string, currency: string): Promise<ListingSource | { problem: string }> {
  const row = await typedRow(
    z.object({ sku: col.textOrNull, gtin: col.textOrNull, title: col.textOrNull, description: col.textOrNull, images: z.array(z.string()).nullable(), in_stock: col.int, price: col.minorOrNull }),
    sql`select v.sku, v.gtin,
               (select t.title from commerce.product_translations t where t.store_id = v.store_id and t.product_id = v.product_id order by t.locale limit 1) as title,
               (select t.description from commerce.product_translations t where t.store_id = v.store_id and t.product_id = v.product_id order by t.locale limit 1) as description,
               (select jsonb_agg(m.url order by m.position) from commerce.product_media m where m.store_id = v.store_id and m.product_id = v.product_id and m.kind = 'image') as images,
               coalesce((select va.in_stock from commerce.variant_availability va where va.store_id = v.store_id and va.variant_id = v.id), 0)::int as in_stock,
               (select cp.amount_minor from commerce.current_prices cp join commerce.markets mk on mk.store_id = cp.store_id and mk.code = cp.market_code and mk.active
                 where cp.store_id = v.store_id and cp.variant_id = v.id and cp.currency = ${currency} order by mk.created_at limit 1) as price
        from commerce.product_variants v where v.store_id = ${storeId}::uuid and v.id = ${variantId}::uuid`,
  );
  if (!row?.sku) return { problem: "The variant has no SKU." };
  if (row.price === null) return { problem: `The store has no price in ${currency} for it: add a market that sells in ${currency}.` };
  return { sku: row.sku, title: row.title ?? row.sku, description: row.description ?? "", imageUrls: row.images ?? [], gtin: row.gtin, quantity: row.in_stock, priceMinor: row.price, currency };
}

/**
 * Sends the store's listings to eBay: each pending or listed variant's inventory item (with its stock now), then its offer (made or updated),
 * then publishes a new one. A failure is kept on the listing with eBay's reason and tried again next time. At most `limit` variants a run.
 */
export async function syncEbayListings(storeId: string, deps: EbayDeps = {}, limit = 50): Promise<{ listed: number; failed: number }> {
  const connection = await getEbayConnection(storeId);
  if (!connection || connection.state !== "connected" || !connection.settings) return { listed: 0, failed: 0 };
  const settings = connection.settings;
  const market = EBAY_MARKETPLACES[settings.marketplace as keyof typeof EBAY_MARKETPLACES];
  const due = await typedRows(
    z.object({ variant_id: col.uuid, offer_id: col.textOrNull, listing_id: col.textOrNull }),
    sql`select variant_id, offer_id, listing_id from commerce.marketplace_listings where store_id = ${storeId}::uuid and connection_id = ${connection.id}::uuid
          and state in ('pending', 'listed', 'error') order by synced_at nulls first limit ${limit}`,
  );
  let listed = 0;
  let failed = 0;
  for (const row of due) {
    const fail = async (error: string) => {
      failed += 1;
      await db().execute(sql`update commerce.marketplace_listings set state = 'error', error = ${error.slice(0, 500)}, synced_at = now() where connection_id = ${connection.id}::uuid and variant_id = ${row.variant_id}::uuid`);
    };
    const source = await listingSource(storeId, row.variant_id, market.currency);
    if ("problem" in source) {
      await fail(source.problem);
      continue;
    }
    const item = await ebayCall(storeId, "PUT", `/sell/inventory/v1/inventory_item/${encodeURIComponent(source.sku)}`, inventoryItemBody(source), deps, { "Content-Language": market.language });
    if (!item.ok) {
      await fail(item.error);
      continue;
    }
    let offerId = row.offer_id;
    const offer = offerId
      ? await ebayCall(storeId, "PUT", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}`, offerBody(source, settings), deps, { "Content-Language": market.language })
      : await ebayCall(storeId, "POST", "/sell/inventory/v1/offer", offerBody(source, settings), deps, { "Content-Language": market.language });
    if (!offer.ok) {
      await fail(offer.error);
      continue;
    }
    if (!offerId) offerId = z.object({ offerId: z.string() }).safeParse(offer.body).data?.offerId ?? null;
    let listingId = row.listing_id;
    if (offerId && !listingId) {
      const published = await ebayCall(storeId, "POST", `/sell/inventory/v1/offer/${encodeURIComponent(offerId)}/publish`, undefined, deps);
      if (!published.ok) {
        await db().execute(sql`update commerce.marketplace_listings set offer_id = ${offerId} where connection_id = ${connection.id}::uuid and variant_id = ${row.variant_id}::uuid`);
        await fail(published.error);
        continue;
      }
      listingId = z.object({ listingId: z.string() }).safeParse(published.body).data?.listingId ?? null;
    }
    await db().execute(sql`
      update commerce.marketplace_listings set state = 'listed', offer_id = ${offerId}, listing_id = ${listingId}, price_minor = ${source.priceMinor},
        currency = ${source.currency}, quantity = ${source.quantity}, error = null, synced_at = now()
      where connection_id = ${connection.id}::uuid and variant_id = ${row.variant_id}::uuid`);
    listed += 1;
  }
  await db().execute(sql`update commerce.marketplace_connections set last_synced_at = now() where id = ${connection.id}::uuid`);
  return { listed, failed };
}

// ---------------------------------------------------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------------------------------------------------

/**
 * Fetches the orders placed on eBay since the last time (up to 50 a run) and keeps each once, matched to the store's variants by SKU. A new open
 * order draws its units from the store's own locations in rank order (a correction "Sold on eBay" in the stock history), never below what is
 * there: what is short is noted on the order. eBay already took the buyer's payment.
 */
export async function importEbayOrders(storeId: string, deps: EbayDeps = {}): Promise<number> {
  const connection = await typedRow(
    z.object({ id: col.uuid, since: col.timestampOrNull }),
    sql`select id, orders_since as since from commerce.marketplace_connections where store_id = ${storeId}::uuid and channel = 'ebay' and state = 'connected'`,
  );
  if (!connection) return 0;
  const since = connection.since ? new Date(Date.parse(connection.since) - 60 * 60_000) : new Date(nowOf(deps).getTime() - 24 * 3600_000);
  const answer = await ebayCall(storeId, "GET", `/sell/fulfillment/v1/order?filter=${encodeURIComponent(ordersFilter(since))}&limit=50`, undefined, deps);
  if (!answer.ok) {
    await db().execute(sql`update commerce.marketplace_connections set last_error = ${answer.error.slice(0, 500)} where id = ${connection.id}::uuid`);
    return 0;
  }
  const orders = z.object({ orders: z.array(z.unknown()).default([]) }).safeParse(answer.body);
  let made = 0;
  for (const raw of orders.success ? orders.data.orders : []) {
    const parsed = ebayOrderSchema.safeParse(raw);
    if (!parsed.success) continue;
    const order = readEbayOrder(parsed.data);
    const skus = order.lines.map((l) => l.sku).filter((s): s is string => Boolean(s));
    const variants = skus.length
      ? await typedRows(z.object({ id: col.uuid, sku: col.text }), sql`select id, sku from commerce.product_variants where store_id = ${storeId}::uuid and sku in (${sql.join(skus.map((s) => sql`${s}`), sql`, `)})`)
      : [];
    const bySku = new Map(variants.map((v) => [v.sku, v.id]));
    const lines = order.lines.map((l) => ({ ...l, variantId: l.sku ? (bySku.get(l.sku) ?? null) : null }));
    const created = await db().transaction(async (tx) => {
      const row = await typedRow(
        z.object({ id: col.uuid }),
        sql`insert into commerce.marketplace_orders (store_id, connection_id, external_id, placed_at, total_minor, currency, buyer_name, buyer_email, ship_to, lines, state)
            values (${storeId}::uuid, ${connection.id}::uuid, ${order.externalId}, ${order.placedAt}::timestamptz, ${order.totalMinor}, ${order.currency},
                    ${order.buyerName}, ${order.buyerEmail}, ${JSON.stringify(order.shipTo)}::jsonb, ${JSON.stringify(lines)}::jsonb, ${order.cancelled ? "cancelled" : "open"})
            on conflict (connection_id, external_id) do nothing returning id`,
        tx,
      );
      if (!row) return null;
      if (order.cancelled) return row.id;
      // Units drawn from the store's own locations, in rank order, never below what is there.
      const short: string[] = [];
      await setStockContext(tx, { reason: "correction", source: "system", note: `Sold on eBay, order ${order.externalId}`.slice(0, 200) });
      for (const line of lines) {
        if (!line.variantId) {
          if (line.sku) short.push(`${line.sku}: not a SKU of the store`);
          continue;
        }
        let left = line.quantity;
        const levels = await typedRows(
          z.object({ location_id: col.uuid, on_hand: col.int }),
          sql`select l.location_id, l.on_hand from commerce.inventory_levels l
              join commerce.inventory_locations loc on loc.store_id = l.store_id and loc.id = l.location_id and loc.active and loc.supplier_id is null
              where l.store_id = ${storeId}::uuid and l.variant_id = ${line.variantId}::uuid and l.on_hand > 0
              order by loc.priority, loc.created_at, loc.id for update of l`,
          tx,
        );
        for (const level of levels) {
          if (left === 0) break;
          const take = Math.min(left, level.on_hand);
          await tx.execute(sql`update commerce.inventory_levels set on_hand = on_hand - ${take}, updated_at = now() where variant_id = ${line.variantId}::uuid and location_id = ${level.location_id}::uuid`);
          left -= take;
        }
        if (left > 0) short.push(`${line.sku}: ${left} short`);
      }
      await tx.execute(sql`update commerce.marketplace_orders set stock_drawn = true, error = ${short.length ? short.join("; ").slice(0, 500) : null} where id = ${row.id}::uuid`);
      return row.id;
    });
    if (created) made += 1;
  }
  await db().execute(sql`update commerce.marketplace_connections set orders_since = ${nowOf(deps).toISOString()}::timestamptz, last_error = null where id = ${connection.id}::uuid`);
  return made;
}

export type MarketplaceOrderRow = {
  id: string;
  externalId: string;
  placedAt: string;
  totalMinor: number;
  currency: string;
  buyerName: string;
  shipTo: Record<string, string>;
  lines: { lineItemId: string; sku: string | null; title: string; quantity: number }[];
  state: "open" | "sent" | "cancelled";
  carrier: string | null;
  trackingNumber: string | null;
  error: string | null;
};

/** The store's eBay orders, newest first. */
export async function listMarketplaceOrders(storeId: string, limit = 100): Promise<MarketplaceOrderRow[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      external_id: col.text,
      placed_at: col.timestamp,
      total_minor: col.minor,
      currency: col.currency,
      buyer_name: col.text,
      ship_to: z.record(z.string(), z.string()),
      lines: z.array(z.object({ lineItemId: z.string(), sku: z.string().nullable(), title: z.string(), quantity: z.number() })),
      state: z.enum(["open", "sent", "cancelled"]),
      carrier: col.textOrNull,
      tracking_number: col.textOrNull,
      error: col.textOrNull,
    }),
    sql`select id, external_id, placed_at, total_minor, currency, buyer_name, ship_to, lines, state, carrier, tracking_number, error
        from commerce.marketplace_orders where store_id = ${storeId}::uuid order by placed_at desc limit ${Math.min(Math.max(limit, 1), 500)}`,
  );
  return rows.map((r) => ({ id: r.id, externalId: r.external_id, placedAt: r.placed_at, totalMinor: r.total_minor, currency: r.currency, buyerName: r.buyer_name, shipTo: r.ship_to, lines: r.lines, state: r.state, carrier: r.carrier, trackingNumber: r.tracking_number, error: r.error }));
}

/** Marks an eBay order sent: its tracking goes to eBay (every line), then the order here is `sent`. The owner's. */
export async function markEbayOrderSent(member: Membership, orderId: string, carrier: string, trackingNumber: string, deps: EbayDeps = {}): Promise<EbayStep> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: NO_ACCESS };
  const tracking = trackingNumber.trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9 -]{1,58}[A-Za-z0-9]$/.test(tracking)) return { ok: false, problem: "Check the tracking number." };
  if (!/^[A-Za-z0-9 ._-]{2,40}$/.test(carrier)) return { ok: false, problem: "Choose the carrier." };
  const order = await typedRow(
    z.object({ external_id: col.text, state: col.text, lines: z.array(z.object({ lineItemId: z.string(), quantity: z.number() })) }),
    sql`select external_id, state, lines from commerce.marketplace_orders where store_id = ${member.store.id}::uuid and id = ${orderId}::uuid`,
  );
  if (!order) return { ok: false, problem: "This order is not in this store." };
  if (order.state !== "open") return { ok: false, problem: "This order is sent or cancelled already." };
  const posted = await ebayCall(member.store.id, "POST", `/sell/fulfillment/v1/order/${encodeURIComponent(order.external_id)}/shipping_fulfillment`, shippingFulfillmentBody(order.lines, carrier, tracking, nowOf(deps)), deps);
  if (!posted.ok) return { ok: false, problem: `eBay did not take it: ${posted.error}` };
  await db().execute(sql`update commerce.marketplace_orders set state = 'sent', carrier = ${carrier}, tracking_number = ${tracking}, sent_at = now() where id = ${orderId}::uuid and state = 'open'`);
  await audit(member.account.id, member.store.id, "integration.ebay_order_sent", {}, { target: { type: "marketplace_order", id: orderId } });
  return { ok: true };
}

/** The five-minute job: for each connected store, orders fetched and listings sent (a few stores a run, the oldest synced first). */
export async function runEbayJobs(deps: EbayDeps = {}): Promise<{ stores: number; orders: number; listed: number }> {
  if (!ebayOffered(deps)) return { stores: 0, orders: 0, listed: 0 };
  const stores = await typedRows(
    z.object({ store_id: col.uuid }),
    sql`select store_id from commerce.marketplace_connections where channel = 'ebay' and state = 'connected' order by last_synced_at nulls first limit 10`,
  );
  let orders = 0;
  let listed = 0;
  for (const { store_id: storeId } of stores) {
    try {
      orders += await importEbayOrders(storeId, deps);
      listed += (await syncEbayListings(storeId, deps)).listed;
    } catch (error) {
      log("error", "ebay.job_failed", { storeId }, error);
    }
  }
  return { stores: stores.length, orders, listed };
}

