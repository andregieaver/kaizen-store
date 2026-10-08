import "server-only";

import { sql } from "drizzle-orm";
import { connection } from "next/server";

import { db } from "@/db/client";
import { withoutVat } from "@/lib/b2b";
import { cartSubtotal } from "@/lib/cart";
import { mainCurrency } from "@/lib/markets";
import type { PageRow } from "@/lib/page-content";
import { keepRuleIds, mapShows, pageRuleIds, showFacts, type Fact, type RuleIdKind, type Show, type VisibilityChoices, type VisitorFacts } from "@/lib/visibility";

import { getAccount } from "./auth";
import { getBuyer } from "./b2b";
import { getCart } from "./cart";
import type { GridPlace } from "./content-grid";
import { bought } from "./customer-admin";
import { customerTierIds } from "./customer-tiers";
import { getCustomer } from "./customers";
import { storeSlugOf } from "./menus";
import { perRequest } from "./request-memo";
import { uuidList } from "./sql-arrays";
import { marketIn } from "./shop";
import { getOpenStore, type Store } from "./stores";

type Row = Record<string, unknown>;

/** Kaizen's own pages keep the time of the place it is run from; stores keep their own (`stores.time_zone`). */
const KAIZEN_TIME_ZONE = "Europe/Oslo";

const CUSTOMER_FACTS: readonly Fact[] = ["customerGroup", "company", "boughtBefore"];
const CART_FACTS: readonly Fact[] = ["cartValue", "cartProduct", "cartCategory"];

/**
 * What the server knows about the visitor of this request, for the parts a display rule draws (D179 phase 4,
 * `docs/responsive-editing.md` 6): read inside the part's `<Suspense>` hole, each kind of fact once per request
 * (`perRequest()`), and only the kinds the rule asks about, so a sign-in rule reads the session and nothing more. Facts are
 * read from what the request already carries (the store's customer session, the buyer's choice, the cart) and from the
 * store's own rows; nothing is written and no cookie or storage is set. A fact the place does not have is null, and a
 * condition on it never holds.
 */
export async function visitorFacts(place: GridPlace, show: Show): Promise<VisitorFacts> {
  // Time and sign-in are of this request, never of a prerender.
  await connection();
  const needs = new Set<Fact>(typeof show === "object" ? showFacts(show) : ["signedIn"]);
  const query = needs.has("query") ? await queryOf(place) : null;
  const now = new Date();
  if (!place.owner) {
    const signedIn = await perRequest("visibility:admin", async () => Boolean(await getAccount()));
    return {
      ...NOBODY,
      signedIn,
      language: "en",
      now,
      timeZone: KAIZEN_TIME_ZONE,
      query,
    };
  }
  const shop = await perRequest(`visibility:shop:${place.owner}:${place.market ?? ""}`, () => shopOf(place.owner!, place.market));
  if (!shop) return { ...NOBODY, now, query };
  const { store, market } = shop;
  const customer = await perRequest(`visibility:customer:${store.id}`, () => getCustomer(store.id));
  const wants = (facts: readonly Fact[]) => facts.some((fact) => needs.has(fact));
  const [member, buyer, cart] = await Promise.all([
    wants(CUSTOMER_FACTS) ? perRequest(`visibility:member:${store.id}`, () => memberFacts(store.id, customer?.id ?? null)) : null,
    wants(["buyer", "cartValue"]) ? perRequest(`visibility:buyer:${store.id}`, () => getBuyer(store)) : null,
    wants(CART_FACTS) ? perRequest(`visibility:cart:${store.id}:${market.slug}`, async () => cartFacts(store, market, await getBuyer(store))) : null,
  ]);
  return {
    signedIn: customer !== null,
    tierIds: member?.tierIds ?? [],
    company: { id: member?.companyId ?? null },
    buyer: buyer ?? "private",
    boughtBefore: member?.boughtBefore ?? false,
    country: market.code,
    language: market.lang,
    currency: market.currency,
    now,
    timeZone: store.timeZone,
    cart: cart ?? { minor: 0, currency: market.currency, products: [], categories: [] },
    rates: store.localization.rates,
    query,
  };
}

