import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  snapshotHash,
  staffTermsLine,
  termsDisplay,
  termsPagesOf,
  TERMS_ROLES,
  type OrderTermsRecord,
  type RecordedSnapshot,
  type StaffTermsLine,
  type TermsDisplay,
  type TermsMode,
  type TermsRole,
} from "@/lib/checkout-terms";
import type { LegalRole } from "@/lib/legal-roles";
import type { Market } from "@/lib/markets";
import { parsePageContent, type PageContent } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { marketPath } from "@/lib/paths";

import { readCartId } from "./cart";
import { getOpenCheckout } from "./checkout";
import { listPublishedPages, type PublishedPage } from "./pages";
import { resolveShop } from "./shop";
import type { Store } from "./stores";

type Row = Record<string, unknown>;

/**
 * What a shopper was shown when they ordered (wave 1, 1e, docs/wave-1-trust.md 2.4): the store's terms and privacy statement as
 * they were published at the moment, kept as immutable snapshots (`legal_snapshots`, one row per unchanged text) and tied to the
 * order by `order_terms`. The shopper's press of the pay button is the act and this is the record: a client that skips the action
 * can still pay, so the tick is a guard and a record, not an enforcement, and nothing here claims more.
 *
 * A copied order (D129) never has one (the database refuses); host orders do. Subscriptions' renewals and weekly deliveries have no
 * checkout and so no record; the first order of a subscription has one. No cookie and no storage is used.
 */

/** The pages the sentence names, as the shopper's market shows them: the store's published page for each role. */
export async function termsPagesFor(store: Pick<Store, "id" | "slug" | "legalPages">, market: Market): Promise<{ display: (role: TermsRole) => PublishedPage | null; pages: ReturnType<typeof termsPagesOf> }> {
  const published = await listPublishedPages(store.id);
  const byRole = new Map<TermsRole, PublishedPage>();
  for (const role of TERMS_ROLES) {
    const id = store.legalPages[role];
    const page = id ? published.find((p) => p.id === id) : undefined;
    if (page) byRole.set(role, page);
  }
  const chosen = Object.fromEntries(
    [...byRole].map(([role, page]) => [role, { title: localizePage(page.content, market.locale).title, href: marketPath(store.slug, market.slug, `/${page.slug}`) }]),
  ) as Partial<Record<TermsRole, { title: string; href: string }>>;
  return { display: (role) => byRole.get(role) ?? null, pages: termsPagesOf(chosen) };
}

/** What checkout draws for the store: the sentence (with a tick in `checkbox` mode), or null for nothing. */
export async function termsDisplayFor(store: Pick<Store, "id" | "slug" | "legalPages" | "termsAtCheckout">, market: Market): Promise<TermsDisplay | null> {
  if (store.termsAtCheckout === "off") return null;
  return termsDisplay(store.termsAtCheckout, (await termsPagesFor(store, market)).pages);
}

export type TermsRecordResult = { ok: true; recorded: boolean; reason?: "off" | "already" } | { ok: false; problem: "no_checkout" | "no_order" | "failed" };

/**
 * Records that the shopper pressed pay while the store's terms were shown (`link`) or ticked (`checkbox`) for one order, once: a second
 * press, a retry or a changed card writes nothing new. The snapshots are the pages as published now, as the shopper's market shows
 * them (`localizePage()`), deduplicated by the hash of their text. Nothing is recorded when the store shows nothing (`off`, or no page
 * chosen). The order must be the store's own, waiting for payment and not a copy.
 */
export async function recordTermsForOrder(store: Pick<Store, "id" | "slug" | "legalPages" | "termsAtCheckout">, market: Market, orderId: string): Promise<TermsRecordResult> {
  const display = await termsDisplayFor(store, market);
  if (!display) return { ok: true, recorded: false, reason: "off" };
  const { display: pageFor } = await termsPagesFor(store, market);

  // A repeat (a second press, a retry, a changed card, a reload after paying) writes nothing; a new record is only for an order still waiting for payment.
  const [done] = await db().execute<Row>(sql`select 1 from commerce.order_terms where order_id = ${orderId}::uuid and store_id = ${store.id}::uuid`);
  if (done) return { ok: true, recorded: false, reason: "already" };
  const [order] = await db().execute<Row>(sql`
    select 1 from commerce.orders where store_id = ${store.id}::uuid and id = ${orderId}::uuid and copied_from is null and status = 'pending_payment'
  `);
  if (!order) return { ok: false, problem: "no_order" };

  try {
    return await db().transaction(async (tx): Promise<TermsRecordResult> => {
      const [existing] = await tx.execute<Row>(sql`select 1 from commerce.order_terms where order_id = ${orderId}::uuid and store_id = ${store.id}::uuid`);
      if (existing) return { ok: true, recorded: false, reason: "already" };
      const shown: RecordedSnapshot[] = [];
      for (const page of display.pages) {
        const source = pageFor(page.role);
        if (!source) continue;
        const localized = localizePage(source.content, market.locale);
        const { translations, ...stored } = localized;
        void translations;
        const hash = snapshotHash({ title: localized.title, rows: localized.rows });
        // One row for an unchanged text; the unique key (store, role, locale, hash) makes a racing insert a no-op that still finds it.
        await tx.execute(sql`
          insert into commerce.legal_snapshots (store_id, role, locale, page_id, title, content, content_hash)
          values (${store.id}::uuid, ${page.role}, ${market.locale}, ${source.id}::uuid, ${localized.title}, ${JSON.stringify(stored)}::jsonb, ${hash})
          on conflict (store_id, role, locale, content_hash) do nothing
        `);
        const [snapshot] = await tx.execute<Row>(sql`
          select id from commerce.legal_snapshots where store_id = ${store.id}::uuid and role = ${page.role} and locale = ${market.locale} and content_hash = ${hash}
        `);
        shown.push({ role: page.role, snapshotId: String(snapshot.id), hash, title: localized.title });
      }
      if (shown.length === 0) return { ok: true, recorded: false, reason: "off" };
      const rows = await tx.execute<Row>(sql`
        insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots)
        values (${orderId}::uuid, ${store.id}::uuid, ${display.mode}, ${market.locale}, ${JSON.stringify(shown)}::jsonb)
        on conflict (order_id) do nothing
        returning order_id
      `);
      return rows.length > 0 ? { ok: true, recorded: true } : { ok: true, recorded: false, reason: "already" };
    });
  } catch (error) {
    console.error("[terms] the acceptance could not be recorded", orderId, error);
    return { ok: false, problem: "failed" };
  }
}

