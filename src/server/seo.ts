import "server-only";

import { sql } from "drizzle-orm";
import type { Metadata } from "next";
import { cacheLife, cacheTag } from "next/cache";
import type { z } from "zod";

import { db, readDb } from "@/db/client";
import { t } from "@/lib/i18n";
import { toMarket, type Market } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { marketPath, storeBase, storeDomain, storeSiteUrl } from "@/lib/paths";
import { pageExcerpt } from "@/lib/page-content";
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
import type { ShippingFacts, StoreFacts } from "@/lib/structured-data";

import { audit, type Account, type Membership } from "./auth";
import { CATALOG_TAG, catalogTag, listProducts } from "./catalog";
import { listPublishedPages } from "./pages";
import type { SaveResult } from "./settings";
import { getOpenStore, type Store } from "./stores";

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
  title: "Kaizen",
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
  return { ok: true };
}

export type PublicStore = {
  id: string;
  slug: string;
  name: string;
  seo: StoreSeo;
  markets: Market[];
  /** Open, set up and not hidden: listed in sitemaps and llms.txt. */
  indexable: boolean;
  updatedAt: string;
  /** Its front page (D54), shown at each market's own address rather than its page address. */
  frontPageId: string | null;
};

/** Every open store, for robots.txt, the sitemap index and Kaizen's llms.txt. */
export async function listPublicStores(): Promise<PublicStore[]> {
  "use cache";
  cacheLife("hours");
  cacheTag(STORES_TAG);
  const rows = await readDb().execute<Row>(sql`
    select s.id, s.slug, s.name, s.seo, s.is_template, s.setup_completed_at, s.front_page_id,
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
    const markets = (row.markets as { code: string; currency: string; defaultLocale: string }[]).map(toMarket);
    return {
      id: String(row.id),
      slug: String(row.slug),
      name: String(row.name),
      seo,
      markets,
      indexable: Boolean(row.is_template || row.setup_completed_at) && !seo.hidden && markets.length > 0,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      frontPageId: row.front_page_id ? String(row.front_page_id) : null,
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
    where p.store_id = ${storeId}::uuid and p.status = 'active'
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
  };
}

/** The market's shipping price, for product offers. Revalidated with the catalogue. */
export async function getShippingFacts(storeId: string, marketCode: string): Promise<ShippingFacts> {
  "use cache";
  cacheLife("hours");
  cacheTag(CATALOG_TAG, catalogTag(storeId));
  const [row] = await readDb().execute<Row>(sql`
    select amount_minor, free_over_minor, currency from commerce.shipping_rates
    where store_id = ${storeId}::uuid and market_code = ${marketCode}
  `);
  return row
    ? {
        amountMinor: Number(row.amount_minor),
        freeOverMinor: row.free_over_minor == null ? null : Number(row.free_over_minor),
        currency: String(row.currency).trim(),
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
      alternateLocale: store.markets.filter((m) => m.locale !== market.locale).map((m) => ogLocale(m.locale)),
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

/** Kaizen's own pages that are not for crawlers. */
const PLATFORM_PRIVATE = ["/admin", "/api/", "/auth/"];

/**
 * The robots.txt for the whole site: Kaizen's rules (with its pages closed
 * to AI crawlers where the page says so, D42), then each open store's
 * under its address.
 */
export async function siteRobots(): Promise<string> {
  const [platform, stores, pages, articles] = await Promise.all([
    getPlatformSeo(),
    listPublicStores(),
    listPublishedPages(),
    listPublishedPages(null, "article"),
  ]);
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
  if (!storeDomain()) for (const store of stores) mergeGroups(groups, await storeGroups(store));
  return renderRobots(groups, [`${siteUrl()}/sitemap.xml`, ...parsed.sitemaps]);
}

/** A store's rules: its own, and its pages closed to AI crawlers (D54) in every market. */
async function storeGroups(store: Pick<Store, "id" | "slug" | "seo">) {
  const base = storeBase(store.slug);
  const groups = storeRobotsGroups(store.seo, base);
  const [pages, articles] = await Promise.all([listPublishedPages(store.id), listPublishedPages(store.id, "article")]);
  const closed = [
    ...pages.filter((page) => !page.content.aiAssistants).map((page) => ({ allow: false, path: `${base}/*/${page.slug}$` })),
    ...articles.filter((a) => !a.content.aiAssistants).map((a) => ({ allow: false, path: `${base}/*/blog/${a.slug}$` })),
  ];
  if (closed.length > 0) addRules(groups, [...AI_ASSISTANT_BOTS, ...AI_TRAINING_BOTS], closed);
  return groups;
}

/** A store's robots.txt: its own on its host (P7); until then a preview of its part of the site's. */
export async function storeRobots(store: Pick<Store, "id" | "slug" | "seo">): Promise<string> {
  return renderRobots(await storeGroups(store), [`${storeSiteUrl(store.slug)}${storeSitemapPath(store.slug)}`]);
}

const xml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The sitemap index: Kaizen's pages and one sitemap per open store. */
export async function sitemapIndex(): Promise<string> {
  const origin = siteUrl();
  // A sitemap index only lists sitemaps on its own host: stores on theirs (P7) list their own in their robots.txt.
  const stores = storeDomain() ? [] : (await listPublicStores()).filter((store) => store.indexable);
  const entries = [
    `<sitemap><loc>${origin}/sitemap-kaizen.xml</loc></sitemap>`,
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
  const [pages, articles] = await Promise.all([listPublishedPages(), listPublishedPages(null, "article")]);
  const listed = [
    ...pages.filter((page) => page.content.searchEngines).map((page) => ({ page, path: `/${page.slug}` })),
    ...articles.filter((a) => a.content.searchEngines).map((page) => ({ page, path: `/blog/${page.slug}` })),
  ];
  const urls = [
    ...["/", "/sign-up", ...(articles.length > 0 ? ["/blog"] : [])].map((path) => `<url><loc>${origin}${path}</loc></url>`),
    ...listed.map(
      ({ page, path }) =>
        `<url><loc>${xml(`${origin}${path}`)}</loc><lastmod>${page.publishedAt}</lastmod>${
          page.content.thumbnail
            ? `<image:image><image:loc>${xml(absoluteUrl(page.content.thumbnail.url, origin))}</image:loc></image:image>`
            : ""
        }</url>`,
    ),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join("\n")}\n</urlset>\n`;
}

/**
 * A store's sitemap: each market's home and product pages, each listing its
 * versions in the other markets (hreflang) and the product's pictures.
 * Null when the store is not open to search engines.
 */
export async function storeSitemap(slug: string): Promise<string | null> {
  const store = (await listPublicStores()).find((s) => s.slug === slug && s.indexable);
  if (!store) return null;
  const origin = storeSiteUrl(store.slug);
  const [products, pages, articles] = await Promise.all([
    listIndexedProducts(store.id),
    listPublishedPages(store.id),
    listPublishedPages(store.id, "article"),
  ]);
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

  const homes = store.markets.map((m) => ({ locale: m.locale, href: `${base}/${m.slug}` }));
  const urls = [
    ...store.markets.map((m) =>
      entry(`${base}/${m.slug}`, homes, {
        lastmod: store.updatedAt,
        xDefault: store.markets.length > 1 ? base : undefined,
      }),
    ),
    ...products.flatMap((product) => {
      const markets = store.markets.filter((m) => product.markets.includes(m.code));
      const versions = markets.map((m) => ({ locale: m.locale, href: `${base}/${m.slug}/p/${product.handle}` }));
      return versions.map((version) =>
        entry(version.href, versions, { lastmod: product.updatedAt, images: product.images.slice(0, 5) }),
      );
    }),
    // Its pages (D54) open to search engines, in every market; the front page is the markets' own address.
    ...pages
      .filter((page) => page.content.searchEngines && page.id !== store.frontPageId)
      .flatMap((page) => {
        const versions = store.markets.map((m) => ({ locale: m.locale, href: `${base}/${m.slug}/${page.slug}` }));
        const image = page.content.thumbnail ? [page.content.thumbnail.url] : [];
        return versions.map((version) => entry(version.href, versions, { lastmod: page.publishedAt, images: image }));
      }),
    // Its blog (D57): the list in every market, and each article open to search engines.
    ...(articles.length > 0
      ? store.markets.map((m) => {
          const versions = store.markets.map((v) => ({ locale: v.locale, href: `${base}/${v.slug}/blog` }));
          return entry(`${base}/${m.slug}/blog`, versions);
        })
      : []),
    ...articles
      .filter((article) => article.content.searchEngines)
      .flatMap((article) => {
        const versions = store.markets.map((m) => ({ locale: m.locale, href: `${base}/${m.slug}/blog/${article.slug}` }));
        const image = article.content.thumbnail ? [article.content.thumbnail.url] : [];
        return versions.map((version) => entry(version.href, versions, { lastmod: article.publishedAt, images: image }));
      }),
  ];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml" xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n${urls.join("\n")}\n</urlset>\n`;
}

/** Kaizen's llms.txt: what Kaizen is, its pages open to AI assistants (D42), and where each open store's own llms.txt is. */
export async function platformLlms(): Promise<string> {
  const origin = siteUrl();
  const [seo, stores, pages, articles] = await Promise.all([
    getPlatformSeo(),
    listPublicStores(),
    listPublishedPages(),
    listPublishedPages(null, "article"),
  ]);
  return renderLlms({
    name: seo.title.en || PLATFORM_DEFAULTS.title,
    summary: seo.description.en || PLATFORM_DEFAULTS.description,
    text: seo.llms,
    sections: [
      {
        heading: "Stores",
        links: stores
          .filter((store) => store.indexable)
          .map((store) => ({
            title: store.name,
            url: `${storeSiteUrl(store.slug)}${storeBase(store.slug)}/llms.txt`,
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
        heading: "Kaizen",
        links: [
          { title: "Start a store", url: `${origin}/sign-up` },
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
  const home = (code: string) => `${origin}${marketPath(store.slug, code.toLowerCase())}`;
  const [products, indexed, shipping, pages, articles] = await Promise.all([
    listProducts(store.id, market.code, market.locale),
    listIndexedProducts(store.id),
    Promise.all(store.markets.map((mk) => getShippingFacts(store.id, mk.code))),
    listPublishedPages(store.id),
    listPublishedPages(store.id, "article"),
  ]);
  const byHandle = new Map(indexed.map((p) => [p.handle, p]));
  const money = (minor: number, currency: string) => formatMoney(minor, currency, "en-GB");
  const d = store.details;

  return renderLlms({
    name: store.name,
    summary: store.seo.description[market.locale] || m.storeSummary(store.name, market.name),
    text: store.seo.llms,
    sections: [
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
        ],
      },
      {
        heading: `Products (${market.name}, ${market.currency})`,
        links: products.map((product) => {
          const text = byHandle.get(product.handle);
          const description = text ? summarize(productText(text, market.locale).description, 200) : "";
          const price = `${product.priceVaries ? "from " : ""}${money(product.price.amountMinor, product.price.currency)}`;
          return {
            title: product.title,
            url: `${home(market.code)}/p/${product.handle}`,
            note: [price, description].filter(Boolean).join(". "),
          };
        }),
      },
      {
        // Its own pages open to AI assistants (D54), in the first market's language.
        heading: "Pages",
        links: pages
          .filter((page) => page.content.aiAssistants && page.id !== store.frontPageId)
          .map((page) => {
            const c = localizePage(page.content, market.locale);
            return { title: c.title, url: `${home(market.code)}/${page.slug}`, note: c.seo.description || pageExcerpt(c, 200) };
          }),
      },
      {
        // Its blog (D57), newest first, in the first market's language.
        heading: "Blog",
        links: articles
          .filter((article) => article.content.aiAssistants)
          .map((article) => {
            const c = localizePage(article.content, market.locale);
            return { title: c.title, url: `${home(market.code)}/blog/${article.slug}`, note: c.seo.description || pageExcerpt(c, 200) };
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
