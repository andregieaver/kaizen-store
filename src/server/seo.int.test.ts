import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseStoreSeo } from "@/lib/seo";

import type { Membership } from "./auth";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));

const seo = await import("./seo");
const { getStore } = await import("./stores");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const slug = `seo-${run}`;
let member: Membership;

const settings = (overrides: Record<string, unknown> = {}) => ({
  title: { "nb-NO": "Kopper fra Oslo" },
  description: { "nb-NO": "Håndlagde kopper." },
  image: null,
  sameAs: ["https://instagram.com/kopp"],
  hidden: false,
  aiAssistants: true,
  aiTraining: false,
  robots: "Disallow: /no/p/gammel",
  llms: "Vi dreier alt selv.",
  verification: { google: "abc", bing: "" },
  ...overrides,
});

beforeAll(async () => {
  // A store copied from the demo, as sign-up makes one, then opened.
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name)
    values (${`seo-${run}@example.com`}, 'Kari', 'Kopp') returning id
  `);
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, 'Kopp', null)`);
  await db().execute(sql`update commerce.stores set setup_completed_at = now(), country = 'NO' where slug = ${slug}`);
  const [account] = await db().execute<Row>(sql`
    select id, email from commerce.accounts where lower(email) = ${`seo-${run}@example.com`}
  `);
  const store = await getStore(slug);
  member = {
    account: { id: String(account.id), email: String(account.email), name: "Kari", platformAdmin: false },
    store: store!,
    role: "owner",
  };
});

afterAll(async () => {
  await closeDb();
});

