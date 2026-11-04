import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { designLookInput } from "@/lib/brand-design";
import { parsePrice } from "@/lib/product-input";
import { normalizeCode } from "@/lib/discounts";
import { featureOn } from "@/lib/store-features";
import type { ConsentLine, CopyFeed, FeedState } from "@/lib/shopify-copy";
import { movedSubscriber } from "@/lib/shopify-subscribers";
import {
  COUNTRIES_QUERY,
  DISCOUNT_PAGES_MAX,
  DISCOUNTS_QUERY,
  LOOK_QUERY,
  SHIPPING_QUERY,
  countriesOf,
  discountInputOf,
  discountOf,
  lookFromAnswer,
  lookKeysOf,
  shippingOf,
  type CountryLine,
  type DiscountLine,
  type LookLine,
  type ShippingLine,
} from "@/lib/shopify-settings";

import type { Membership } from "./auth";
import { designLookTool } from "./brand-tools";
import { listDiscounts, saveDiscount } from "./discounts";
import { findFont } from "./fonts";
import { log } from "./log";
import { OwnerToolError } from "./owner-tool-error";
import { refreshTag } from "./refresh";
import { getShippingSettings, saveShippingSettings } from "./settings";
import { setMarkets } from "./setup";
import { shopifyConnection, shopifyGraphql, type ShopifyDeps } from "./shopify-connect";
import { currentStore, storeTag } from "./stores";
import { listInstalls } from "./theme-installs";
import { addMovedSubscribers } from "./marketing-subscribers";
import { recordMoveItems } from "./shopify-undo";
import { readShopifyGiftCards } from "./shopify-gift-cards";
import { col, typedRows } from "./typed-rows";

const CODE = z.object({ code: col.text });
const BY_HANDLE = z.object({ id: col.uuid, handle: col.text });
const BY_NAME = z.object({ id: col.uuid, name: col.text });

/**
 * *Copy my shop*, part 2 (D445 step 5b, `docs/moving-from-shopify.md` 4.3 and 5.1): the shop's countries, shipping rates, discount codes and
 * look, each read by one ordinary query (`src/lib/shopify-settings.ts`) and written, after *Bring it over*, only by the writer that owns it
 * here: `setMarkets()` (countries are only added, never taken away), `saveShippingSettings()` (a country with a rate of its own here keeps
 * it), `saveDiscount()` (every code switched off until the move) and the AI manager's `design_look` (a theme in the library, not live).
 * What ours cannot say as Shopify did is counted, never bent to fit.
 */

/** The feeds this module reads and writes. */
export const SETTINGS_FEEDS: readonly CopyFeed[] = ["countries", "shipping", "discounts", "look", "subscribers", "gift_cards"];

/** One feed read from Shopify: its lines as JSON Lines text, or why not. */
export async function readSettingsFeed(storeId: string, feed: CopyFeed, deps: ShopifyDeps): Promise<{ ok: true; text: string } | { ok: false }> {
  const lines = (list: readonly unknown[]) => ({ ok: true as const, text: list.map((l) => JSON.stringify(l)).join("\n") });
  if (feed === "countries") {
    const answer = await shopifyGraphql(storeId, COUNTRIES_QUERY, {}, deps);
    return answer.ok ? lines(countriesOf(answer.data)) : { ok: false };
  }
  if (feed === "shipping") {
    const answer = await shopifyGraphql(storeId, SHIPPING_QUERY, {}, deps);
    return answer.ok ? lines(shippingOf(answer.data)) : { ok: false };
  }
  if (feed === "look") {
    const answer = await shopifyGraphql(storeId, LOOK_QUERY, {}, deps);
    if (!answer.ok) return { ok: false };
    const look = lookFromAnswer(answer.data);
    // Which names the theme uses, so a theme we cannot read yet can be: names only, never a colour or a value.
    if (!look) {
      const keys = lookKeysOf(answer.data);
      log("info", "shopify.copy_look_unread", { storeId, theme: keys?.theme ?? null, settings: keys?.settings.join(",") ?? null, scheme: keys?.scheme.join(",") ?? null });
    }
    return lines(look ? [look] : []);
  }
  if (feed === "gift_cards") {
    const cards = await readShopifyGiftCards(storeId, deps);
    return cards ? lines(cards) : { ok: false };
  }
  if (feed === "discounts") {
    const out: unknown[] = [];
    let after: string | null = null;
    type Page = { codeDiscountNodes?: { pageInfo?: { hasNextPage?: boolean; endCursor?: string | null }; nodes?: unknown[] } };
    for (let page = 0; page < DISCOUNT_PAGES_MAX; page++) {
      const answer: Awaited<ReturnType<typeof shopifyGraphql<Page>>> = await shopifyGraphql<Page>(storeId, DISCOUNTS_QUERY, { after }, deps);
      if (!answer.ok) return out.length > 0 ? lines(out) : { ok: false };
      const conn: Page["codeDiscountNodes"] = answer.data.codeDiscountNodes;
      out.push(...(conn?.nodes ?? []).map(discountOf));
      after = conn?.pageInfo?.hasNextPage ? (conn.pageInfo.endCursor ?? null) : null;
      if (!after) break;
    }
    return lines(out);
  }
  return { ok: false };
}

