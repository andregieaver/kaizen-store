import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { Market } from "@/lib/markets";
import { newPageContent, type PageContent } from "@/lib/page-content";

import { makeStore, membershipOf, run, unique } from "./trust-fixtures";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const cart = vi.hoisted(() => ({ cartId: null as string | null, open: null as { orderId: string } | null, asked: [] as string[][] }));
vi.mock("./cart", () => ({ readCartId: async () => cart.cartId }));
vi.mock("./checkout", () => ({
  getOpenCheckout: async (storeId: string, cartId: string) => {
    cart.asked.push([storeId, cartId]);
    return cart.open;
  },
}));

const ct = await import("./checkout-terms");
const pages = await import("./pages");
const ls = await import("./legal-starters");
const stores = await import("./stores");

type Row = Record<string, unknown>;

/**
 * What a shopper was shown when they ordered (wave 1, 1e, docs/wave-1-trust.md 2.4): the pay press records `order_terms` once per order with
 * immutable snapshots of the store's published terms and privacy pages as the shopper's market shows them, one row per unchanged text. The
 * record belongs to the store's own order that is waiting for payment and is not a copy.
 */

let store: Awaited<ReturnType<typeof makeStore>>;
let owner: Awaited<ReturnType<typeof membershipOf>>;
let termsPage: string;
let privacyPage: string;
let norway: Market;
let serial = 0;

const body = (heading: string) => [{ id: crypto.randomUUID(), type: "row" as const, layout: "1" as const, columns: [{ id: crypto.randomUUID(), blocks: [{ id: crypto.randomUUID(), type: "heading" as const, level: 2 as const, text: heading }] }] }];

async function publish(owned: typeof owner, title: string, slug: string, rows = body(title), translations?: PageContent["translations"]) {
  const page = await pages.savePage(owned.account, owned.store.id, null, { ...newPageContent(), title, slug, rows, ...(translations && { translations }) }, { publish: true });
  if (!page.ok) throw new Error(page.problems.join());
  return page.id;
}

