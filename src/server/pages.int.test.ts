import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type ContentGridBlock, type PageContent } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";

import type { Account } from "./auth";
import type { PageResult } from "./pages";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const pages = await import("./pages");
const seo = await import("./seo");
const nav = await import("./platform-navigation");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;

/** One full-width row holding the given blocks. */
const oneRow = (blocks: unknown[]) => [
  { id: "row-1", type: "row", layout: "1", columns: [{ id: "column-1", blocks }] },
] as PageContent["rows"];

/** A page as the editor sends it, with one text block. */
const content = (slug: string, overrides: Partial<PageContent> = {}): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug,
  rows: oneRow([
    {
      id: "block-1",
      type: "richText",
      doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: `About ${slug}.` }] }] },
    },
  ]),
  ...overrides,
});

const saved = async (result: PageResult) => {
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
};

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`pages-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.pages where slug like ${`%-${run}`}`);
  await closeDb();
});

describe("saving and publishing", () => {
  it("keeps a new draft off the site until it is published", async () => {
    const slug = `draft-${run}`;
    const id = await saved(await pages.savePage(admin, null, null, content(slug), { publish: false }));
    expect(await pages.findPublishedPage(null, slug)).toBeNull();
    expect((await pages.getPageForEdit(null, id))?.state).toBe("draft");

    await pages.savePage(admin, null, id, content(slug), { publish: true });
    const found = await pages.findPublishedPage(null, slug);
    expect(found && "page" in found && found.page.content.title).toBe(`Page ${slug}`);
    expect((await pages.getPageForEdit(null, id))?.state).toBe("published");
  });

  it("keeps what visitors see while the draft changes, until published again", async () => {
    const slug = `live-${run}`;
    const id = await saved(await pages.savePage(admin, null, null, content(slug), { publish: true }));
    await pages.savePage(admin, null, id, content(slug, { title: "New title" }), { publish: false });

    const found = await pages.findPublishedPage(null, slug);
    expect(found && "page" in found && found.page.content.title).toBe(`Page ${slug}`);
    const page = await pages.getPageForEdit(null, id);
    expect(page?.state).toBe("changed");
    expect(page?.draft.title).toBe("New title");
  });

  it("moves a live page's address only when published, and redirects the old one", async () => {
    const before = `before-${run}`;
    const after = `after-${run}`;
    const id = await saved(await pages.savePage(admin, null, null, content(before), { publish: true }));

    await pages.savePage(admin, null, id, content(after), { publish: false });
    expect(await pages.findPublishedPage(null, before)).toMatchObject({ page: { id } });
    expect(await pages.findPublishedPage(null, after)).toBeNull();

    await pages.savePage(admin, null, id, content(after), { publish: true });
    expect(await pages.findPublishedPage(null, after)).toMatchObject({ page: { id } });
    expect(await pages.findPublishedPage(null, before)).toEqual({ redirect: after });
  });

  it("gives a draft's new address to it at once while it is not published", async () => {
    const id = await saved(await pages.savePage(admin, null, null, content(`first-${run}`), { publish: false }));
    await pages.savePage(admin, null, id, content(`second-${run}`), { publish: false });
    expect((await pages.getPageForEdit(null, id))?.slug).toBe(`second-${run}`);
    // Nobody saw the first address, so it does not redirect.
    const [redirect] = await db().execute<Row>(sql`select 1 from commerce.page_redirects where slug = ${`first-${run}`}`);
    expect(redirect).toBeUndefined();
  });

  it("refuses an address another page has, and one Kaizen uses", async () => {
    const slug = `taken-${run}`;
    await saved(await pages.savePage(admin, null, null, content(slug), { publish: false }));
    expect(await pages.savePage(admin, null, null, content(slug), { publish: false })).toEqual({
      ok: false,
      problems: [`Another page already has the address /${slug}. Choose another.`],
    });
    const reserved = await pages.savePage(admin, null, null, content("sign-up"), { publish: false });
    expect(reserved.ok).toBe(false);
  });

  it("refuses unsafe content", async () => {
    const result = await pages.savePage(
      admin,
      null,
      null,
      {
        ...content(`unsafe-${run}`),
        rows: oneRow([
          {
            id: "b",
            type: "richText",
            doc: {
              type: "doc",
              content: [
                {
                  type: "paragraph",
                  content: [{ type: "text", text: "x", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] }],
                },
              ],
            },
          },
        ]),
      },
      { publish: true },
    );
    expect(result.ok).toBe(false);
  });

  it("takes a page off the site and deletes it", async () => {
    const slug = `gone-${run}`;
    const id = await saved(await pages.savePage(admin, null, null, content(slug), { publish: true }));
    expect(await pages.unpublishPage(admin, null, id)).toBe(true);
    expect(await pages.findPublishedPage(null, slug)).toBeNull();
    expect((await pages.getPageForEdit(null, id))?.state).toBe("draft");

    expect(await pages.deletePage(admin, null, id)).toBe(true);
    expect(await pages.getPageForEdit(null, id)).toBeNull();
    const [log] = await db().execute<Row>(sql`
      select action from commerce.audit_log where account_id = ${admin.id}::uuid order by id desc limit 1
    `);
    expect(log.action).toBe("platform.page_deleted");
  });
});