/** The store as it is now (a country added a moment ago is in it), for the writers that check against its countries. */
async function freshMember(member: Membership): Promise<Membership> {
  const store = await currentStore(member.store.slug);
  return store ? { ...member, store } : member;
}

/** How many subscribers one tick writes. */
const SUBSCRIBER_BATCH = 200;

/** How many `discounts` lines one tick writes (each a `saveDiscount()` with its checks). */
const DISCOUNT_BATCH = 10;

/**
 * One tick of a settings feed after *Bring it over*: its lines (`roots` of the kept file) written by their own writers. Countries, shipping
 * and the look are a few lines, done in one tick; codes go ten at a time. `made` counts what is here after (an equal one already here
 * included), `refused` what stays behind for the owner to look at.
 */
export async function applySettingsFeed(member: Membership, feed: CopyFeed, f: FeedState, roots: readonly Record<string, unknown>[]): Promise<FeedState> {
  let made = f.made ?? 0;
  let refused = f.refused ?? 0;
  const done = (cursor: number): FeedState => ({ ...f, stage: cursor >= roots.length ? "done" : "applying", cursor: Math.min(cursor, roots.length), made, refused });

  if (feed === "countries") {
    const lines = roots as unknown as CountryLine[];
    const codes = [...new Set(lines.map((l) => l.code))];
    const known = codes.length
      ? new Set((await typedRows(CODE, sql`select code from commerce.countries where code in (${sql.join(codes.map((c) => sql`${c}`), sql`, `)})`)).map((r) => r.code))
      : new Set<string>();
    const sold = new Set(member.store.markets.map((m) => m.code));
    const missing = codes.filter((c) => known.has(c) && !sold.has(c));
    refused += codes.filter((c) => !known.has(c)).length;
    made += codes.filter((c) => known.has(c) && sold.has(c)).length;
    // Countries are only added: one the store sells to and Shopify does not stays. With Several countries off, none is added.
    if (missing.length > 0 && featureOn(member.store, "countries")) {
      const saved = await setMarkets(member, [...sold, ...missing]);
      if (saved.ok) {
        made += missing.length;
        await recordMoveItems(member.store.id, "market", missing);
      }
      else refused += missing.length;
      refreshTag(storeTag(member.store.slug));
    } else refused += missing.length;
    return done(roots.length);
  }

  if (feed === "shipping") {
    const fresh = await freshMember(member);
    const lines = roots as unknown as ShippingLine[];
    const here = new Map((await getShippingSettings(fresh.store)).map((r) => [r.marketCode, r]));
    const rates: { marketCode: string; amountMinor: number; freeOverMinor: number | null }[] = [];
    for (const line of lines) {
      const market = fresh.store.markets.find((m) => m.code === line.country);
      const amountMinor = market && market.currency === line.currency ? parsePrice(line.amount, market.currency) : null;
      const freeOverMinor = market && line.freeOver !== null ? parsePrice(line.freeOver, market.currency) : null;
      // Not sold to here, in another currency, or an amount ours cannot hold: left for the owner.
      if (!market || amountMinor === null || (line.freeOver !== null && freeOverMinor === null)) {
        refused += 1;
        continue;
      }
      const own = here.get(market.code);
      if (own && own.amountMinor !== null) {
        // The store's own rate stays; one equal to Shopify's is already here.
        if (own.amountMinor === amountMinor && own.freeOverMinor === freeOverMinor) made += 1;
        else refused += 1;
        continue;
      }
      rates.push({ marketCode: market.code, amountMinor, freeOverMinor });
    }
    if (rates.length > 0) {
      const saved = await saveShippingSettings(fresh, rates);
      if (saved.ok) made += rates.length;
      else refused += rates.length;
      refreshTag(storeTag(member.store.slug));
    }
    return done(roots.length);
  }

  if (feed === "discounts") {
    const fresh = await freshMember(member);
    const cursor = f.cursor ?? 0;
    const batch = roots.slice(cursor, cursor + DISCOUNT_BATCH);
    const codes = new Set((await listDiscounts(fresh.store.id)).map((d) => normalizeCode(d.code)));
    for (const raw of batch) {
      if ("leftOut" in raw) {
        refused += 1;
        continue;
      }
      const line = raw as unknown as DiscountLine;
      if (codes.has(normalizeCode(line.code))) {
        made += 1;
        continue;
      }
      const productIds = await idsByHandle(fresh.store.id, line.productHandles ?? []);
      const termIds = await categoryIds(fresh.store.id, line.categoryNames);
      // A product or category the code names that is not here: the code would give more than it did.
      if (productIds === null || termIds === null) {
        refused += 1;
        continue;
      }
      const input = discountInputOf(line, fresh.store.markets, line.productHandles === null ? null : productIds, termIds);
      // One code the writer cannot take stays behind; it never holds up the rest of the copy.
      const saved = input
        ? await saveDiscount(fresh, null, input).catch((error: unknown) => {
            log("error", "shopify.copy_discount_failed", { storeId: member.store.id }, error);
            return null;
          })
        : null;
      if (saved?.ok) {
        made += 1;
        if (saved.id) await recordMoveItems(member.store.id, "discount", [saved.id]);
        codes.add(normalizeCode(line.code));
      } else {
        refused += 1;
        if (saved) log("warn", "shopify.copy_discount_refused", { storeId: member.store.id, problems: saved.problems.length });
      }
    }
    return done(cursor + DISCOUNT_BATCH);
  }

  if (feed === "gift_cards") {
    // Read now, made on move day (step 8): until then nobody could spend one balance in both shops.
    return done(roots.length);
  }

  if (feed === "subscribers") {
    const cursor = f.cursor ?? 0;
    const shop = (await shopifyConnection(member))?.name || member.store.name;
    const batch = (roots.slice(cursor, cursor + SUBSCRIBER_BATCH) as unknown as ConsentLine[]).flatMap((l) => {
      const sub = movedSubscriber(l, shop);
      return sub ? [sub] : [];
    });
    const result = await addMovedSubscribers(member.store.id, member.store.localization.locales[0] ?? "en", batch);
    await recordMoveItems(member.store.id, "subscriber", result.ids);
    made += result.added + result.already;
    return done(cursor + SUBSCRIBER_BATCH);
  }

  if (feed === "look") {
    const line = roots[0] as unknown as LookLine | undefined;
    if (!line) return done(roots.length);
    const title = `${line.name} · Shopify`;
    if ((await listInstalls(member.store.id)).some((i) => i.title === title)) {
      made += 1;
      return done(roots.length);
    }
    const input = designLookInput.safeParse({
      title,
      start: "current",
      accent: line.accent,
      ...(line.background ? { background: line.background } : {}),
      ...(line.text ? { text: line.text } : {}),
      // A font of Shopify's own library that Google Fonts does not have stays as the store's.
      ...(line.headingFont && findFont(line.headingFont) ? { heading_font: line.headingFont } : {}),
      ...(line.bodyFont && findFont(line.bodyFont) ? { body_font: line.bodyFont } : {}),
    });
    if (!input.success) refused += 1;
    else {
      try {
        const designed = await designLookTool({ account: member.account, store: member.store, invalidate: refreshTag }, input.data);
        await recordMoveItems(member.store.id, "theme", [designed.install]);
        made += 1;
      } catch (error) {
        if (!(error instanceof OwnerToolError)) throw error;
        log("warn", "shopify.copy_look_refused", { storeId: member.store.id });
        refused += 1;
      }
    }
    return done(roots.length);
  }

  return done(roots.length);
}