async function order(storeId = store.id, options: { status?: string; copied?: boolean; session?: string } = {}): Promise<string> {
  serial += 1;
  const [row] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, subtotal_minor, shipping_minor, discount_minor, tax_minor, total_minor,
      billing_address, shipping_address, copied_from)
    values (${storeId}::uuid, ${`${options.copied ? "C" : "T"}-${run}-${serial}`}, 'NO', 'NOK', 'nb-NO', 'shopper@example.com', ${options.status ?? (options.copied ? "paid" : "pending_payment")}, 20000, 0, 0, 4000, 20000,
      '{}'::jsonb, '{}'::jsonb, ${options.copied ? crypto.randomUUID() : null}::uuid)
    returning id
  `);
  if (options.session) {
    await db().execute(sql`insert into commerce.payments (store_id, order_id, provider, provider_reference, amount_minor, currency) values (${storeId}::uuid, ${String(row.id)}::uuid, 'stripe', ${options.session}, 20000, 'NOK')`);
  }
  return String(row.id);
}

const live = async () => (await stores.getStore(store.slug))!;
const record = async (orderId: string, market: Market = norway) => ct.recordTermsForOrder(await live(), market, orderId);
const rows = async (orderId: string) => db().execute<Row>(sql`select * from commerce.order_terms where order_id = ${orderId}::uuid`);
const snapshotCount = async () => Number((await db().execute<Row>(sql`select count(*)::int as n from commerce.legal_snapshots where store_id = ${store.id}::uuid`))[0].n);

beforeAll(async () => {
  store = await makeStore("terms");
  await db().execute(sql`
    insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
    select ${store.id}::uuid, code, currency, default_locale, locales, true from commerce.countries where code in ('NO') on conflict do nothing
  `);
  await db().execute(sql`update commerce.stores set country = 'NO', locales = array['nb-NO', 'en-GB'] where id = ${store.id}::uuid`);
  owner = await membershipOf(store.slug, store.account, "owner");
  termsPage = await publish(owner, "Vilkår", `vilkar-${run}`, body("Våre vilkår"), { "en-GB": { title: "Terms" } });
  privacyPage = await publish(owner, "Personvern", `personvern-${run}`);
  await ls.setLegalRole(owner, "terms", termsPage);
  await ls.setLegalRole(owner, "privacy", privacyPage);
  norway = (await live()).markets.find((m) => m.code === "NO")!;
});

beforeEach(() => {
  cart.cartId = null;
  cart.open = null;
  cart.asked = [];
});

afterAll(async () => {
  await closeDb();
});

describe("what the sentence names", () => {
  it("names the store's published terms and privacy pages, in the shopper's language and market", async () => {
    const s = await live();
    const { pages: named } = await ct.termsPagesFor(s, norway);
    expect(named.map((p) => [p.role, p.title])).toEqual([["terms", "Vilkår"], ["privacy", "Personvern"]]);
    expect(named[0].href).toBe(`/s/${store.slug}/vilkar-${run}`);
    const english = { ...norway, locale: "en-GB", slug: "no-en" };
    expect((await ct.termsPagesFor(s, english)).pages[0]).toMatchObject({ title: "Terms", href: `/s/${store.slug}/en/vilkar-${run}` });
    expect(await ct.termsDisplayFor(s, norway)).toMatchObject({ mode: "link", kind: "both" });
  });

  it("drops a page that is unpublished, names only what is chosen, and shows nothing for `off` or when nothing is chosen", async () => {
    const s = await live();
    expect(await ct.termsDisplayFor({ ...s, termsAtCheckout: "off" }, norway)).toBeNull();
    expect(await ct.termsDisplayFor({ ...s, legalPages: {} }, norway)).toBeNull();
    expect(await ct.termsDisplayFor({ ...s, legalPages: { privacy: privacyPage } }, norway)).toMatchObject({ kind: "privacy" });
    // A role whose page is not published is no page at all.
    await db().execute(sql`update commerce.pages set published = null, published_at = null where id = ${privacyPage}::uuid`);
    try {
      expect(await ct.termsDisplayFor(s, norway)).toMatchObject({ kind: "terms" });
    } finally {
      await db().execute(sql`update commerce.pages set published = draft, published_at = now() where id = ${privacyPage}::uuid`);
    }
  });
});

describe("recording the acceptance", () => {
  it("writes one record per order with a snapshot of each page, as the market showed it, and the mode and locale", async () => {
    const id = await order();
    expect(await record(id)).toEqual({ ok: true, recorded: true });
    const [row] = await rows(id);
    expect(row).toMatchObject({ store_id: store.id, mode: "link", locale: "nb-NO" });
    const shown = row.snapshots as { role: string; snapshotId: string; hash: string; title: string }[];
    expect(shown.map((s) => [s.role, s.title])).toEqual([["terms", "Vilkår"], ["privacy", "Personvern"]]);
    expect(shown.every((s) => /^[0-9a-f]{64}$/.test(s.hash))).toBe(true);
    const [snapshot] = await db().execute<Row>(sql`select role, locale, title, content, page_id from commerce.legal_snapshots where id = ${shown[0].snapshotId}::uuid`);
    expect(snapshot).toMatchObject({ role: "terms", locale: "nb-NO", title: "Vilkår", page_id: termsPage });
    expect(JSON.stringify(snapshot.content)).toContain("Våre vilkår");
    // The words of another language are not carried in it.
    expect(JSON.stringify(snapshot.content)).not.toContain("translations");
  });

  it("is idempotent: a second press, a retry or three at once write nothing new", async () => {
    const id = await order();
    const results = await Promise.all([record(id), record(id), record(id)]);
    expect(results.filter((r) => r.ok && r.recorded)).toHaveLength(1);
    expect(await record(id)).toEqual({ ok: true, recorded: false, reason: "already" });
    expect(await rows(id)).toHaveLength(1);
  });

  it("keeps one snapshot for ten orders under an unchanged text, and makes a new one when a page changes, leaving the first order's as it was", async () => {
    const first = await order();
    await record(first);
    const before = await snapshotCount();
    for (let i = 0; i < 4; i++) await record(await order());
    expect(await snapshotCount()).toBe(before);
    const [oldRow] = await rows(first);
    const oldIds = (oldRow.snapshots as { snapshotId: string }[]).map((s) => s.snapshotId);

    // The owner changes the terms.
    const changed = await pages.savePage(owner.account, store.id, termsPage, { ...newPageContent(), title: "Vilkår", slug: `vilkar-${run}`, rows: body("Nye vilkår") }, { publish: true });
    expect(changed.ok).toBe(true);
    const later = await order();
    await record(later);
    expect(await snapshotCount()).toBe(before + 1);
    const [newRow] = await rows(later);
    const newIds = (newRow.snapshots as { snapshotId: string }[]).map((s) => s.snapshotId);
    expect(newIds[0]).not.toBe(oldIds[0]);
    expect(newIds[1]).toBe(oldIds[1]); // privacy was not changed
    // The first order still points at the text its shopper saw.
    const seen = await ct.snapshotForOrder(store.id, first, "terms", null);
    expect(JSON.stringify(seen?.content.rows)).toContain("Våre vilkår");
    expect(JSON.stringify((await ct.snapshotForOrder(store.id, later, "terms", null))?.content.rows)).toContain("Nye vilkår");
  });

  it("records the page as the shopper's language shows it, a different snapshot per language", async () => {
    // The terms are written in English too (the earlier test changed the page and left that language out).
    const rewritten = await pages.savePage(owner.account, store.id, termsPage, { ...newPageContent(), title: "Vilkår", slug: `vilkar-${run}`, rows: body("Nye vilkår"), translations: { "en-GB": { title: "Terms" } } }, { publish: true });
    expect(rewritten.ok).toBe(true);
    const id = await order();
    await ct.recordTermsForOrder(await live(), { ...norway, locale: "en-GB", slug: "no-en" }, id);
    const [row] = await rows(id);
    expect(row.locale).toBe("en-GB");
    expect((row.snapshots as { title: string }[])[0].title).toBe("Terms");
  });

  it("records `checkbox` mode, and records only the page that is chosen", async () => {
    const s = await live();
    const id = await order();
    expect(await ct.recordTermsForOrder({ ...s, termsAtCheckout: "checkbox", legalPages: { terms: termsPage } }, norway, id)).toEqual({ ok: true, recorded: true });
    const [row] = await rows(id);
    expect(row.mode).toBe("checkbox");
    expect((row.snapshots as unknown[]).length).toBe(1);
  });

  it("records nothing when the store shows nothing: `off`, or no page chosen", async () => {
    const s = await live();
    const a = await order();
    const b = await order();
    expect(await ct.recordTermsForOrder({ ...s, termsAtCheckout: "off" }, norway, a)).toEqual({ ok: true, recorded: false, reason: "off" });
    expect(await ct.recordTermsForOrder({ ...s, legalPages: {} }, norway, b)).toEqual({ ok: true, recorded: false, reason: "off" });
    expect(await rows(a)).toHaveLength(0);
    expect(await rows(b)).toHaveLength(0);
  });

  it("refuses an order that is not the store's, is already paid without a record, is a copy, or does not exist", async () => {
    const other = await makeStore("terms-other");
    const foreign = await order(other.id);
    expect(await record(foreign)).toEqual({ ok: false, problem: "no_order" });
    expect(await rows(foreign)).toHaveLength(0);
    expect(await record(await order(store.id, { status: "paid" }))).toEqual({ ok: false, problem: "no_order" });
    expect(await record(await order(store.id, { copied: true }))).toEqual({ ok: false, problem: "no_order" });
    expect(await record("66666666-6666-4666-8666-666666666666")).toEqual({ ok: false, problem: "no_order" });
  });

  it("is also refused by the database for a copied order, a snapshot of another store and a change after the fact", async () => {
    const copied = await order(store.id, { copied: true });
    const [snap] = await db().execute<Row>(sql`select id from commerce.legal_snapshots where store_id = ${store.id}::uuid and role = 'terms' limit 1`);
    const shown = JSON.stringify([{ role: "terms", snapshotId: String(snap.id), hash: "0".repeat(64), title: "x" }]);
    await expect(db().execute(sql`insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values (${copied}::uuid, ${store.id}::uuid, 'link', 'nb-NO', ${shown}::jsonb)`)).rejects.toThrow();
    const other = await makeStore("terms-other2");
    const foreignOrder = await order(other.id);
    await expect(db().execute(sql`insert into commerce.order_terms (order_id, store_id, mode, locale, snapshots) values (${foreignOrder}::uuid, ${other.id}::uuid, 'link', 'nb-NO', ${shown}::jsonb)`)).rejects.toThrow();
    const done = await order();
    await record(done);
    await expect(db().execute(sql`update commerce.order_terms set mode = 'checkbox' where order_id = ${done}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`delete from commerce.order_terms where order_id = ${done}::uuid`)).rejects.toThrow();
    await expect(db().execute(sql`update commerce.legal_snapshots set title = 'changed' where id = ${String(snap.id)}::uuid`)).rejects.toThrow();
  });
});

