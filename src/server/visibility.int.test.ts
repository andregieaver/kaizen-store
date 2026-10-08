import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { withoutVat } from "@/lib/b2b";
import type { PageRow } from "@/lib/page-content";
import { pageRuleIds, showsFor, type Show } from "@/lib/visibility";

/**
 * Who sees a part (D179 phase 4): the facts the server reads for one request (`visitorFacts()`), from the store's own rows
 * and what the request carries, for a signed-in customer in a group and a company with a paid order, and for a guest; an
 * order restricted after an erasure request (D162) never counts as bought before; a cart's value shown in euro. And the ids
 * a page's conditions name are kept only where they are the store's when it is saved.
 */

vi.mock("server-only", () => ({}));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<typeof import("next/server")>()), connection: async () => {} }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
const jar = vi.hoisted(() => new Map<string, string>());
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined),
    getAll: () => [...jar].map(([name, value]) => ({ name, value })),
    set: (name: string, value: string) => void jar.set(name, value),
    delete: (name: string) => void jar.delete(name),
  }),
  headers: async () => new Headers(),
}));

const { keepOwnRuleIds, ruleChoices, visitorFacts } = await import("./visibility");
const { changeLine, getCart } = await import("./cart");
const { getStore } = await import("./stores");
const { marketIn } = await import("./shop");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let storeId: string;
let slug: string;
let customerId: string;
let tierId: string;
let companyId: string;
let orderId: string;
let mug: { product: string; variant: string };
let category: string;
let cups: string;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
const rules = (...conditions: unknown[]): Show => ({ rules: [conditions] }) as Show;
const place = (market = "no") => ({ pageId: null, owner: storeId, market });

