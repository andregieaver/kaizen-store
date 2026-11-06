import "server-only";

import { languageAlternates, platformPath, type PlatformLang } from "@/lib/platform-lang";
import { listIndexedEntries } from "./content-site";
import { getPlatformLangs } from "./platform-navigation";
import { refreshTag } from "./refresh";
import { agentProblem } from "./shopping-agents";
import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { t } from "@/lib/i18n";
import { languageChoices, localizationOf } from "@/lib/localization";
import { LEGAL_ROLES } from "@/lib/legal-roles";
import { inView, offeredMarkets, shown, toMarket, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketOrigin, marketPath, marketUrl, storeBase, storeDomain, storeFileUrl, storeSiteUrl } from "@/lib/paths";
import { agentEndpoint, agentProfileUrl } from "@/lib/shopping-agents";
import { articlePath, blogOfArticle, blogPath, inBlog } from "@/lib/blogs";
import { pageExcerpt, parsePageContent } from "@/lib/page-content";
import { pageImageUrls } from "@/lib/page-images";
import { localizePage } from "@/lib/page-translation";
import {
  AI_ASSISTANT_BOTS,
  AI_TRAINING_BOTS,
  absoluteUrl,
  addRules,
  mergeGroups,
  ogLocale,
  parseRobotsRules,
  parseStoreSeo,
  renderLlms,
  renderRobots,
  storeRobotsGroups,
  storeSeoInput,
  summarize,
  type StoreSeo,
} from "@/lib/seo";
import { siteUrl } from "@/lib/site";
import { docsHost, docsUrl } from "@/lib/docs-host";
import { themeStoreAlternates, themeStoreUrl, themesHost, themesOrigin } from "@/lib/theme-host";
import type { ShippingFacts, StoreFacts } from "@/lib/structured-data";
import { featureOn, normaliseFeatures } from "@/lib/store-features";
import { parseTermSeo, type TermSeo } from "@/lib/term-seo";

import { themeStoreCards } from "./theme-store";
import { audit, type Account, type Membership } from "./auth";
import { CATALOG_TAG, catalogTag, listProducts } from "./catalog";
import { storeBlogs } from "./blogs";
import { col, typedRows } from "./typed-rows";
import { listPublishedPages, pagesTag } from "./pages";
import { pageInMarket } from "@/lib/page-markets";
import { getPlatformPageRoles } from "./platform-roles";
import type { SaveResult } from "./settings";
import { getOpenStore, type Store, storeTag } from "./stores";
import { termsTag } from "./taxonomy";
import { OFFERED } from "./product-conditions";
import { siteStoreCached } from "./site-store";

type Row = Record<string, unknown>;

/** Revalidate after Kaizen's own search settings change. */
export const PLATFORM_SEO_TAG = "platform-seo";
/** Revalidate after a store opens, closes or changes its search settings. */
export const STORES_TAG = "stores";

export type SeoInput = z.infer<typeof storeSeoInput>;

function check(
  input: unknown,
  { sitemaps }: { sitemaps: boolean },
): { ok: true; seo: SeoInput } | { ok: false; problems: string[] } {
  const parsed = storeSeoInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const rules = parseRobotsRules(parsed.data.robots, { sitemaps }).problems;
  if (rules.length > 0) return { ok: false, problems: rules.map((problem) => `Crawler rules: ${problem}`) };
  const clean = (values: Record<string, string>) =>
    Object.fromEntries(Object.entries(values).filter(([, value]) => value !== ""));
  const seo = parsed.data;
  return {
    ok: true,
    seo: {
      ...seo,
      title: clean(seo.title),
      description: clean(seo.description),
      image: seo.image && { ...seo.image, alt: clean(seo.image.alt) },
    },
  };
}

// ---------------------------------------------------------------------------
// Kaizen's own pages
// ---------------------------------------------------------------------------

/** Kaizen's own title and description when none are set. */
export const PLATFORM_DEFAULTS = {
  title: "Kaizena Flow",
  description:
    "Online stores for Norway, Sweden and Denmark: prices with VAT, product safety details and consumer rights handled from the start, and pages that load in under half a second.",
};

export async function getPlatformSeo(): Promise<StoreSeo> {
  "use cache";
  cacheLife("hours");
  cacheTag(PLATFORM_SEO_TAG);
  const [row] = await readDb().execute<Row>(sql`select seo from commerce.platform_settings`);
  return parseStoreSeo(row?.seo);
}