describe("recording from the shopper's own checkout", () => {
  it("finds the open checkout from this browser's cart, and records for that order only", async () => {
    const id = await order();
    cart.cartId = "77777777-7777-4777-8777-777777777777";
    cart.open = { orderId: id };
    expect(await ct.recordTermsAcceptance(store.slug, "no")).toEqual({ ok: true, recorded: true });
    expect(cart.asked).toEqual([[store.id, cart.cartId]]);
    expect(await rows(id)).toHaveLength(1);
  });

  it("says there is no checkout without a cart cookie, without an open order, or for a store or market that does not exist", async () => {
    expect(await ct.recordTermsAcceptance(store.slug, "no")).toEqual({ ok: false, problem: "no_checkout" });
    cart.cartId = "77777777-7777-4777-8777-777777777777";
    expect(await ct.recordTermsAcceptance(store.slug, "no")).toEqual({ ok: false, problem: "no_checkout" });
    expect(await ct.recordTermsAcceptance("no-such-store", "no")).toEqual({ ok: false, problem: "no_checkout" });
    expect(await ct.recordTermsAcceptance(store.slug, "zz")).toEqual({ ok: false, problem: "no_checkout" });
  });

  it("cannot be pointed at another store's order: the cart is looked up in this store only", async () => {
    const other = await makeStore("terms-other3");
    const foreign = await order(other.id);
    cart.cartId = "77777777-7777-4777-8777-777777777777";
    cart.open = { orderId: foreign };
    expect(await ct.recordTermsAcceptance(store.slug, "no")).toEqual({ ok: false, problem: "no_order" });
    expect(await rows(foreign)).toHaveLength(0);
  });
});