beforeAll(async () => {
  slug = `visibility-${run}`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${`${slug}@example.com`}, 'Test', 'Test') returning id
  `);
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Test', null) as id`);
  storeId = String(store.id);
  // Companies need selling to businesses (D178), and euro needs Several currencies (D109).
  await db().execute(sql`
    update commerce.stores set features = features || array['business', 'currencies'], audience = 'both' where id = ${storeId}::uuid
  `);
  await db().execute(sql`
    insert into commerce.store_currencies (store_id, currency, rate, round_to, position)
    values (${storeId}::uuid, 'NOK', 11.5, 1, 0), (${storeId}::uuid, 'EUR', 1, 1, 1)
  `);
  const [tier] = await db().execute<Row>(sql`insert into commerce.customer_tiers (store_id, name, percent) values (${storeId}::uuid, 'VIP', 10) returning id`);
  tierId = String(tier.id);
  const [company] = await db().execute<Row>(sql`insert into commerce.customer_companies (store_id, name) values (${storeId}::uuid, 'Fjord AS') returning id`);
  companyId = String(company.id);
  const [customer] = await db().execute<Row>(sql`
    insert into commerce.customers (store_id, email, name, tier_id, company_id, company_role)
    values (${storeId}::uuid, ${`kari-${run}@example.com`}, 'Kari', ${tierId}::uuid, ${companyId}::uuid, 'employee') returning id
  `);
  customerId = String(customer.id);
  const [order] = await db().execute<Row>(sql`
    insert into commerce.orders (store_id, number, market_code, currency, locale, email, status, customer_id,
      subtotal_minor, shipping_minor, tax_minor, total_minor, billing_address, shipping_address)
    values (${storeId}::uuid, ${`V-${run}`}, 'NO', 'NOK', 'nb-NO', ${`kari-${run}@example.com`}, 'paid', ${customerId}::uuid, 10000, 0, 2000, 10000, '{}', '{}')
    returning id
  `);
  orderId = String(order.id);
  const [found] = await db().execute<Row>(sql`
    select p.id as product, v.id as variant from commerce.products p join commerce.product_variants v on v.product_id = p.id
    where p.store_id = ${storeId}::uuid and v.sku = 'DEMO-MUG-WHITE'
  `);
  mug = { product: String(found.product), variant: String(found.variant) };
  // The mug in a category under a parent: a rule on the parent holds for it too.
  const [parent] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug) values (${storeId}::uuid, 'product', 'category', 'Kitchen', ${`kitchen-${run}`}) returning id
  `);
  const [child] = await db().execute<Row>(sql`
    insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id)
    values (${storeId}::uuid, 'product', 'category', 'Cups', ${`cups-${run}`}, ${String(parent.id)}::uuid) returning id
  `);
  category = String(parent.id);
  cups = String(child.id);
  await db().execute(sql`
    insert into commerce.product_terms (store_id, product_id, term_id) values (${storeId}::uuid, ${mug.product}::uuid, ${String(child.id)}::uuid)
  `);
});

afterAll(async () => {
  await closeDb();
});

/** Signs Kari in as the store's own sign-in does: a session row and its cookie. */
async function signIn() {
  const token = randomBytes(32).toString("base64url");
  await db().execute(sql`
    insert into commerce.customer_sessions (store_id, customer_id, token_hash, expires_at, verified_at)
    values (${storeId}::uuid, ${customerId}::uuid, ${sha256(token)}, now() + interval '1 day', now())
  `);
  jar.set(`account_${storeId}`, token);
}

describe("the visitor's facts", () => {
  const everything = rules(
    { fact: "customerGroup", op: "in", value: [tierId ?? "00000000-0000-4000-8000-000000000000"] },
    { fact: "company", op: "is", value: true },
    { fact: "boughtBefore", op: "is", value: true },
    { fact: "buyer", op: "is", value: "business" },
  );

  it("a signed-in customer in a group and a company, with a paid order", async () => {
    jar.clear();
    await signIn();
    const facts = await visitorFacts(place(), everything);
    expect(facts.signedIn).toBe(true);
    expect(facts.tierIds).toEqual([tierId]);
    expect(facts.company).toEqual({ id: companyId });
    expect(facts.boughtBefore).toBe(true);
    expect(facts).toMatchObject({ country: "NO", language: "nb", currency: "NOK", timeZone: "Europe/Oslo" });
    expect(showsFor("signedIn", facts)).toBe(true);
    expect(showsFor(rules({ fact: "customerGroup", op: "in", value: [tierId] }, { fact: "company", op: "in", value: [companyId] }), facts)).toBe(true);
  });

  it("a guest: signed out, in no group or company, never bought", async () => {
    jar.clear();
    const facts = await visitorFacts(place(), everything);
    expect(facts.signedIn).toBe(false);
    expect(facts.tierIds).toEqual([]);
    expect(facts.company).toEqual({ id: null });
    expect(facts.boughtBefore).toBe(false);
    expect(facts.buyer).toBe("private");
    expect(showsFor("signedOut", facts)).toBe(true);
    expect(showsFor(rules({ fact: "customerGroup", op: "notIn", value: [tierId] }), facts)).toBe(true);
  });

  it("an order restricted after an erasure request is not bought before; a company switched off is no company", async () => {
    jar.clear();
    await signIn();
    await db().execute(sql`update commerce.orders set restricted_at = now() where id = ${orderId}::uuid`);
    await db().execute(sql`update commerce.customer_companies set active = false where id = ${companyId}::uuid`);
    try {
      const facts = await visitorFacts(place(), everything);
      expect(facts.boughtBefore).toBe(false);
      expect(facts.company).toEqual({ id: null });
    } finally {
      await db().execute(sql`update commerce.orders set restricted_at = null where id = ${orderId}::uuid`);
      await db().execute(sql`update commerce.customer_companies set active = true where id = ${companyId}::uuid`);
    }
  });

  it("an expired session is signed out", async () => {
    jar.clear();
    await signIn();
    await db().execute(sql`update commerce.customer_sessions set expires_at = now() - interval '1 minute' where customer_id = ${customerId}::uuid`);
    expect((await visitorFacts(place(), "signedIn")).signedIn).toBe(false);
  });

  it("the cart's value as shown in a euro market, its products and their categories, without VAT for a business", async () => {
    jar.clear();
    const store = (await getStore(slug))!;
    const euro = marketIn(store, "no-eur")!;
    expect(euro.currency).toBe("EUR");
    await changeLine({ storeId, market: euro }, mug.variant, 2, "add");
    const cart = await getCart({ storeId, market: euro });
    const line = cart.lines[0];
    const shown = line.unitPriceMinor! * 2;
    const valueRule = rules({ fact: "cartValue", op: "gte", value: { currency: "EUR", min: 1 } });
    const facts = await visitorFacts(place("no-eur"), valueRule);
    expect(facts.currency).toBe("EUR");
    expect(facts.cart).toEqual({ minor: shown, currency: "EUR", products: [mug.product], categories: expect.arrayContaining([category]) });
    // The mug's own category (the demo's and Cups) and Cups' parent.
    expect(facts.cart!.categories).toEqual(expect.arrayContaining([cups, category]));
    // At exactly the value it holds; a cent more and it does not.
    expect(showsFor(rules({ fact: "cartValue", op: "gte", value: { currency: "EUR", min: shown } }), facts)).toBe(true);
    expect(showsFor(rules({ fact: "cartValue", op: "gte", value: { currency: "EUR", min: shown + 1 } }), facts)).toBe(false);
    // An amount in kroner, compared at the store's rate (11.5 NOK to the euro).
    expect(showsFor(rules({ fact: "cartValue", op: "lte", value: { currency: "NOK", max: Math.ceil(shown * 11.5) } }), facts)).toBe(true);
    expect(showsFor(rules({ fact: "cartCategory", op: "in", value: [category] }), facts)).toBe(true);
    // A business buyer sees the cart without VAT.
    jar.set(`buyer_${storeId}`, "business");
    const business = await visitorFacts(place("no-eur"), valueRule);
    expect(business.buyer).toBe("business");
    expect(business.cart!.minor).toBe(withoutVat(shown, line.vatRate));
    // The same cart is in kroner in the country's own view.
    const own = await visitorFacts(place("no"), valueRule);
    expect(own.cart!.currency).toBe("NOK");
  });

  it("reads only what a rule asks: a sign-in rule has no cart", async () => {
    jar.clear();
    const facts = await visitorFacts(place(), "signedIn");
    expect(facts.cart).toEqual({ minor: 0, currency: "NOK", products: [], categories: [] });
  });

  it("Kaizen's pages: the admin's sign-in, English, Kaizen's time zone and none of a store's facts", async () => {
    jar.clear();
    const facts = await visitorFacts({ pageId: null, owner: null, query: Promise.resolve({ ref: "x" }) }, rules({ fact: "query", op: "exists", value: { name: "ref" } }));
    expect(facts).toMatchObject({ signedIn: false, language: "en", cart: null, tierIds: null, company: null, query: { ref: "x" } });
  });
});

describe("ids in a page's conditions", () => {
  it("keeps the store's own groups, companies, products and categories and drops the rest", async () => {
    const foreign = "00000000-0000-4000-8000-000000000001";
    const [archived] = await db().execute<Row>(sql`
      select id from commerce.products where store_id = ${storeId}::uuid and id <> ${mug.product}::uuid limit 1
    `);
    await db().execute(sql`update commerce.products set status = 'archived' where id = ${String(archived.id)}::uuid`);
    const row: PageRow = {
      id: "r",
      type: "row",
      layout: "1",
      visibility: {
        show: rules(
          { fact: "customerGroup", op: "in", value: [tierId, foreign] },
          { fact: "company", op: "notIn", value: [companyId, foreign] },
          { fact: "cartProduct", op: "in", value: [mug.product, String(archived.id), foreign] },
          { fact: "cartCategory", op: "in", value: [category, foreign] },
        ),
      },
      columns: [{ id: "c", blocks: [] }],
    };
    const [kept] = await keepOwnRuleIds(storeId, [row]);
    expect(pageRuleIds([kept])).toEqual({ tier: [tierId], company: [companyId], product: [mug.product], category: [category] });
    // Kaizen's pages hold none.
    const [none] = await keepOwnRuleIds(null, [row]);
    expect(pageRuleIds([none])).toEqual({ tier: [], company: [], product: [], category: [] });
  });

  it("what the rule builder chooses from", async () => {
    const store = (await getStore(slug))!;
    const choices = await ruleChoices(store, true);
    expect(choices.groups).toEqual([{ id: tierId, name: "VIP" }]);
    expect(choices.companies).toEqual([{ id: companyId, name: "Fjord AS" }]);
    expect(choices.products.some((p) => p.id === mug.product)).toBe(true);
    expect(choices.categories.map((c) => c.name)).toEqual(expect.arrayContaining(["Kitchen", "Cups"]));
    expect(choices.currencies).toEqual(expect.arrayContaining(["NOK", "EUR"]));
    expect(choices).toMatchObject({ timeZone: "Europe/Oslo", currency: "NOK", owner: "store" });
    // Staff who may not read customers get no companies.
    expect((await ruleChoices(store, false)).companies).toBeNull();
  });
});