/** The facts of a place that has none of a store's: Kaizen's pages, or a store no longer open. */
const NOBODY: VisitorFacts = {
  signedIn: false,
  tierIds: null,
  company: null,
  buyer: null,
  boughtBefore: null,
  country: null,
  language: null,
  currency: null,
  now: new Date(0),
  timeZone: KAIZEN_TIME_ZONE,
  cart: null,
  rates: null,
  query: null,
};

/** The address's parameters, where the route hands them to the page (a page, a working page, a listing); else null. */
async function queryOf(place: GridPlace): Promise<VisitorFacts["query"]> {
  const given = place.query ?? place.listing?.query ?? place.route?.query;
  return given ? { ...(await given) } : null;
}

async function shopOf(owner: string, ref: string | undefined): Promise<{ store: Store; market: NonNullable<ReturnType<typeof marketIn>> } | null> {
  const slug = await storeSlugOf(owner);
  const store = slug ? await getOpenStore(slug) : null;
  const market = store ? marketIn(store, ref) : undefined;
  return store && market ? { store, market } : null;
}

/**
 * A signed-in customer's groups (their own and their company's while it is on, as campaigns read them, D108/D115), their
 * company account (only while selling to businesses is on and they are its owner or employee) and whether they have bought
 * before: a paid order of theirs (`bought`, never a copied one) that is not restricted after an erasure request (D162).
 */
async function memberFacts(storeId: string, customerId: string | null): Promise<{ tierIds: string[]; companyId: string | null; boughtBefore: boolean }> {
  if (!customerId) return { tierIds: [], companyId: null, boughtBefore: false };
  const [tierIds, [row]] = await Promise.all([
    customerTierIds(db(), storeId, customerId),
    db().execute<Row>(sql`
      select
        case when co.active and commerce.feature_on(c.store_id, 'business') and c.company_role in ('owner', 'employee') then co.id end as company_id,
        exists (
          select 1 from commerce.orders o
          where o.store_id = c.store_id and o.customer_id = c.id and o.restricted_at is null and ${bought}
        ) as bought_before
      from commerce.customers c
      left join commerce.customer_companies co on co.store_id = c.store_id and co.id = c.company_id
      where c.store_id = ${storeId}::uuid and c.id = ${customerId}::uuid
    `),
  ]);
  return { tierIds, companyId: row?.company_id ? String(row.company_id) : null, boughtBefore: Boolean(row?.bought_before) };
}

/**
 * The cart as the shopper sees it: its items' value in the currency shown, without VAT for a business buyer (D63), before
 * shipping and discounts, and the products and categories in it (a category's parents count too). Lines that cannot be
 * bought are left out, as the cart's own subtotal does.
 */
async function cartFacts(store: Store, market: NonNullable<ReturnType<typeof marketIn>>, buyer: "business" | "private"): Promise<NonNullable<VisitorFacts["cart"]>> {
  const cart = await getCart({ storeId: store.id, market });
  const lines = cart.lines.filter((line) => line.status !== "unavailable" && line.unitPriceMinor !== null);
  const minor = cartSubtotal(
    lines.map((line) => {
      const total = line.unitPriceMinor! * line.quantity;
      return { unitPriceMinor: buyer === "business" ? withoutVat(total, line.vatRate) : total, quantity: 1 };
    }),
  );
  const products = [...new Set(cart.lines.map((line) => line.productId))];
  const categories = products.length === 0 ? [] : await categoriesOf(store.id, products);
  return { minor, currency: market.currency, products, categories };
}

async function categoriesOf(storeId: string, products: string[]): Promise<string[]> {
  const rows = await db().execute<Row>(sql`
    with recursive found as (
      select t.id, t.parent_id from commerce.product_terms pt
      join commerce.terms t on t.store_id = pt.store_id and t.id = pt.term_id and t.kind = 'category'
      where pt.store_id = ${storeId}::uuid and pt.product_id = any(${uuidList(products)})
      union
      select t.id, t.parent_id from commerce.terms t join found f on t.id = f.parent_id
      where t.store_id = ${storeId}::uuid
    )
    select distinct id from found
  `);
  return rows.map((row) => String(row.id));
}

/**
 * The store's own groups, companies, products and product categories among the ids a page's displays name: what the
 * builder shows by name, and `keepOwnRuleIds()` keeps when a page is saved.
 */