export async function savePlatformSeo(account: Account, input: unknown): Promise<SaveResult> {
  const checked = check(input, { sitemaps: true });
  if (!checked.ok) return checked;
  await db().execute(sql`
    update commerce.platform_settings
       set seo = ${JSON.stringify(checked.seo)}::jsonb, updated_at = now(), updated_by = ${account.id}::uuid
  `);
  await audit(account.id, null, "platform.seo_updated");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Stores
// ---------------------------------------------------------------------------

export async function saveStoreSeo({ account, store }: Membership, input: unknown): Promise<SaveResult> {
  const checked = check(input, { sitemaps: false });
  if (!checked.ok) return checked;
  await db().execute(sql`
    update commerce.stores set seo = ${JSON.stringify(checked.seo)}::jsonb where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, "store.seo_updated", { hidden: checked.seo.hidden });
  refreshTag(storeTag(store.slug));
  return { ok: true };
}

export type PublicStore = {
  id: string;
  slug: string;
  name: string;
  seo: StoreSeo;
  markets: Market[];
  /** The store's languages in use (D109), main first. */
  locales: string[];
  /** A country is shown in the store's other languages too (Several languages on, D178); else in its own only. */
  languageChoice: boolean;
  /** Open, set up and not hidden: listed in sitemaps and llms.txt. */
  indexable: boolean;
  /** Private mode is on (D339): listed nowhere a crawler reads, and its robots.txt shuts everything. */
  private: boolean;
  /** It sells online (D178 step 5: the online shop on); a website has no products, categories, tags or prices to list. */
  selling: boolean;
  /** Kaizena Flow's own store (D466): its pages are Kaizena Flow's site once the switch is on (D474), never a store listed beside the others. */
  house: boolean;
  updatedAt: string;
  /** Its front page (D54), shown at each market's own address rather than its page address. */
  frontPageId: string | null;
  /** The All products page (D83), at /products rather than its own address; none in a website (D178 step 5), where it keeps its own. */
  productsPageId: string | null;
  /** The pages chosen for the blog, search and 404 places (D112): they have places of their own, not page addresses. */
  rolePageIds: string[];
};

/** The linked legal roles as a SQL array, for the sitemap's list of pages that have a place of their own. */
const LEGAL_ROLE_LIST = sql.raw(`array[${LEGAL_ROLES.map((r) => `'${r}'`).join(", ")}]`);

/** Every open store, for robots.txt, the sitemap index and Kaizen's llms.txt. */
export async function listPublicStores(): Promise<PublicStore[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(STORES_TAG);
  const rows = await readDb().execute<Row>(sql`
    select s.id, s.slug, s.name, s.seo, s.locales, s.features, s.is_template, s.starter, s.house, s.setup_completed_at, s.front_page_id, s.products_page_id,
      (s.private_mode and not (s.is_template or s.starter)) as private,
      -- The legal pages (wave 1, 1e) keep their own address and stay in the sitemap once published: only D112's roles are left out.
      (select coalesce(array_agg(r.page_id), '{}') from commerce.page_roles r where r.store_id = s.id and r.role <> all(${LEGAL_ROLE_LIST}::text[])) as role_pages,
      greatest(s.created_at, s.setup_completed_at,
        (select max(p.updated_at) from commerce.products p where p.store_id = s.id)) as updated_at,
      coalesce(json_agg(json_build_object('code', m.code, 'currency', m.currency, 'defaultLocale', m.default_locale)
        order by (m.code = s.country) desc nulls last, m.created_at, m.code)
        filter (where m.code is not null), '[]') as markets
    from commerce.stores s
    left join commerce.markets m on m.store_id = s.id and m.active
    where s.status = 'active'
    group by s.id
    order by s.created_at
  `);
  return rows.map((row) => {
    const seo = parseStoreSeo(row.seo);
    // The countries and languages offered (D178): the store's own country alone with Several countries off, each in its own language with
    // Several languages off.
    const features = normaliseFeatures(((row.features ?? []) as unknown[]).map(String));
    const markets = offeredMarkets((row.markets as { code: string; currency: string; defaultLocale: string }[]).map(toMarket), featureOn(features, "countries"));
    const { locales, languageChoice } = localizationOf(((row.locales ?? []) as string[]).map(String), [], markets, { languages: featureOn(features, "languages") });
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      seo,
      markets,
      locales,
      languageChoice,
      // A store template (D175) is a preview, never for search engines: out of every sitemap and llms.txt.
      // A private store (D339) is listed nowhere a crawler reads.
      indexable: !row.starter && Boolean(row.is_template || row.setup_completed_at) && !seo.hidden && !row.private && markets.length > 0,
      private: Boolean(row.private),
      selling: featureOn(features, "shop"),
      house: row.house === true,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      frontPageId: row.front_page_id ? String(row.front_page_id) : null,
      productsPageId: row.products_page_id && featureOn(features, "shop") ? String(row.products_page_id) : null,
      rolePageIds: ((row.role_pages ?? []) as string[]).map(String),
    };
  });
}

export type IndexedProduct = {
  handle: string;
  updatedAt: string;
  /** Title and short description by locale. */
  text: Record<string, { title: string; description: string }>;
  images: string[];
  /** Market codes the product has a price in. */
  markets: string[];
};

/** A store's active, priced products, for its sitemap and llms.txt. */
export async function listIndexedProducts(storeId: string): Promise<IndexedProduct[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const rows = await readDb().execute<Row>(sql`
    select p.handle, p.updated_at,
      (select coalesce(json_object_agg(t.locale, json_build_object(
          'title', t.title,
          'description', coalesce(nullif(t.seo_description, ''), t.description))), '{}')
        from commerce.product_translations t where t.product_id = p.id) as text,
      (select coalesce(json_agg(m.url order by m.position), '[]')
        from commerce.product_media m where m.product_id = p.id) as images,
      (select coalesce(json_agg(distinct cp.market_code), '[]')
        from commerce.current_prices cp join commerce.product_variants v on v.id = cp.variant_id
        where v.product_id = p.id and v.active) as markets
    from commerce.products p
    where p.store_id = ${storeId}::uuid and p.status = 'active' and ${OFFERED}
    order by p.created_at, p.handle
  `);
  return rows
    .map((row) => ({
      handle: String(row.handle),
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      text: row.text as IndexedProduct["text"],
      images: row.images as string[],
      markets: (row.markets as string[]).map((code) => code.trim().toUpperCase()),
    }))
    .filter((product) => product.markets.length > 0);
}

export type IndexedTerm = {
  kind: "category" | "tag";
  slug: string;
  name: string;
  /** The later of the term's own last change and its products' (a category counts its subcategories' products, as its page does). */
  updatedAt: string;
  /** Market codes (upper case) in which the term has at least one live product. */
  markets: string[];
  seo: TermSeo;
  /** Its own picture (D319), listed with its page in the sitemap. */
  image: string | null;
};

/**
 * A store's product categories and tags that have at least one live product (active, with an active variant priced in a market), for its sitemap (wave 2,
 * D168, `docs/wave-2-redirects.md` 2.5): each with the markets its products are sold in. A category counts its subcategories' products, as its page does. A
 * term with none is left out: its page is an empty list. Cached under the catalogue and terms tags.
 */
export async function listIndexedTerms(storeId: string): Promise<IndexedTerm[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId), termsTag({ storeId, contentType: "product" }));
  const rows = await readDb().execute<Row>(sql`
    with recursive tree (root_id, id) as (
      select t.id, t.id from commerce.terms t where t.store_id = ${storeId}::uuid and t.content_type = 'product'
      union all
      select tree.root_id, c.id from tree join commerce.terms c on c.parent_id = tree.id and c.store_id = ${storeId}::uuid and c.content_type = 'product'
    ),
    -- A term's products: those placed in it or below it by hand, and those meeting the rules of one filled by rules (D319).
    members (root_id, product_id) as (
      select tree.root_id, pt.product_id from tree join commerce.product_terms pt on pt.store_id = ${storeId}::uuid and pt.term_id = tree.id
      union
      select tree.root_id, rp.id from tree
      join commerce.terms rt on rt.id = tree.id and rt.rules is not null
      join commerce.products rp on rp.store_id = ${storeId}::uuid and rp.status = 'active' and commerce.product_matches_rules(${storeId}::uuid, rp.id, rt.rules)
    )
    select t.kind, t.slug, t.name, t.seo, t.image_url, greatest(t.updated_at, max(p.updated_at)) as updated_at,
      array_agg(distinct cp.market_code) as markets
    from commerce.terms t
    join members pt on pt.root_id = t.id
    join commerce.products p on p.store_id = ${storeId}::uuid and p.id = pt.product_id and p.status = 'active' and ${OFFERED}
    join commerce.product_variants v on v.product_id = p.id and v.active
    join commerce.current_prices cp on cp.variant_id = v.id
    where t.store_id = ${storeId}::uuid and t.content_type = 'product'
    group by t.id
    order by t.kind, t.slug
  `);
  return rows.map((row) => ({
    kind: row.kind === "tag" ? "tag" : "category",
    slug: String(row.slug),
    name: String(row.name),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
    markets: ((row.markets ?? []) as string[]).map((code) => String(code).trim().toUpperCase()),
    seo: parseTermSeo(row.seo),
    image: row.image_url == null ? null : String(row.image_url),
  }));
}

/** A product's text in a locale, falling back to any language it has. */
export function productText(product: IndexedProduct, locale: string): { title: string; description: string } {
  return product.text[locale] ?? Object.values(product.text)[0] ?? { title: product.handle, description: "" };
}

/** How many of the store's pictures still use the product title as their description, per locale. */
export async function altTextGaps(storeId: string): Promise<{ pictures: number; titleOnly: number }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as pictures,
      count(*) filter (where exists (
        select 1 from commerce.product_translations t
        where t.product_id = m.product_id and coalesce(m.alt ->> t.locale, '') in ('', t.title)
      ))::int as title_only
    from commerce.product_media m
    join commerce.products p on p.id = m.product_id and p.status <> 'archived'
    where m.store_id = ${storeId}::uuid
  `);
  return { pictures: Number(row?.pictures ?? 0), titleOnly: Number(row?.title_only ?? 0) };
}

// ---------------------------------------------------------------------------
// Storefront
// ---------------------------------------------------------------------------

/** What schema.org and share tags say about a store. */
export function storeFacts(store: Store): StoreFacts {
  return {
    name: store.name,
    url: `${storeSiteUrl(store.slug)}${storeBase(store.slug)}`,
    seo: store.seo,
    details: store.details,
    countries: store.markets.map((market) => market.code),
    returns: store.returnPolicy,
  };
}

/** The market's shipping price in the currency shown (D109), for product offers. Revalidated with the catalogue. */
export async function getShippingFacts(storeId: string, market: Pick<Market, "code" | "currency" | "conversion">): Promise<ShippingFacts> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  // D237 2.6: one unambiguous price for the General profile at Rest of country, or nothing (never a "from" price claimed as the price): the flat rate
  // while the market has no active method, or the one active method whose General, Rest-of-country rate is a single flat tier.
  const methods = await readDb().execute<Row>(sql`
    select m.free_over_minor,
      (select count(*)::int from commerce.shipping_method_rates r where r.store_id = m.store_id and r.method_id = m.id) as rates,
      (select count(*)::int from commerce.shipping_method_rates r where r.store_id = m.store_id and r.method_id = m.id and r.zone_id is null and r.profile_id is null) as general,
      (select r.amount_minor from commerce.shipping_method_rates r where r.store_id = m.store_id and r.method_id = m.id
         and r.zone_id is null and r.profile_id is null and r.basis = 'flat') as flat_amount,
      -- A zone in the market or a profile in the store sends some baskets elsewhere (a zone does not fall back to Rest of country, 4.2 point 2; a
      -- product in another profile is not priced by the General rate): those pay the flat rate, so the method's price is not the one price.
      exists (select 1 from commerce.shipping_zones z where z.store_id = m.store_id and z.market_code = m.market_code) as has_zones,
      exists (select 1 from commerce.shipping_profiles p where p.store_id = m.store_id) as has_profiles
    from commerce.shipping_methods m
    where m.store_id = ${storeId}::uuid and m.market_code = ${market.code} and m.active
  `);
  if (methods.length > 1) return null;
  if (methods.length === 1) {
    const m = methods[0];
    // Rates for zones or profiles too would make the price depend on the address or the product: no single price then.
    if (Number(m.rates) !== 1 || Number(m.general) !== 1 || m.flat_amount === null || m.flat_amount === undefined) return null;
    if (m.has_zones === true || m.has_profiles === true) return null;
    return {
      amountMinor: shown(market, Number(m.flat_amount)),
      freeOverMinor: m.free_over_minor == null ? null : shown(market, Number(m.free_over_minor)),
      currency: market.currency,
    };
  }
  const [row] = await readDb().execute<Row>(sql`
    select amount_minor, free_over_minor, currency from commerce.shipping_rates
    where store_id = ${storeId}::uuid and market_code = ${market.code}
  `);
  return row
    ? {
        amountMinor: shown(market, Number(row.amount_minor)),
        freeOverMinor: row.free_over_minor == null ? null : shown(market, Number(row.free_over_minor)),
        currency: market.currency,
      }
    : null;
}