/** The products by their handles here, in order; null when one is not here. */
async function idsByHandle(storeId: string, handles: readonly string[]): Promise<string[] | null> {
  if (handles.length === 0) return [];
  const rows = await typedRows(BY_HANDLE, sql`
    select id, handle from commerce.products
     where store_id = ${storeId}::uuid and handle in (${sql.join(handles.map((h) => sql`${h}`), sql`, `)})
  `);
  const byHandle = new Map(rows.map((r) => [r.handle, r.id]));
  const ids = handles.map((h) => byHandle.get(h));
  return ids.every((id): id is string => Boolean(id)) ? ids : null;
}

/** The product categories by their names here (as the collections' copy made them); null when one is not here. */
async function categoryIds(storeId: string, names: readonly string[]): Promise<string[] | null> {
  if (names.length === 0) return [];
  const rows = await typedRows(BY_NAME, sql`
    select id, lower(name) as name from commerce.terms
     where store_id = ${storeId}::uuid and content_type = 'product' and kind = 'category'
       and lower(name) in (${sql.join(names.map((n) => sql`${n.toLowerCase()}`), sql`, `)})
  `);
  const byName = new Map(rows.map((r) => [r.name, r.id]));
  const ids = names.map((n) => byName.get(n.toLowerCase()));
  return ids.every((id): id is string => Boolean(id)) ? [...new Set(ids)] : null;
}
