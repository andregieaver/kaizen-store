import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestDatabase } from "./testing";

/**
 * Kaizena Flow's site copied into its own store (D469, `docs/platform-parity-plan.md` step 3), against real Postgres (PGlite) with every
 * migration applied: pages, header, footer, menus, saved parts, text styles, categories and the site's look land in Kaizena Flow's store
 * with every id inside them the copies'; a second run lands on the same copies and brings changes, but never over a setting changed in the
 * store (D474); a copy whose source is gone goes; the platform's own site is never changed.
 */

let db: PGlite;
let house: string;
const ids: Record<string, string> = {};

beforeAll(async () => {
  db = await createTestDatabase();
  house = (await one<{ id: string }>("select commerce.house_store() as id")).id;
  const page = async (type: string, slug: string, content: unknown) =>
    (
      await one<{ id: string }>(
        "insert into commerce.pages (type, slug, draft, published, published_at) values ($1, $2, $3::jsonb, $3::jsonb, now()) returning id",
        [type, slug, JSON.stringify(content)],
      )
    ).id;
  ids.term = (await one<{ id: string }>("insert into commerce.terms (content_type, kind, name, slug) values ('article', 'category', 'News', 'news') returning id")).id;
  ids.style = (await one<{ id: string }>("insert into commerce.text_styles (slug, name, kind, settings, css) values ('lead', 'Lead', 'glow', '{}', '') returning id")).id;
  ids.about = await page("page", "about-us", { title: "About", rows: [] });
  ids.menu = (
    await one<{ id: string }>("insert into commerce.menus (name, items) values ('Main', $1::jsonb) returning id", [
      JSON.stringify([{ id: "x", label: "About", link: { kind: "page", pageId: ids.about } }]),
    ])
  ).id;
  ids.part = (
    await one<{ id: string }>("insert into commerce.saved_parts (kind, name, content, sharing) values ('block', 'Hero', $1::jsonb, 'marketplace') returning id", [
      JSON.stringify({ type: "heading", text: "Hello" }),
    ])
  ).id;
  ids.home = await page("page", "home", { title: "Home", menuId: ids.menu, partId: ids.part, termId: ids.term, styleId: ids.style, aboutId: ids.about });
  ids.header = await page("header", "custom-header", { title: "Header", menuId: ids.menu });
  ids.footer = await page("footer", "custom-footer", { title: "Footer" });
  ids.gone = await page("page", "old-page", { title: "Old" });
  await db.query("insert into commerce.page_redirects (type, slug, page_id) values ('page', 'about', $1)", [ids.about]);
  await db.query("update commerce.platform_settings set header_id = $1, footer_id = $2, header_menu_id = $3, custom_css = '.x{}', theme = '{\"base\":\"x\"}'::jsonb", [
    ids.header,
    ids.footer,
    ids.menu,
  ]);
  await db.query("insert into commerce.platform_page_roles (role, page_id) values ('front', $1) on conflict (role) do update set page_id = excluded.page_id", [ids.home]);
});

afterAll(async () => {
  await db.close();
});

async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const { rows } = await db.query<T>(sql, params);
  return rows[0];
}

const copyOf = async (source: string) => (await one<{ copy_id: string } | undefined>("select copy_id from commerce.house_site_copies where source_id = $1", [source]))?.copy_id;