describe("what the shopper and staff are shown afterwards", () => {
  const format = (d: Date) => d.toISOString().slice(0, 10);

  it("tells staff the date and what was shown, that the link was shown with nothing kept, or nothing for a copied order and when it is off", async () => {
    const recorded = await order();
    await record(recorded);
    expect(await ct.staffTermsFor(await live(), recorded, format)).toMatchObject({ kind: "accepted", mode: "link", titles: ["Vilkår", "Personvern"], text: `Terms accepted ${format(new Date())} as shown` });
    const without = await order();
    expect(await ct.staffTermsFor(await live(), without, format)).toEqual({ kind: "not_recorded", text: "Terms link shown, not recorded" });
    expect(await ct.staffTermsFor(await live(), await order(store.id, { copied: true }), format)).toEqual({ kind: "none" });
    await db().execute(sql`update commerce.stores set terms_at_checkout = 'off' where id = ${store.id}::uuid`);
    try {
      expect(await ct.staffTermsFor(await live(), without, format)).toEqual({ kind: "none" });
    } finally {
      await db().execute(sql`update commerce.stores set terms_at_checkout = 'link' where id = ${store.id}::uuid`);
    }
    const fresh = await makeStore("terms-fresh");
    expect(await ct.staffTermsFor({ id: fresh.id }, await order(fresh.id), format)).toEqual({ kind: "none" });
  });

  it("gives the shopper the text of an order with the order page's own key, and no one else", async () => {
    const id = await order(store.id, { session: unique("cs_test") });
    await record(id);
    const key = String((await db().execute<Row>(sql`select provider_reference from commerce.payments where order_id = ${id}::uuid`))[0].provider_reference);
    const view = await ct.snapshotForOrder(store.id, id, "privacy", key);
    expect(view).toMatchObject({ role: "privacy", title: "Personvern", locale: "nb-NO", mode: "link" });
    expect(view?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await ct.snapshotForOrder(store.id, id, "privacy", "cs_test_wrong")).toBeNull();
    expect(await ct.snapshotForOrder(store.id, id, "returns_policy", key)).toBeNull();
    const other = await makeStore("terms-other4");
    expect(await ct.snapshotForOrder(other.id, id, "privacy", key)).toBeNull();
    expect(await ct.snapshotForOrder(other.id, id, "privacy", null)).toBeNull();
    expect(await ct.termsForOrder(other.id, id)).toBeNull();
    expect(await ct.termsForOrder(store.id, id)).toMatchObject({ orderId: id, mode: "link" });
  });
});