/** The picture shared for a store page without its own: the owner's, or one Kaizen draws. */
export function storeShareImage(store: Store, locale: string): { url: string; alt: string; width?: number; height?: number } {
  return store.seo.image
    ? { url: store.seo.image.url, alt: store.seo.image.alt[locale] || store.name }
    : { url: `${storeBase(store.slug)}/og.png`, alt: store.name, width: 1200, height: 630 };
}

type ShareImage = { url: string; alt: string; width?: number; height?: number };

/** Open Graph and X (Twitter) tags for a store page; a child page's replace its parent's whole. */
export function storeShareTags(
  store: Store,
  market: Market,
  page: { title: string; description: string; url: string; images: ShareImage[] },
): Pick<Metadata, "openGraph" | "twitter"> {
  return {
    openGraph: {
      type: "website",
      siteName: store.name,
      locale: ogLocale(market.locale),
      alternateLocale: languageChoices(store.localization, market).filter((locale) => locale.split("-")[0] !== market.lang).map((locale) => ogLocale(`${locale.split("-")[0]}-${market.code}`)),
      url: page.url,
      title: page.title,
      description: page.description,
      images: page.images,
    },
    twitter: {
      card: "summary_large_image",
      title: page.title,
      description: page.description,
      images: page.images.map((image) => ({ url: image.url, alt: image.alt })),
    },
  };
}