describe("Kaizena Flow's site copied into its own store (D469)", () => {
  it("copies the site, with every id inside it the copies', and the look onto the store", async () => {
    const counts = await one<{ counts: Record<string, number> }>("select commerce.copy_platform_site(null) as counts");
    expect(counts.counts).toMatchObject({ page: 5, menu: 1, saved_part: 1, text_style: 1, term: 1 });

    const home = await one<{ published: Record<string, string>; slug: string }>("select published, slug from commerce.pages where id = $1 and store_id = $2", [
      await copyOf(ids.home),
      house,
    ]);
    expect(home.slug).toBe("home");
    expect(home.published.menuId).toBe(await copyOf(ids.menu));
    expect(home.published.partId).toBe(await copyOf(ids.part));
    expect(home.published.termId).toBe(await copyOf(ids.term));
    expect(home.published.styleId).toBe(await copyOf(ids.style));
    expect(home.published.aboutId).toBe(await copyOf(ids.about));

    const menu = await one<{ items: { link: { pageId: string } }[] }>("select items from commerce.menus where id = $1", [await copyOf(ids.menu)]);
    expect(menu.items[0].link.pageId).toBe(await copyOf(ids.about));
    expect((await one<{ sharing: string }>("select sharing from commerce.saved_parts where id = $1", [await copyOf(ids.part)])).sharing).toBe("private");

    const store = await one<Record<string, unknown>>("select header_id, footer_id, header_menu_id, front_page_id, custom_css, theme from commerce.stores where id = $1", [house]);
    expect(store).toMatchObject({
      header_id: await copyOf(ids.header),
      footer_id: await copyOf(ids.footer),
      header_menu_id: await copyOf(ids.menu),
      front_page_id: await copyOf(ids.home),
      custom_css: ".x{}",
      theme: { base: "x" },
    });
    // The old address of a page leads to its copy.
    expect((await one<{ page_id: string }>("select page_id from commerce.page_redirects where store_id = $1 and slug = 'about'", [house])).page_id).toBe(
      await copyOf(ids.about),
    );
  });

  it("lands on the same copies the second time, brings changes and removes the copy of what is gone", async () => {
    const before = await copyOf(ids.home);
    const goneCopy = await copyOf(ids.gone);
    await db.query("update commerce.pages set published = $2::jsonb where id = $1", [ids.home, JSON.stringify({ title: "Home, new" })]);
    await db.query("delete from commerce.pages where id = $1", [ids.gone]);
    await db.query("select commerce.copy_platform_site(null)");
    expect(await copyOf(ids.home)).toBe(before);
    expect((await one<{ published: { title: string } }>("select published from commerce.pages where id = $1", [before])).published.title).toBe("Home, new");
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.pages where id = $1", [goneCopy])).n).toBe(0);
    expect(await copyOf(ids.gone)).toBeUndefined();
  });

  it("keeps a setting changed in the store, and brings the live site's where the store has not changed it (D474)", async () => {
    // The store's own Settings give it an SEO title; the live site then changes its CSS and its SEO.
    await db.query(`update commerce.stores set seo = '{"title":{"en-GB":"The store own"}}'::jsonb where id = $1`, [house]);
    await db.query(`update commerce.platform_settings set custom_css = '.y{}', seo = '{"title":{"en":"The live site"}}'::jsonb`);
    const counts = await one<{ counts: Record<string, number> }>("select commerce.copy_platform_site(null) as counts");
    const store = await one<{ seo: unknown; custom_css: string; header_id: string }>("select seo, custom_css, header_id from commerce.stores where id = $1", [house]);
    expect(store.seo).toEqual({ title: { "en-GB": "The store own" } });
    expect(store.custom_css).toBe(".y{}");
    expect(store.header_id).toBe(await copyOf(ids.header));
    expect(counts.counts.settings_kept).toBe(1);
    // Kept for good: a later change of the live site's SEO does not reach it either.
    await db.query(`update commerce.platform_settings set seo = '{"title":{"en":"Again"}}'::jsonb`);
    await db.query("select commerce.copy_platform_site(null)");
    expect((await one<{ seo: unknown }>("select seo from commerce.stores where id = $1", [house])).seo).toEqual({ title: { "en-GB": "The store own" } });
    // The settings' row is not a page: the admin's count leaves it out.
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.house_site_copies where kind = 'settings' and copy_id = $1", [house])).n).toBe(1);
  });

  it("leaves every setting of a store copied before D474 as it is, until a copy has noted the live site's", async () => {
    await db.query("delete from commerce.house_site_copies where kind = 'settings'");
    await db.query(`update commerce.platform_settings set custom_css = '.z{}'`);
    const counts = await one<{ counts: Record<string, number> }>("select commerce.copy_platform_site(null) as counts");
    expect((await one<{ custom_css: string }>("select custom_css from commerce.stores where id = $1", [house])).custom_css).toBe(".y{}");
    expect(counts.counts.settings_kept).toBe(2);
    // Noted now: a setting both had alike (the look) follows the live site's next change; the CSS that differed stays the store's.
    await db.query(`update commerce.platform_settings set custom_css = '.w{}', theme = '{"base":"v"}'::jsonb`);
    await db.query("select commerce.copy_platform_site(null)");
    expect(await one("select custom_css, theme from commerce.stores where id = $1", [house])).toEqual({ custom_css: ".y{}", theme: { base: "v" } });
  });

  it("never changes the platform's own site", async () => {
    expect((await one<{ n: number }>("select count(*)::int as n from commerce.pages where store_id is null")).n).toBe(4);
    expect((await one<{ store_id: string | null }>("select store_id from commerce.menus where id = $1", [ids.menu])).store_id).toBeNull();
    expect((await one<{ header_id: string }>("select header_id from commerce.platform_settings")).header_id).toBe(ids.header);
  });

  it("keeps the map in Kaizena Flow's own store only", async () => {
    const other = (await one<{ id: string }>("insert into commerce.stores (slug, name) values ('site-elsewhere', 'Elsewhere') returning id")).id;
    await expect(db.query("insert into commerce.house_site_copies (store_id, source_id, copy_id, kind) values ($1, gen_random_uuid(), gen_random_uuid(), 'page')", [other])).rejects.toThrow(
      /house_site_copies\.house/,
    );
  });
});