/**
 * The server action's core: finds this browser's open checkout from its cart cookie (so a shopper can only record for their own cart,
 * and no one else's order is ever named), then records. In `checkbox` mode the browser does not start the payment when this fails;
 * in `link` mode it goes on and the order simply has no record.
 */
export async function recordTermsAcceptance(storeSlug: string, marketParam: string): Promise<TermsRecordResult> {
  const shop = await resolveShop(storeSlug, marketParam);
  if (!shop) return { ok: false, problem: "no_checkout" };
  const cartId = await readCartId({ storeId: shop.store.id, market: shop.market });
  const open = cartId ? await getOpenCheckout(shop.store.id, cartId) : null;
  if (!open) return { ok: false, problem: "no_checkout" };
  return recordTermsForOrder(shop.store, shop.market, open.orderId);
}

function toRecord(row: Row): OrderTermsRecord {
  return {
    orderId: String(row.order_id),
    mode: row.mode === "checkbox" ? "checkbox" : "link",
    acceptedAt: new Date(String(row.accepted_at)),
    locale: String(row.locale),
    snapshots: ((row.snapshots ?? []) as RecordedSnapshot[]).map((s) => ({ role: s.role, snapshotId: String(s.snapshotId), hash: String(s.hash), title: String(s.title) })),
  };
}

/** The record on an order (`OrderView.terms` reads this), or null. Always for the store's own order only. */
export async function termsForOrder(storeId: string, orderId: string): Promise<OrderTermsRecord | null> {
  const [row] = await db().execute<Row>(sql`
    select order_id, mode, accepted_at, locale, snapshots from commerce.order_terms where store_id = ${storeId}::uuid and order_id = ${orderId}::uuid
  `);
  return row ? toRecord(row) : null;
}

/** What staff are told on the order page: the date and what was shown, that the link was shown and nothing kept, or nothing. */
export async function staffTermsFor(store: Pick<Store, "id">, orderId: string, format: (date: Date) => string): Promise<StaffTermsLine> {
  const [[order], [setting], [anyRecord], record] = await Promise.all([
    db().execute<Row>(sql`select copied_from is not null as copied from commerce.orders where store_id = ${store.id}::uuid and id = ${orderId}::uuid`),
    db().execute<Row>(sql`select terms_at_checkout from commerce.stores where id = ${store.id}::uuid`),
    db().execute<Row>(sql`select 1 as x from commerce.order_terms where store_id = ${store.id}::uuid limit 1`),
    termsForOrder(store.id, orderId),
  ]);
  const mode = (setting?.terms_at_checkout ?? "link") as TermsMode;
  return staffTermsLine(record, { mode, copied: Boolean(order?.copied), storeHasRecords: Boolean(anyRecord), format });
}

export type SnapshotView = { role: LegalRole; title: string; locale: string; hash: string; content: PageContent; acceptedAt: Date; mode: "link" | "checkbox" };

/**
 * One of the texts an order was placed under, for the read-only page: the order's own record and snapshot, never another store's or
 * another order's. `sessionId` is the order page's own key (the shopper's access, as `getShopperOrder()` checks it); staff pass null
 * and are already members of the store (the caller's guard).
 */
export async function snapshotForOrder(storeId: string, orderId: string, role: LegalRole, sessionId: string | null): Promise<SnapshotView | null> {
  if (sessionId !== null) {
    const [key] = await db().execute<Row>(sql`
      select 1 from commerce.payments pay
      where pay.store_id = ${storeId}::uuid and pay.order_id = ${orderId}::uuid and pay.provider in ('stripe', 'venue') and pay.provider_reference = ${sessionId}
    `);
    if (!key) return null;
  }
  const record = await termsForOrder(storeId, orderId);
  const shown = record?.snapshots.find((s) => s.role === role);
  if (!record || !shown) return null;
  const [row] = await db().execute<Row>(sql`
    select title, locale, content_hash, content from commerce.legal_snapshots
    where store_id = ${storeId}::uuid and id = ${shown.snapshotId}::uuid and role = ${role}
  `);
  const content = row ? parsePageContent(row.content) : null;
  if (!row || !content) return null;
  return { role, title: String(row.title), locale: String(row.locale), hash: String(row.content_hash), content, acceptedAt: record.acceptedAt, mode: record.mode };
}