describe("search engines, AI assistants and menus", () => {
  it("lists pages in the sitemap and llms.txt as each allows, and closes them to AI crawlers when asked", async () => {
    const open = `open-${run}`;
    const hidden = `hidden-${run}`;
    await pages.savePage(admin, null, null, content(open), { publish: true });
    await pages.savePage(admin, null, null, content(hidden, { searchEngines: false, aiAssistants: false }), { publish: true });

    const sitemap = await seo.platformSitemap();
    expect(sitemap).toContain(`/${open}</loc>`);
    expect(sitemap).not.toContain(`/${hidden}<`);

    const llms = await seo.platformLlms();
    expect(llms).toContain(`[Page ${open}](`);
    expect(llms).toContain(`About ${open}.`);
    expect(llms).not.toContain(hidden);

    const robots = await seo.siteRobots();
    expect(robots).toMatch(new RegExp(`User-agent: GPTBot[^]*?Disallow: /${hidden}\\$`));
    expect(robots).toMatch(new RegExp(`User-agent: Claude-User[^]*?Disallow: /${hidden}\\$`));
    expect(robots).not.toContain(`Disallow: /${open}`);
  });

  it("links menus to pages by id, so a link follows its page and waits until it is published", async () => {
    const id = await saved(await pages.savePage(admin, null, null, content(`menu-${run}`), { publish: false }));
    const input = {
      logo: null,
      header: [{ label: {}, link: { kind: "page", pageId: id } }],
      footer: [{ label: { en: "Docs" }, link: { kind: "url", url: "https://example.com" } }],
      business: { legalName: "Kaizen AS", organisationNumber: "123 456 789", postalAddress: "Oslo", contactEmail: "hei@example.com" },
    };
    const original = await nav.getPlatformNavigationForEdit();
    try {
      expect(await nav.savePlatformNavigation(admin, input)).toEqual({ ok: true });
      let chrome = await nav.getPlatformChrome();
      expect(chrome.business.legalName).toBe("Kaizen AS");
      expect(chrome.pages.has(id)).toBe(false);

      await pages.savePage(admin, null, id, content(`menu-moved-${run}`), { publish: true });
      chrome = await nav.getPlatformChrome();
      expect(chrome.pages.get(id)).toMatchObject({ slug: `menu-moved-${run}`, title: `Page menu-moved-${run}` });

      expect(
        await nav.savePlatformNavigation(admin, {
          ...input,
          header: [{ label: {}, link: { kind: "page", pageId: "00000000-0000-4000-8000-000000000000" } }],
        }),
      ).toEqual({ ok: false, problems: ["A menu links to a page that no longer exists. Choose another."] });
    } finally {
      await nav.savePlatformNavigation(admin, { ...original.navigation, business: original.business });
    }
  });
});