describe("a store's search settings", () => {
  it("saves valid settings and keeps no empty languages", async () => {
    const result = await seo.saveStoreSeo(member, settings({ description: { "nb-NO": "Håndlagde kopper.", "sv-SE": "" } }));
    expect(result).toEqual({ ok: true });
    const store = await getStore(slug);
    expect(store?.seo).toMatchObject({ title: { "nb-NO": "Kopper fra Oslo" }, description: { "nb-NO": "Håndlagde kopper." }, aiTraining: false });
    expect(store?.seo.description).not.toHaveProperty("sv-SE");
  });

  it("refuses crawler rules it cannot read, saying which line", async () => {
    const result = await seo.saveStoreSeo(member, settings({ robots: "Noindex: /x" }));
    expect(result).toEqual({
      ok: false,
      problems: ['Crawler rules: Line 1: "Noindex" is not supported here. Use User-agent, Allow or Disallow.'],
    });
  });

  it("puts the store's rules in the site's robots.txt under its address", async () => {
    const robots = await seo.siteRobots();
    expect(robots).toContain(`Disallow: /s/${slug}/no/p/gammel`);
    expect(robots).toMatch(new RegExp(`User-agent: GPTBot\\n[^]*?Disallow: /s/${slug}/\\n`));
    expect(robots).toContain("Disallow: /admin");
  });

  it("lists the open store's products in its sitemap and llms.txt, with the owner's words", async () => {
    const sitemap = await seo.storeSitemap(slug);
    expect(sitemap).toContain(`/s/${slug}/no/p/`);
    const llms = await seo.storeLlms(slug);
    expect(llms).toMatch(/^# Kopp\n\n> Håndlagde kopper\.\n\nVi dreier alt selv\.\n/);
    expect(llms).toContain("## Products (Norge, NOK)");
    expect((await seo.sitemapIndex())).toContain(`/s/${slug}/store-sitemap.xml`);
  });

  it("copies the template's pages and front page, and lists the pages in the sitemap, llms.txt and robots.txt (D53-D56)", async () => {
    const pages = await db().execute<Row>(sql`
      select p.slug, p.id = s.front_page_id as front, p.id = s.products_page_id as products, p.published -> 'translations' as translations
      from commerce.pages p join commerce.stores s on s.id = p.store_id
      where s.slug = ${slug} and p.type = 'page' order by p.slug
    `);
    // And its All products page (D83).
    expect(pages.map((p) => [p.slug, p.front, p.products])).toEqual([
      ["alle-produkter", false, true],
      ["forside", true, false],
      ["om-oss", false, false],
    ]);
    expect(pages[2].translations).toHaveProperty("sv-SE");
    // The template's articles come along as articles (D57).
    const [article] = await db().execute<Row>(sql`
      select p.slug from commerce.pages p join commerce.stores s on s.id = p.store_id
      where s.slug = ${slug} and p.type = 'article'
    `);
    expect(article?.slug).toBe("nye-produkter");
    // Its blog is in the sitemap and llms.txt (D57).
    const withBlog = await seo.storeSitemap(slug);
    expect(withBlog).toContain(`/s/${slug}/se/blog/nye-produkter</loc>`);
    expect(withBlog).toContain(`/s/${slug}/no/blog</loc>`);
    expect(await seo.storeLlms(slug)).toContain(`## Blog\n\n- [Nye produkter i høst](`);

    const sitemap = await seo.storeSitemap(slug);
    for (const market of ["no", "se", "dk"]) expect(sitemap).toContain(`/s/${slug}/${market}/om-oss</loc>`);
    // The front page is each market's own address, and the All products page is at /products.
    expect(sitemap).not.toContain("/forside");
    expect(sitemap).not.toContain("/alle-produkter");
    const llms = await seo.storeLlms(slug);
    expect(llms).toContain("## Pages\n\n- [Om oss](");
    expect(llms).toContain(`/s/${slug}/no/om-oss): Kaizen Demo selger`);

    // A page closed to AI assistants is closed to their crawlers in every market.
    await db().execute(sql`
      update commerce.pages set published = jsonb_set(published, '{aiAssistants}', 'false')
      where slug = 'om-oss' and store_id = (select id from commerce.stores where slug = ${slug})
    `);
    const robots = await seo.siteRobots();
    expect(robots.slice(robots.indexOf("User-agent: GPTBot"))).toContain(`Disallow: /s/${slug}/*/om-oss$`);
    expect(await seo.storeLlms(slug)).not.toContain("## Pages");
  });

  it("leaves a hidden store out of sitemaps and llms.txt", async () => {
    await seo.saveStoreSeo(member, settings({ hidden: true }));
    expect(await seo.storeSitemap(slug)).toBeNull();
    expect(await seo.storeLlms(slug)).toBeNull();
    expect(await seo.sitemapIndex()).not.toContain(`/s/${slug}/`);
    expect(await seo.platformLlms()).not.toContain(`/s/${slug}/`);
  });
});

describe("Kaizen's own search settings", () => {
  it("saves them, with sitemap lines allowed in its crawler rules", async () => {
    const before = await seo.getPlatformSeo();
    const result = await seo.savePlatformSeo(
      member.account,
      settings({ title: { en: "Kaizen" }, robots: "Sitemap: https://example.com/extra.xml" }),
    );
    expect(result).toEqual({ ok: true });
    expect(await seo.siteRobots()).toContain("Sitemap: https://example.com/extra.xml");
    // Leave the shared settings as they were.
    await db().execute(sql`update commerce.platform_settings set seo = ${JSON.stringify(before)}::jsonb`);
    expect(parseStoreSeo((await db().execute<Row>(sql`select seo from commerce.platform_settings`))[0].seo).robots).toBe(before.robots);
  });
});

describe("the sitemap's category and tag pages (wave 2, D168)", () => {
  const entryOf = (xml: string, path: string): string[] => xml.split("<url>").filter((u) => u.includes(`<loc>${path}</loc>`)).map((u) => `<url>${u}`);
  const termId = async (kind: "category" | "tag", slug: string, parent: string | null = null): Promise<string> => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.terms (store_id, content_type, kind, name, slug, parent_id) values (${member.store.id}::uuid, 'product', ${kind}, ${slug}, ${slug}, ${parent}::uuid) returning id
    `);
    return String(row.id);
  };
  const attach = (termIdValue: string, productId: string) =>
    db().execute(sql`insert into commerce.product_terms (store_id, product_id, term_id) select p.store_id, p.id, ${termIdValue}::uuid from commerce.products p where p.id = ${productId}::uuid`);
  /** An active product of the store and the markets it is priced in. */
  const product = async (): Promise<{ id: string; markets: string[] }> => {
    const [row] = await db().execute<Row>(sql`
      select p.id, (select array_agg(distinct lower(cp.market_code)) from commerce.product_variants v join commerce.current_prices cp on cp.variant_id = v.id where v.product_id = p.id and v.active) as markets
      from commerce.products p where p.store_id = ${member.store.id}::uuid and p.status = 'active' order by p.handle limit 1
    `);
    return { id: String(row.id), markets: (row.markets as string[]).map((m) => m.trim()).sort() };
  };

  it("lists a category with a live product in each market it is sold in, with alternates, an x-default and a lastmod, and leaves one with none out", async () => {
    await seo.saveStoreSeo(member, settings({ hidden: false }));
    const p = await product();
    expect(p.markets.length).toBeGreaterThan(1);
    const withProduct = await termId("category", `sm-with-${run}`);
    const empty = await termId("category", `sm-empty-${run}`);
    await attach(withProduct, p.id);
    const xml = (await seo.storeSitemap(slug))!;
    for (const market of p.markets) expect(xml, market).toContain(`/s/${slug}/${market}/category/sm-with-${run}</loc>`);
    const origin = xml.match(/<loc>(https?:\/\/[^/]+)\/s\//)![1];
    const entries = entryOf(xml, `${origin}/s/${slug}/${p.markets[0]}/category/sm-with-${run}`);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toContain("<lastmod>");
    expect(entries[0]).toContain('hreflang="x-default"');
    for (const market of p.markets) expect(entries[0]).toContain(`/s/${slug}/${market}/category/sm-with-${run}"`);
    expect(xml).not.toContain(`category/sm-empty-${run}`);
    expect(empty).toBeTruthy();
  });

  it("lists a tag the same way, and counts a subcategory's products for its parent category, as the page does", async () => {
    const p = await product();
    const parent = await termId("category", `sm-parent-${run}`);
    const child = await termId("category", `sm-child-${run}`, parent);
    const tag = await termId("tag", `sm-tag-${run}`);
    await attach(child, p.id);
    await attach(tag, p.id);
    const xml = (await seo.storeSitemap(slug))!;
    expect(xml).toContain(`/s/${slug}/${p.markets[0]}/category/sm-parent-${run}</loc>`);
    expect(xml).toContain(`/s/${slug}/${p.markets[0]}/category/sm-child-${run}</loc>`);
    expect(xml).toContain(`/s/${slug}/${p.markets[0]}/tag/sm-tag-${run}</loc>`);
  });

  it("leaves out a category whose only product is a draft, and never lists an old address after a rename or a redirect", async () => {
    const [draft] = await db().execute<Row>(sql`
      select p.id from commerce.products p where p.store_id = ${member.store.id}::uuid and p.status = 'active' order by p.handle offset 1 limit 1
    `);
    const only = await termId("category", `sm-draft-${run}`);
    await attach(only, String(draft.id));
    expect((await seo.storeSitemap(slug))!).toContain(`category/sm-draft-${run}</loc>`);
    await db().execute(sql`update commerce.products set status = 'draft' where id = ${String(draft.id)}::uuid`);
    expect((await seo.storeSitemap(slug))!).not.toContain(`category/sm-draft-${run}</loc>`);
    await db().execute(sql`update commerce.products set status = 'active' where id = ${String(draft.id)}::uuid`);
    // A category renamed twice is listed at its current address only, and a manual redirect's source is in no sitemap.
    await db().execute(sql`update commerce.terms set slug = ${`sm-draft-${run}-b`} where store_id = ${member.store.id}::uuid and slug = ${`sm-draft-${run}`}`);
    await db().execute(sql`update commerce.terms set slug = ${`sm-draft-${run}-c`} where store_id = ${member.store.id}::uuid and slug = ${`sm-draft-${run}-b`}`);
    await db().execute(sql`insert into commerce.redirects (store_id, kind, source, target, origin) values (${member.store.id}::uuid, 'manual', ${`/category/manual-${run}`}, '/om-oss', 'editor')`);
    const xml = (await seo.storeSitemap(slug))!;
    expect(xml).toContain(`category/sm-draft-${run}-c</loc>`);
    expect(xml).not.toContain(`category/sm-draft-${run}</loc>`);
    expect(xml).not.toContain(`category/sm-draft-${run}-b</loc>`);
    expect(xml).not.toContain(`manual-${run}`);
  });

  it("lists a product renamed twice at its current address only, and none of its old addresses (the redirects it left)", async () => {
    const p = await product();
    const [before] = await db().execute<Row>(sql`select handle from commerce.products where id = ${p.id}::uuid`);
    const original = String(before.handle);
    const first = `sm-rename-${run}-b`;
    const second = `sm-rename-${run}-c`;
    await db().execute(sql`update commerce.products set handle = ${first} where id = ${p.id}::uuid`);
    await db().execute(sql`update commerce.products set handle = ${second} where id = ${p.id}::uuid`);
    try {
      const redirected = await db().execute<Row>(sql`select source from commerce.redirects where store_id = ${member.store.id}::uuid and product_id = ${p.id}::uuid`);
      expect(redirected.map((r) => String(r.source)).sort()).toEqual([`/p/${first}`, `/p/${original}`].sort());
      const xml = (await seo.storeSitemap(slug))!;
      expect(xml).toContain(`/p/${second}</loc>`);
      expect(xml).not.toContain(`/p/${first}<`);
      expect(xml).not.toContain(`/p/${first}"`);
      expect(xml).not.toContain(`/p/${original}</loc>`);
    } finally {
      await db().execute(sql`update commerce.products set handle = ${original} where id = ${p.id}::uuid`);
    }
  });

  it("is as before for products, pages and articles, and absent for a hidden store", async () => {
    const xml = (await seo.storeSitemap(slug))!;
    expect(xml).toContain(`/s/${slug}/no/p/`);
    expect(xml).toContain(`/s/${slug}/no/om-oss</loc>`);
    expect(xml).toContain(`/s/${slug}/no/blog/nye-produkter</loc>`);
    await seo.saveStoreSeo(member, settings({ hidden: true }));
    expect(await seo.storeSitemap(slug)).toBeNull();
    await seo.saveStoreSeo(member, settings({ hidden: false }));
  });
});