/** Search console verification tags. */
export function verificationTags(seo: StoreSeo): Metadata["verification"] {
  return {
    ...(seo.verification.google && { google: seo.verification.google }),
    ...(seo.verification.bing && { other: { "msvalidate.01": seo.verification.bing } }),
  };
}

// ---------------------------------------------------------------------------
// robots.txt, sitemaps and llms.txt
// ---------------------------------------------------------------------------

/**
 * Where a store's sitemap is. Not `sitemap.xml`: Next.js reserves that name
 * for its own sitemap files, which break under a store's dynamic path.
 */
export const storeSitemapPath = (slug: string) => `${storeBase(slug)}/store-sitemap.xml`;

/** Kaizen's own pages that are not for crawlers (`/r/` is a referral link, D131: crawlers would only inflate its visits). */
const PLATFORM_PRIVATE = ["/admin", "/api/", "/auth/", "/r/"];

/**
 * The robots.txt for the whole site: Kaizen's rules (with its pages closed
 * to AI crawlers where the page says so, D42), then each open store's
 * under its address.
 */
export async function siteRobots(): Promise<string> {
  // While Kaizena Flow's site is served from its own store (D474), the pages at its addresses are the store's.
  const site = await siteStoreCached();
  const [platform, all, pages, articles] = await Promise.all([
    getPlatformSeo(),
    listPublicStores(),
    listPublishedPages(site?.id ?? null),
    listPublishedPages(site?.id ?? null, "article"),
  ]);
  const stores = all.filter((store) => !store.house);
  const parsed = parseRobotsRules(platform.robots, { sitemaps: true });
  const groups = parsed.groups;
  addRules(groups, ["*"], PLATFORM_PRIVATE.map((path) => ({ allow: false, path })));
  // `$` ends the path, so closing /about leaves /about-us open; articles are under /blog (D57).
  const closed = [
    ...pages.filter((page) => !page.content.aiAssistants).map((page) => ({ allow: false, path: `/${page.slug}$` })),
    ...articles.filter((a) => !a.content.aiAssistants).map((a) => ({ allow: false, path: `/blog/${a.slug}$` })),
  ];
  if (closed.length > 0) addRules(groups, [...AI_ASSISTANT_BOTS, ...AI_TRAINING_BOTS], closed);
  // Stores on their own hosts (P7) have their own robots.txt there.
  if (!storeDomain()) {
    // What every store closes to AI crawlers, in two reads for all of them (a private store closes everything, and needs none).
    const closed = await closedToAiOf(stores.filter((store) => !store.private).map((store) => store.id));
    for (const store of stores) mergeGroups(groups, storeGroups(store, closed.get(store.id) ?? NOTHING_CLOSED));
  }
  return renderRobots(groups, [`${siteUrl()}/sitemap.xml`, ...parsed.sitemaps]);
}

/** What a store closes to AI crawlers (D54): its pages' addresses and its articles' addresses in their own blogs (D341). */
type ClosedToAi = { pages: string[]; articles: string[] };
const NOTHING_CLOSED: ClosedToAi = { pages: [], articles: [] };

const closedPageRow = z.object({ store_id: col.uuid, type: col.text, slug: col.text, published: z.unknown() });
const blogPlaceRow = z.object({ store_id: col.uuid, id: col.uuid, handle: col.text, main: col.bool });

/**
 * The published pages and articles closed to AI crawlers of every store given, each article at its blog's address: two reads for all
 * the stores together, where robots.txt read each store's pages, articles and blogs on its own (three reads a store, too slow for the
 * build once there are thousands of stores). Pages come in the order a store lists them (by when they were made), articles newest first,
 * as `listPublishedPages()` gives them, and a page is closed as it reads (`parsePageContent()`, `aiAssistants` false). For all stores it
 * is read each time, uncached: a page opened or closed shows in robots.txt at once, which one cache entry for every store could not
 * promise (there is no tag for every store's pages); one store's is cached with its pages (`storeClosedToAi()`).
 */
async function closedToAiOf(storeIds: readonly string[]): Promise<Map<string, ClosedToAi>> {
  const out = new Map<string, ClosedToAi>(storeIds.map((id) => [id, { pages: [], articles: [] }]));
  if (storeIds.length === 0) return out;
  const ids = `{${storeIds.join(",")}}`;
  const [rows, blogs] = await Promise.all([
    typedRows(
      closedPageRow,
      sql`
        select store_id, type, slug, published from commerce.pages
        where store_id = any(${ids}::uuid[]) and type in ('page', 'article') and published_at is not null
          and published->>'aiAssistants' = 'false'
        order by store_id, (type = 'article'), case when type = 'page' then created_at end,
          case when type = 'article' then coalesce(first_published_at, published_at) end desc, slug
      `,
      readDb(),
    ),
    typedRows(
      blogPlaceRow,
      sql`select store_id, id, handle, main from commerce.blogs where store_id = any(${ids}::uuid[]) order by store_id, main desc, position, created_at`,
      readDb(),
    ),
  ]);
  const blogsOf = new Map<string, z.output<typeof blogPlaceRow>[]>();
  for (const blog of blogs) blogsOf.set(blog.store_id, [...(blogsOf.get(blog.store_id) ?? []), blog]);
  for (const row of rows) {
    const content = parsePageContent(row.published);
    const closed = out.get(row.store_id);
    if (!content || content.aiAssistants || !closed) continue;
    if (row.type === "page") closed.pages.push(row.slug);
    else {
      // An article is at its own blog's address (D341): `/blog/{slug}` or `/blogs/{handle}/{slug}`.
      const blog = blogOfArticle(blogsOf.get(row.store_id) ?? [], content);
      closed.articles.push(blog ? articlePath(blog, row.slug) : `/blog/${row.slug}`);
    }
  }
  return out;
}