describe("a store's pages (D53)", () => {
  let storeId: string;
  const savedParts = import("./saved-parts");

  beforeAll(async () => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.stores (slug, name) values (${`pages-${run}`}, 'Pages store') returning id
    `);
    storeId = String(row.id);
  });

  afterAll(async () => {
    await db().execute(sql`delete from commerce.pages where store_id = ${storeId}::uuid`);
    await db().execute(sql`delete from commerce.saved_parts where store_id = ${storeId}::uuid`);
  });

  it("keeps a store's pages its own, with its own addresses", async () => {
    const slug = `help-${run}`;
    const own = await saved(await pages.savePage(admin, storeId, null, content(slug), { publish: true }));
    // Kaizen can use the same address; neither sees the other's page.
    const kaizen = await saved(await pages.savePage(admin, null, null, content(slug), { publish: true }));
    expect((await pages.listPages(storeId)).map((p) => p.id)).toEqual([own]);
    expect((await pages.listPages(null)).map((p) => p.id)).not.toContain(own);
    expect(await pages.getPageForEdit(null, own)).toBeNull();
    expect(await pages.findPublishedPage(storeId, slug)).toMatchObject({ page: { id: own } });
    expect(await pages.findPublishedPage(null, slug)).toMatchObject({ page: { id: kaizen } });
    expect(await pages.unpublishPage(admin, null, own)).toBe(false);
    expect(await pages.deletePage(admin, null, own)).toBe(false);
  });

  it("refuses the store's own routes as addresses, but not Kaizen's", async () => {
    expect(await pages.savePage(admin, storeId, null, content("cart"), { publish: false })).toEqual({
      ok: false,
      problems: ["The address cart is used by the store itself. Choose another."],
    });
    expect((await pages.savePage(admin, storeId, null, content(`sign-up-${run}`), { publish: false })).ok).toBe(true);
    expect((await pages.savePage(admin, storeId, null, content("support"), { publish: false })).ok).toBe(true);
  });

  it("shows only the store's own products in its grids", async () => {
    const grid = (source: Record<string, unknown>) =>
      content(`grid-${run}`, {
        rows: oneRow([{ ...newBlock("contentGrid", () => "g1"), source }]),
      });
    expect(await pages.savePage(admin, storeId, null, grid({ type: "products", storeId: "00000000-0000-4000-8000-000000000000" }), { publish: false })).toEqual({
      ok: false,
      problems: ["A content grid on a store's page shows that store's own products."],
    });
    expect((await pages.savePage(admin, storeId, null, grid({ type: "products" }), { publish: false })).ok).toBe(true);
    // Kaizen's pages name the store and market.
    expect(await pages.savePage(admin, null, null, grid({ type: "products" }), { publish: false })).toEqual({
      ok: false,
      problems: ["Choose the store and market for each content grid of products."],
    });
  });

  it("keeps saved parts apart", async () => {
    const parts = await savedParts;
    const block = { kind: "block", name: `Own ${run}`, content: newBlock("heading", () => "h1") };
    const result = await parts.createSavedPart(admin, storeId, block);
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect((await parts.listSavedParts(storeId)).map((p) => p.id)).toEqual([result.id]);
    expect((await parts.listSavedParts(null)).map((p) => p.id)).not.toContain(result.id);
    expect(await parts.updateSavedPart(admin, null, result.id, { ...block, name: "Taken" })).toMatchObject({ ok: false });
  });
});

describe("a store's front page and menu links (D54)", () => {
  let storeId: string;
  let otherId: string;
  const slug = `front-${run}`;
  const stores = import("./stores");
  const navigation = import("./navigation");

  beforeAll(async () => {
    const insert = async (name: string) => {
      const [row] = await db().execute<Row>(sql`
        insert into commerce.stores (slug, name) values (${`${name}-${run}`}, ${name}) returning id
      `);
      return String(row.id);
    };
    storeId = await insert("front");
    otherId = await insert("front-other");
  });

  afterAll(async () => {
    await db().execute(sql`delete from commerce.pages where store_id in (${storeId}::uuid, ${otherId}::uuid)`);
  });

  it("shows only one of the store's own published pages as its front page", async () => {
    const draft = await saved(await pages.savePage(admin, storeId, null, content(`draft-${run}`), { publish: false }));
    const theirs = await saved(await pages.savePage(admin, otherId, null, content(slug), { publish: true }));
    const own = await saved(await pages.savePage(admin, storeId, null, content(slug), { publish: true }));
    expect(await pages.setFrontPage(admin, storeId, draft)).toEqual({
      ok: false,
      problems: ["Publish the page before making it the front page."],
    });
    expect(await pages.setFrontPage(admin, storeId, theirs)).toEqual({ ok: false, problems: ["That page no longer exists."] });
    expect(await pages.setFrontPage(admin, storeId, own)).toEqual({ ok: true });
    expect((await (await stores).getStore(`front-${run}`))?.frontPageId).toBe(own);
    // Deleting it gives the store its product list back.
    await pages.deletePage(admin, storeId, own);
    expect((await (await stores).getStore(`front-${run}`))?.frontPageId).toBeNull();
  });

  it("names pages for menus under their addresses now and before, and checks menu links", async () => {
    const id = await saved(await pages.savePage(admin, storeId, null, content(`about-${run}`), { publish: true }));
    await saved(await pages.savePage(admin, storeId, id, content(`about-us-${run}`, { title: "About us" }), { publish: true }));
    const names = new Map(await pages.publishedPageNames(storeId));
    expect(names.get(`about-${run}`)).toEqual({ slug: `about-us-${run}`, title: "About us" });
    expect(names.get(`about-us-${run}`)).toEqual({ slug: `about-us-${run}`, title: "About us" });
    expect(new Map(await pages.publishedPageNames(otherId)).has(`about-${run}`)).toBe(false);

    const store = (await (await stores).getStore(`front-${run}`))!;
    const member = { account: admin, store, role: "owner" as const };
    const menu = (pageSlug: string) => ({ logo: null, header: [{ label: {}, link: { kind: "page", slug: pageSlug } }], footer: [] });
    expect(await (await navigation).saveNavigation(member, menu(`about-${run}`))).toEqual({ ok: true });
    // Another store's page is not one of this store's.
    expect(await (await navigation).saveNavigation(member, menu(slug))).toEqual({
      ok: false,
      problems: ["A menu links to a page that no longer exists. Choose another."],
    });
  });
});

describe("a store's page in its languages (D55)", () => {
  let storeId: string;
  const grid = import("./content-grid");

  beforeAll(async () => {
    const [row] = await db().execute<Row>(sql`
      insert into commerce.stores (slug, name, country) values (${`lang-${run}`}, 'Languages', 'SE') returning id
    `);
    storeId = String(row.id);
    await db().execute(sql`
      insert into commerce.markets (store_id, code, currency, default_locale, locales, active)
      select ${storeId}::uuid, code, currency, default_locale, locales, true
      from commerce.countries where code in ('NO', 'SE')
    `);
  });

  afterAll(async () => {
    await db().execute(sql`delete from commerce.pages where store_id = ${storeId}::uuid`);
  });

  it("keeps texts in the store's other languages only, its own country's being the main one", async () => {
    expect((await pages.ownerLanguages(storeId)).map((l) => l.locale)).toEqual(["sv-SE", "nb-NO"]);
    expect((await pages.ownerLanguages(null)).map((l) => l.locale)).toEqual(["en"]);
    const input = content(`lang-${run}`, {
      title: "Om oss",
      translations: {
        "nb-NO": { title: "Hvem vi er", "block.block-1.doc": { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hei." }] }] } },
        // The main language, and one the store does not sell in, are not kept.
        "sv-SE": { title: "Vilka vi är" },
        "fi-FI": { title: "Keitä olemme" },
      },
    });
    const id = await saved(await pages.savePage(admin, storeId, null, input, { publish: true }));
    const page = await pages.getPageForEdit(storeId, id);
    expect(Object.keys(page?.draft.translations ?? {})).toEqual(["nb-NO"]);
    expect(page?.draft.translations?.["nb-NO"].title).toBe("Hvem vi er");

    // Menus and grids read the page in the market's language, else the main one.
    expect(new Map(await pages.publishedPageNames(storeId, "nb-NO")).get(`lang-${run}`)?.title).toBe("Hvem vi er");
    expect(new Map(await pages.publishedPageNames(storeId, "sv-SE")).get(`lang-${run}`)?.title).toBe("Om oss");
    const block = { ...newBlock("contentGrid", () => "g"), source: { type: "pages" } } as ContentGridBlock;
    const { gridData } = await grid;
    expect((await gridData(block, { pageId: null, owner: storeId, market: "NO" })).items.map((i) => i.title)).toEqual(["Hvem vi er"]);
    expect((await gridData(block, { pageId: null, owner: storeId, market: "SE" })).items.map((i) => i.title)).toEqual(["Om oss"]);

    // Kaizen's pages are in English only.
    const kaizen = await saved(await pages.savePage(admin, null, null, { ...input, slug: `lang-kaizen-${run}` }, { publish: false }));
    expect((await pages.getPageForEdit(null, kaizen))?.draft.translations).toBeUndefined();
  });
});