export async function ownRuleIds(storeId: string, wanted: Record<RuleIdKind, string[]>): Promise<Record<RuleIdKind, Set<string>>> {
  const list = (ids: string[]) => uuidList(ids);
  const read = async (kind: RuleIdKind, query: ReturnType<typeof sql>) =>
    wanted[kind].length === 0 ? new Set<string>() : new Set((await db().execute<Row>(query)).map((row) => String(row.id)));
  const [tier, company, product, category] = await Promise.all([
    read("tier", sql`select id from commerce.customer_tiers where store_id = ${storeId}::uuid and id = any(${list(wanted.tier)})`),
    read("company", sql`select id from commerce.customer_companies where store_id = ${storeId}::uuid and id = any(${list(wanted.company)})`),
    read("product", sql`select id from commerce.products where store_id = ${storeId}::uuid and id = any(${list(wanted.product)}) and status <> 'archived'`),
    read(
      "category",
      sql`select id from commerce.terms where store_id = ${storeId}::uuid and kind = 'category' and content_type = 'product' and id = any(${list(wanted.category)})`,
    ),
  ]);
  return { tier, company, product, category };
}

/**
 * A page's rows with only the store's own ids in their displays' conditions (D179 phase 4): one deleted since, or one of
 * another store (a page copied from a template store keeps the template's), is dropped when the page is saved. The builder
 * shows such an id as removed before; a condition left choosing nothing holds for nobody ("is one of") or everybody ("is
 * none of"). Kaizen's pages hold no such conditions (`displayFactsProblem()`).
 */
export async function keepOwnRuleIds(storeId: string | null, rows: PageRow[]): Promise<PageRow[]> {
  const wanted = pageRuleIds(rows);
  if (Object.values(wanted).every((ids) => ids.length === 0)) return rows;
  if (storeId === null) return mapShows(rows, (show) => keepRuleIds(show, () => false));
  const own = await ownRuleIds(storeId, wanted);
  return mapShows(rows, (show) => keepRuleIds(show, (kind, id) => own[kind].has(id)));
}

/**
 * What a store's rule builder chooses from (`VisibilityChoices`): its customer groups, its companies (only with
 * `withCompanies`, for staff who may read customers), its products and product categories by name in its main language,
 * the countries, languages and currencies it offers, and its time zone.
 */
export async function ruleChoices(store: Store, withCompanies: boolean): Promise<VisibilityChoices> {
  const locale = store.localization.locales[0] ?? "en-GB";
  const named = (rows: Row[]) => rows.map((row) => ({ id: String(row.id), name: String(row.name ?? "") }));
  const [groups, companies, products, categories] = await Promise.all([
    db().execute<Row>(sql`select id, name from commerce.customer_tiers where store_id = ${store.id}::uuid order by name`),
    withCompanies ? db().execute<Row>(sql`select id, name from commerce.customer_companies where store_id = ${store.id}::uuid order by name`) : null,
    db().execute<Row>(sql`
      select p.id, coalesce(tl.title, (select title from commerce.product_translations where product_id = p.id order by locale limit 1), p.handle) as name
      from commerce.products p
      left join commerce.product_translations tl on tl.product_id = p.id and tl.locale = ${locale}
      where p.store_id = ${store.id}::uuid and p.status <> 'archived'
      order by name limit 1000
    `),
    db().execute<Row>(sql`
      select id, name from commerce.terms
      where store_id = ${store.id}::uuid and kind = 'category' and content_type = 'product' order by position, name
    `),
  ]);
  const languageName = (code: string) => new Intl.DisplayNames(["en"], { type: "language" }).of(code) ?? code;
  return {
    owner: "store",
    timeZone: store.timeZone,
    currency: mainCurrency(store),
    groups: named(groups),
    companies: companies ? named(companies) : null,
    products: named(products),
    categories: named(categories),
    countries: store.markets.map((m) => ({ code: m.code, name: new Intl.DisplayNames(["en"], { type: "region" }).of(m.code) ?? m.code })),
    languages: [...new Set(store.localization.locales.map((l) => new Intl.Locale(l).language))].map((code) => ({ code, name: languageName(code) })),
    currencies: store.localization.currencies.map((c) => c.currency),
  };
}