/** A store's rules: its own, and its pages closed to AI crawlers (D54) in every market. */
function storeGroups(store: Pick<Store, "id" | "slug" | "seo"> & { private?: boolean; privateMode?: boolean }, closedToAi: ClosedToAi) {
  const base = storeBase(store.slug);
  const groups = storeRobotsGroups(store.seo, base);
  // A private store (D339): nothing of it for any crawler.
  if (store.private || store.privateMode) {
    addRules(groups, ["*"], [{ allow: false, path: `${base}/` }]);
    return groups;
  }
  const closed = [
    ...closedToAi.pages.flatMap((slug) => [`${base}/*/${slug}$`, `${base}/${slug}$`]),
    ...closedToAi.articles.flatMap((path) => [`${base}/*${path}$`, `${base}${path}$`]),
  ].map((path) => ({ allow: false, path }));
  // In every market, and without the market for a store that sells in one country (D181).
  if (closed.length > 0) addRules(groups, [...AI_ASSISTANT_BOTS, ...AI_TRAINING_BOTS], closed);
  return groups;
}

/** A store's robots.txt: its own on its host (P7); until then a preview of its part of the site's. */
export async function storeRobots(store: Pick<Store, "id" | "slug" | "seo" | "privateMode">): Promise<string> {
  const closed = store.privateMode ? NOTHING_CLOSED : await storeClosedToAi(store.id);
  return renderRobots(storeGroups(store, closed), [`${storeSiteUrl(store.slug)}${storeSitemapPath(store.slug)}`]);
}

/** One store's pages closed to AI crawlers, cached with its pages and blogs (`pagesTag()`), as its own robots.txt is read often. */
async function storeClosedToAi(storeId: string): Promise<ClosedToAi> {
  "use cache";
  cacheLife("hours");
  cacheTag(pagesTag(storeId));
  return (await closedToAiOf([storeId])).get(storeId) ?? NOTHING_CLOSED;
}

