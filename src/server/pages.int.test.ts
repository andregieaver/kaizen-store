import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type PageContent } from "@/lib/page-content";

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
    const id = await saved(await pages.savePage(admin, null, content(slug), { publish: false }));
    expect(await pages.findPublishedPage(slug)).toBeNull();
    expect((await pages.getPageForEdit(id))?.state).toBe("draft");

    await pages.savePage(admin, id, content(slug), { publish: true });
    const found = await pages.findPublishedPage(slug);
    expect(found && "page" in found && found.page.content.title).toBe(`Page ${slug}`);
    expect((await pages.getPageForEdit(id))?.state).toBe("published");
  });

  it("keeps what visitors see while the draft changes, until published again", async () => {
    const slug = `live-${run}`;
    const id = await saved(await pages.savePage(admin, null, content(slug), { publish: true }));
    await pages.savePage(admin, id, content(slug, { title: "New title" }), { publish: false });

    const found = await pages.findPublishedPage(slug);
    expect(found && "page" in found && found.page.content.title).toBe(`Page ${slug}`);
    const page = await pages.getPageForEdit(id);
    expect(page?.state).toBe("changed");
    expect(page?.draft.title).toBe("New title");
  });

  it("moves a live page's address only when published, and redirects the old one", async () => {
    const before = `before-${run}`;
    const after = `after-${run}`;
    const id = await saved(await pages.savePage(admin, null, content(before), { publish: true }));

    await pages.savePage(admin, id, content(after), { publish: false });
    expect(await pages.findPublishedPage(before)).toMatchObject({ page: { id } });
    expect(await pages.findPublishedPage(after)).toBeNull();

    await pages.savePage(admin, id, content(after), { publish: true });
    expect(await pages.findPublishedPage(after)).toMatchObject({ page: { id } });
    expect(await pages.findPublishedPage(before)).toEqual({ redirect: after });
  });

  it("gives a draft's new address to it at once while it is not published", async () => {
    const id = await saved(await pages.savePage(admin, null, content(`first-${run}`), { publish: false }));
    await pages.savePage(admin, id, content(`second-${run}`), { publish: false });
    expect((await pages.getPageForEdit(id))?.slug).toBe(`second-${run}`);
    // Nobody saw the first address, so it does not redirect.
    const [redirect] = await db().execute<Row>(sql`select 1 from commerce.page_redirects where slug = ${`first-${run}`}`);
    expect(redirect).toBeUndefined();
  });

  it("refuses an address another page has, and one Kaizen uses", async () => {
    const slug = `taken-${run}`;
    await saved(await pages.savePage(admin, null, content(slug), { publish: false }));
    expect(await pages.savePage(admin, null, content(slug), { publish: false })).toEqual({
      ok: false,
      problems: [`Another page already has the address /${slug}. Choose another.`],
    });
    const reserved = await pages.savePage(admin, null, content("sign-up"), { publish: false });
    expect(reserved.ok).toBe(false);
  });

  it("refuses unsafe content", async () => {
    const result = await pages.savePage(
      admin,
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
    const id = await saved(await pages.savePage(admin, null, content(slug), { publish: true }));
    expect(await pages.unpublishPage(admin, id)).toBe(true);
    expect(await pages.findPublishedPage(slug)).toBeNull();
    expect((await pages.getPageForEdit(id))?.state).toBe("draft");

    expect(await pages.deletePage(admin, id)).toBe(true);
    expect(await pages.getPageForEdit(id)).toBeNull();
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
    await pages.savePage(admin, null, content(open), { publish: true });
    await pages.savePage(admin, null, content(hidden, { searchEngines: false, aiAssistants: false }), { publish: true });

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
    const id = await saved(await pages.savePage(admin, null, content(`menu-${run}`), { publish: false }));
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

      await pages.savePage(admin, id, content(`menu-moved-${run}`), { publish: true });
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