const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sitemap index: Kaizen's pages and one sitemap per open store. */
export async function sitemapIndex(): Promise<string> {
  const origin = siteUrl();
  // A sitemap index only lists sitemaps on its own host: stores on theirs (P7) list their own in their robots.txt.
  const stores = storeDomain() ? [] : (await listPublicStores()).filter((store) => store.indexable && !store.house);
  const entries = [
    `<sitemap><loc>${origin}/sitemap-kaizen.xml</loc></sitemap>`,
    // The docs (D442) list their own pages: here while they are on this host, in their own host's robots.txt once they have one.
    ...(docsHost() ? [] : [`<sitemap><loc>${origin}/docs/sitemap.xml</loc></sitemap>`]),
    ...stores.map(
      (store) =>
        `<sitemap><loc>${xml(`${origin}${storeSitemapPath(store.slug)}`)}</loc><lastmod>${store.updatedAt}</lastmod></sitemap>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries.join("\n")}\n</sitemapindex>\n`;
}

/** Kaizen's own pages: the front page, sign-up and every published page and article open to search engines (D42, D57). */
export async function platformSitemap(): Promise<string> {
  const origin = siteUrl();
  // While Kaizena Flow's site is served from its own store (D474), its pages are the store's: listed as the store lists them, beside the
  // platform's own routes that stay (sign-up, the theme store).
  const site = await siteStoreCached();
  if (site) return platformSitemapFromStore(site.slug);
  const [all, articles, roles, themes, entries] = await Promise.all([
    listPublishedPages(),
    listPublishedPages(null, "article"),
    getPlatformPageRoles(),
    themeStoreCards(),
    listIndexedEntries(null),
  ]);
  // A page chosen for a place of its own (D143) is at the place's address, which the list below has already.
  const placed = new Set(roles.map(([, id]) => id));
  const pages = all.filter((page) => !placed.has(page.id));
  const listed = [
    ...pages.filter((page) => page.content.searchEngines).map((page) => ({ page, path: `/${page.slug}` })),
    ...articles.filter((a) => a.content.searchEngines).map((page) => ({ page, path: `/blog/${page.slug}` })),
  ];
  // Each page in every language the site offers (D312), each entry naming the others (`hreflang`); the theme store too (P3).
  const langs = await getPlatformLangs();
  const inEvery = (path: string, extra = "") => {
    const alternates = languageAlternates(path, langs);
    const links = alternates
      ? Object.entries(alternates)
          .map(([tag, href]) => `<xhtml:link rel="alternate" hreflang="${tag}" href="${xml(`${origin}${href}`)}"/>`)
          .join("")
      : "";
    return langs.map((lang) => `<url><loc>${xml(`${origin}${platformPath(lang, path)}`)}</loc>${extra}${links}</url>`);
  };
  const urls = [
    ...["/", "/sign-up", ...(articles.length > 0 || roles.some(([role]) => role === "blog") ? ["/blog"] : [])].flatMap((path) => inEvery(path)),
    // The theme store (`docs/theme-phase-3.md`): its list and each theme's page, here until it has a host of its own (step 3), whose
    // sitemap lists them then (`themeStoreSitemap()`), as a sitemap lists only its own host's addresses.
    ...(themes.length > 0 && !themesHost() ? themeStoreEntries(themes, langs) : []),
    ...listed.flatMap(({ page, path }) =>
      inEvery(
        path,
        `<lastmod>${page.publishedAt}</lastmod>${pageImageUrls(page.content)
          .slice(0, 10)
          .map((url) => `<image:image><image:loc>${xml(absoluteUrl(url, origin))}</image:loc></image:image>`)
          .join("")}`,
      ),
    ),
    // Its own content entries' pages (D326), in every language; a page at the same address is what is there.
    ...entries.filter((item) => !all.some((page) => page.slug === item.path)).flatMap((item) => inEvery(`/${item.path}`, `<lastmod>${item.updatedAt}</lastmod>`)),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * Kaizena Flow's sitemap while its site is served from its own store (D474): sign-up and the theme store in every language, as before, and
 * every address of the store's own sitemap, which are on Kaizena Flow's host now.
 */
async function platformSitemapFromStore(slug: string): Promise<string> {
  const origin = siteUrl();
  const [langs, themes, store] = await Promise.all([getPlatformLangs(), themeStoreCards(), storeSitemapUrls(slug)]);
  const inEvery = (path: string) => {
    const alternates = languageAlternates(path, langs);
    const links = alternates
      ? Object.entries(alternates)
          .map(([tag, href]) => `<xhtml:link rel="alternate" hreflang="${tag}" href="${xml(`${origin}${href}`)}"/>`)
          .join("")
      : "";
    return langs.map((lang) => `<url><loc>${xml(`${origin}${platformPath(lang, path)}`)}</loc>${links}</url>`);
  };
  const urls = [...inEvery("/sign-up"), ...(themes.length > 0 && !themesHost() ? themeStoreEntries(themes, langs) : []), ...(store ?? [])];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * A store's sitemap: each market's home and product pages, each listing its
 * versions in the other markets (hreflang) and the product's pictures.
 * Null when the store is not open to search engines.
 */
export async function storeSitemap(slug: string): Promise<string | null> {
  const urls = await storeSitemapUrls(slug);
  if (!urls) return null;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join("\n")}\n</urlset>\n`;
}

/** The `<url>` entries of a store's sitemap (`storeSitemap()`), or null when the store is not open to search engines. */
async function storeSitemapUrls(slug: string): Promise<string[] | null> {
  const store = (await listPublicStores()).find((s) => s.slug === slug && s.indexable);
  if (!store) return null;
  // Addresses without the country while the store sells in one (D181), as its pages' own links are; read first, so the store's origin is as
  // it was read (Kaizena Flow's own host for its own store while its site is served from it, D474).
  const address = (await getOpenStore(slug))?.address ?? null;
  const origin = storeSiteUrl(store.slug);
  // A website (D178 step 5: the online shop off) lists no products, categories or tags.
  const [products, terms, pages, articles, entries, blogs] = await Promise.all([
    store.selling ? listIndexedProducts(store.id) : Promise.resolve([]),
    store.selling ? listIndexedTerms(store.id) : Promise.resolve([]),
    listPublishedPages(store.id),
    listPublishedPages(store.id, "article"),
    listIndexedEntries(store.id),
    storeBlogs(store.id),
  ]);
  // The pages chosen to stand at another blog's address (D341) are there, not at their own.
  const blogPageIds = blogs.flatMap((blog) => (blog.listingPageId ? [blog.listingPageId] : []));
  const base = `${origin}${storeBase(store.slug)}`;

  const entry = (
    loc: string,
    versions: { locale: string; href: string }[],
    extra: { lastmod?: string; images?: string[]; xDefault?: string } = {},
  ) =>
    [
      "<url>",
      `<loc>${xml(loc)}</loc>`,
      extra.lastmod && `<lastmod>${extra.lastmod}</lastmod>`,
      ...(versions.length > 1 ? versions : []).map(
        (v) => `<xhtml:link rel="alternate" hreflang="${v.locale}" href="${xml(v.href)}"/>`,
      ),
      extra.xDefault && `<xhtml:link rel="alternate" hreflang="x-default" href="${xml(extra.xDefault)}"/>`,
      ...(extra.images ?? []).map((image) => `<image:image><image:loc>${xml(absoluteUrl(image, origin))}</image:loc></image:image>`),
      "</url>",
    ]
      .filter(Boolean)
      .join("");

  // Every country offered in every language it is shown in (D109, D178); a currency is not another page. Kaizena Flow's own store names its
  // languages alone, as Kaizena Flow's site always has (D474, `houseLanguageAlternates()`).
  const views = (markets: readonly Market[]) =>
    markets.flatMap((m) =>
      languageChoices(store, m).map((locale) => ({
        locale: store.house ? locale.split("-")[0] : `${locale.split("-")[0]}-${m.code}`,
        slug: inView(m, { locale, currency: m.nativeCurrency }).slug,
      })),
    );
  const versionsOf = (markets: readonly Market[], path: string) =>
    views(markets).map((v) => ({ locale: v.locale, href: `${marketOrigin(store.slug, v.slug, address)}${marketPath(store.slug, v.slug, path, address) || "/"}` }));
  // Kaizena Flow's own store: every page with versions names its own language's as the default (D474), as Kaizena Flow's sitemap did.
  const houseDefault = (versions: { href: string }[]) => (store.house && versions.length > 1 ? versions[0].href : undefined);
  const homes = versionsOf(store.markets, "");
  const urls = [
    ...homes.map((home) =>
      entry(home.href, homes, {
        lastmod: store.updatedAt,
        xDefault: store.markets.length > 1 ? base : houseDefault(homes),
      }),
    ),
    ...products.flatMap((product) => {
      const markets = store.markets.filter((m) => product.markets.includes(m.code));
      const versions = versionsOf(markets, `/p/${product.handle}`);
      return versions.map((version) =>
        entry(version.href, versions, { lastmod: product.updatedAt, images: product.images.slice(0, 5) }),
      );
    }),
    // Its category and tag pages (wave 2, D168): in each market where a live product is, listing only current addresses (an old slug redirects and is in no sitemap).
    ...terms.flatMap((term) => {
      const markets = store.markets.filter((m) => term.markets.includes(m.code));
      const versions = versionsOf(markets, `/${term.kind}/${term.slug}`);
      return versions.map((version) =>
        entry(version.href, versions, { lastmod: term.updatedAt, xDefault: versions.length > 1 ? versions[0].href : undefined, images: term.image ? [term.image] : [] }),
      );
    }),
    // Its pages (D54) open to search engines, in every market; the front page is the markets' own address.
    ...pages
      .filter((page) => page.content.searchEngines && page.id !== store.frontPageId && page.id !== store.productsPageId && !store.rolePageIds.includes(page.id) && !blogPageIds.includes(page.id))
      .flatMap((page) => {
        // Only in the countries it is for (D338).
        const versions = versionsOf(store.markets.filter((m) => pageInMarket(page.content, m.code)), `/${page.slug}`);
        // Every picture on the page (D89), its own first, so search engines tie each to the page it is on.
        const image = pageImageUrls(page.content).slice(0, 10);
        return versions.map((version) => entry(version.href, versions, { lastmod: page.publishedAt, images: image, xDefault: houseDefault(versions) }));
      }),
    // Its blogs (D57, D341): each one's list in every market while it has an article, and each article open to search engines at its blog's address.
    ...blogs
      .filter((blog) => articles.some((article) => inBlog(blogs, blog, article.content)))
      .flatMap((blog) => {
        const versions = versionsOf(store.markets, blogPath(blog));
        return versions.map((version) => entry(version.href, versions, { xDefault: houseDefault(versions) }));
      }),
    ...articles
      .filter((article) => article.content.searchEngines)
      .flatMap((article) => {
        const blog = blogOfArticle(blogs, article.content);
        const versions = versionsOf(
          store.markets.filter((m) => pageInMarket(article.content, m.code)),
          blog ? articlePath(blog, article.slug) : `/blog/${article.slug}`,
        );
        const image = pageImageUrls(article.content).slice(0, 10);
        return versions.map((version) => entry(version.href, versions, { lastmod: article.publishedAt, images: image, xDefault: houseDefault(versions) }));
      }),
    // Its content entries' own pages (D326), published and of a type with pages, in every market.
    ...entries.filter((item) => !pages.some((page) => page.slug === item.path)).flatMap((item) => {
      const versions = versionsOf(store.markets, `/${item.path}`);
      return versions.map((version) => entry(version.href, versions, { lastmod: item.updatedAt, xDefault: houseDefault(versions) }));
    }),
  ];
  return urls;
}

/** Kaizen's llms.txt: what Kaizen is, its pages open to AI assistants (D42), and where each open store's own llms.txt is. */
export async function platformLlms(): Promise<string> {
  const origin = siteUrl();
  // While Kaizena Flow's site is served from its own store (D474), the pages at its addresses are the store's.
  const site = await siteStoreCached();
  const [seo, stores, all, articles, roles] = await Promise.all([
    getPlatformSeo(),
    listPublicStores(),
    listPublishedPages(site?.id ?? null),
    listPublishedPages(site?.id ?? null, "article"),
    getPlatformPageRoles(),
  ]);
  // A page chosen for a place of its own (D143) is at the place's address, not its own; the store's front and special pages likewise.
  const house = stores.find((store) => store.house);
  const placed = new Set(site && house ? [house.frontPageId, ...house.rolePageIds].filter((id): id is string => id !== null) : roles.map(([, id]) => id));
  const pages = all.filter((page) => !placed.has(page.id));
  return renderLlms({
    name: seo.title.en || PLATFORM_DEFAULTS.title,
    summary: seo.description.en || PLATFORM_DEFAULTS.description,
    text: seo.llms,
    sections: [
      {
        heading: "Stores",
        links: stores
          .filter((store) => store.indexable && !store.house)
          .map((store) => ({
            title: store.name,
            url: storeFileUrl(store.slug, "/llms.txt"),
            note: `sells to ${store.markets.map((m) => m.name).join(", ")}`,
          })),
      },
      {
        heading: "Pages",
        links: pages
          .filter((page) => page.content.aiAssistants)
          .map((page) => ({
            title: page.content.title,
            url: `${origin}/${page.slug}`,
            note: page.content.seo.description || pageExcerpt(page.content, 200),
          })),
      },
      {
        // Kaizen's blog (D57), newest first.
        heading: "Blog",
        links: articles
          .filter((article) => article.content.aiAssistants)
          .map((article) => ({
            title: article.content.title,
            url: `${origin}/blog/${article.slug}`,
            note: article.content.seo.description || pageExcerpt(article.content, 200),
          })),
      },
      {
        heading: "Kaizena Flow",
        links: [
          { title: "Start a store", url: `${origin}/sign-up` },
          // The docs (D442): how to run a store and how to build on it, each page as Markdown.
          { title: "Documentation", url: docsUrl("llms.txt"), note: "guides for store owners and the APIs for developers" },
          { title: "Sitemap", url: `${origin}/sitemap.xml` },
        ],
      },
    ],
  });
}

/**
 * A store's llms.txt: who sells, where and on what terms, and every product
 * with its price, so an AI assistant can answer and link without crawling.
 * Null when the store is not open to search engines.
 */
export async function storeLlms(slug: string): Promise<string | null> {
  const store = await getOpenStore(slug);
  const listed = (await listPublicStores()).find((s) => s.slug === slug && s.indexable);
  const market = store?.markets[0];
  if (!store || !listed || !market) return null;
  const origin = storeSiteUrl(store.slug);
  const m = t(market.lang);
  const home = (code: string) => marketUrl(store.slug, code.toLowerCase());
  // A website (D178 step 5: the online shop off) sells nothing: who it is, its pages and blog, and no products, prices or terms of sale.
  const selling = featureOn(store, "shop");
  const [products, indexed, shipping, pages, articles] = await Promise.all([
    selling ? listProducts(store.id, market) : Promise.resolve([]),
    selling ? listIndexedProducts(store.id) : Promise.resolve([]),
    selling ? Promise.all(store.markets.map((mk) => getShippingFacts(store.id, mk))) : Promise.resolve([]),
    listPublishedPages(store.id),
    listPublishedPages(store.id, "article"),
  ]);
  const blogs = await storeBlogs(store.id);
  const byHandle = new Map(indexed.map((p) => [p.handle, p]));
  const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");
  const d = store.details;

  return renderLlms({
    name: store.name,
    summary: store.seo.description[market.locale] || m.storeSummary(store.name, market.name),
    text: store.seo.llms,
    sections: [
      // A website (D178 step 5: the online shop off) says who runs it; a shop how to buy and what it sells.
      ...(selling
        ? [
          {
            heading: "Shopping here",
            lines: [
              `Seller: ${[d.legalName ?? store.name, d.organisationNumber && `organisation number ${d.organisationNumber}`, d.postalAddress?.replace(/\s*\n\s*/g, ", ")].filter(Boolean).join(", ")}.`,
              ...(d.contactEmail ? [`Contact: ${d.contactEmail}.`] : []),
              ...store.markets.map((mk, i) => {
                const rate = shipping[i];
                const cost = !rate
                  ? "no shipping price set yet"
                  : `shipping ${money(rate.amountMinor, rate.currency)}${rate.freeOverMinor ? `, free from ${money(rate.freeOverMinor, rate.currency)}` : ""}`;
                return `${mk.name}: prices in ${mk.currency} including VAT, ${cost}. Store: ${home(mk.code)}`;
              }),
              "Shoppers have 14 days to change their mind (right of withdrawal), except for products the listing says are excluded.",
              `To buy: add products to the cart on the product page, then pay by card at checkout (${home(market.code)}/cart).`,
              // Shopping agents (D353): only while the store serves them.
              ...(agentProblem(store) === null
                ? [`Shopping agents: the store's UCP profile is ${agentProfileUrl(store.slug)}, its MCP endpoint ${agentEndpoint(store.slug)} (see ${storeFileUrl(store.slug, "/agents.md")}).`]
                : []),
            ],
          },
          {
            heading: `Products (${market.name}, ${market.currency})`,
            links: products.map((product) => {
              const text = byHandle.get(product.handle);
              const description = text ? summarize(productText(text, market.locale).description, 200) : "";
              // Price on request (D431): said so, never the price.
              const price = product.priceOnRequest ? "price on request" : `${product.priceVaries ? "from " : ""}${money(product.price.amountMinor, product.price.currency)}`;
              return {
                title: product.title,
                url: `${home(market.code)}/p/${product.handle}`,
                note: [price, description].filter(Boolean).join(". "),
              };
            }),
          },
          ]
        : [
            {
              heading: "About",
              lines: [
                `Run by: ${[d.legalName ?? store.name, d.organisationNumber && `organisation number ${d.organisationNumber}`, d.postalAddress?.replace(/\s*\n\s*/g, ", ")].filter(Boolean).join(", ")}.`,
                ...(d.contactEmail ? [`Contact: ${d.contactEmail}.`] : []),
                `Website: ${home(market.code)}`,
              ],
            },
          ]),
      {
        // Its own pages open to AI assistants (D54), in the first market's language.
        heading: "Pages",
        links: pages
          .filter((page) => page.content.aiAssistants && pageInMarket(page.content, market.code) && page.id !== store.frontPageId && !(selling && page.id === store.productsPageId) && !Object.values(store.pageRoles).includes(page.id))
          .map((page) => {
            const c = localizePage(page.content, market.locale);
            return { title: c.title, url: `${home(market.code)}/${page.slug}`, note: c.seo.description || pageExcerpt(c, 200) };
          }),
      },
      {
        // Its blog (D57), newest first, in the first market's language.
        heading: "Blog",
        links: articles
          .filter((article) => article.content.aiAssistants && pageInMarket(article.content, market.code))
          .map((article) => {
            const c = localizePage(article.content, market.locale);
            const blog = blogOfArticle(blogs, article.content);
            return { title: c.title, url: `${home(market.code)}${blog ? articlePath(blog, article.slug) : `/blog/${article.slug}`}`, note: c.seo.description || pageExcerpt(c, 200) };
          }),
      },
      {
        heading: "Optional",
        links: [
          ...store.markets.slice(1).map((mk) => ({ title: `${store.name} in ${mk.name}`, url: home(mk.code), note: `prices in ${mk.currency}` })),
          { title: "Sitemap", url: `${origin}${storeSitemapPath(store.slug)}` },
        ],
      },
    ],
  });
}

/**
 * The theme store's list and each theme's page in every language the site offers (D312 P3), each entry naming the others (`hreflang`), at
 * the addresses `themeStoreUrl()` gives: the theme store's own host's where it has one.
 */
function themeStoreEntries(themes: readonly { slug: string }[], langs: readonly PlatformLang[]): string[] {
  return ["", ...themes.map((theme) => theme.slug)].flatMap((sub) => {
    const alternates = themeStoreAlternates(sub, langs);
    const links = alternates
      ? Object.entries(alternates)
          .map(([tag, href]) => `<xhtml:link rel="alternate" hreflang="${tag}" href="${xml(href)}"/>`)
          .join("")
      : "";
    return langs.map((lang) => `<url><loc>${xml(themeStoreUrl(sub, lang))}</loc>${links}</url>`);
  });
}

/** The theme store's own host's sitemap (`docs/theme-phase-3.md` step 3): its list and each theme's page; null while it has no host. */
export async function themeStoreSitemap(): Promise<string | null> {
  if (!themesHost()) return null;
  const [themes, langs] = await Promise.all([themeStoreCards(), getPlatformLangs()]);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n${themeStoreEntries(themes, langs).join("\n")}\n</urlset>\n`;
}

/** The theme store's own host's rules for crawlers: everything open, and its sitemap; null while it has no host. */
export function themeStoreRobots(): string | null {
  const origin = themesOrigin();
  return origin ? `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n` : null;
}
