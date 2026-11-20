import { beforeEach, describe, expect, it, vi } from "vitest";

import { blockWords, locateBlock } from "@/lib/inline-edit";
import { newPageContent, type PageContent } from "@/lib/page-content";
import { parseStoreTheme } from "@/lib/theme-schema";

/**
 * The eight places that publish a page's body (bloat review step 2.14, `src/server/page-refresh.ts`): each refreshes the page's own tag,
 * and the owner's pages tag only when the publish reached the site. Places 6 and 7 (a header's or footer's publish chosen for the site,
 * a page chosen for a place) stay site-wide.
 */

vi.mock("server-only", () => ({}));
const updateTag = vi.fn();
const revalidateTag = vi.fn();
vi.mock("next/cache", () => ({ updateTag, revalidateTag, cacheTag: vi.fn(), cacheLife: vi.fn(), refresh: vi.fn() }));
const refreshTagNow = vi.fn();
vi.mock("./refresh", () => ({ refreshTagNow, refreshTag: vi.fn() }));

/** The database as these places meet it: every statement answers the one row below. */
let ROW: Record<string, unknown> = {};
const fakeDb = {
  execute: vi.fn(async () => [ROW]),
  transaction: vi.fn(async (run: (tx: unknown) => unknown) => run(fakeDb)),
};
vi.mock("@/db/client", () => ({ db: () => fakeDb, readDb: () => fakeDb, closeDb: vi.fn() }));

const savePage = vi.fn();
const getPageForEdit = vi.fn();
const setFrontPage = vi.fn();
vi.mock("./pages", async (importOriginal) => ({ ...(await importOriginal<typeof import("./pages")>()), savePage, getPageForEdit, setFrontPage }));
const MEMBER = { store: { id: "store-1", slug: "shop" }, account: { id: "acct-1" }, role: "owner" };
vi.mock("./permissions", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./permissions")>()),
  checkPageTypeAccess: vi.fn(async () => MEMBER),
  checkPassPageTypeAccess: vi.fn(async () => null),
  memberCan: () => true,
}));
vi.mock("./auth", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./auth")>()),
  requirePlatform: vi.fn(async () => ({ id: "admin-1" })),
  audit: vi.fn(),
  getAccount: vi.fn(async () => ({ id: "admin-1", platformAdmin: true })),
}));
vi.mock("./experiment-admin", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./experiment-admin")>()),
  runningTestOf: vi.fn(async () => null),
  testOfVersionPage: vi.fn(async () => null),
}));
vi.mock("./page-versions", () => ({ keepVersion: vi.fn() }));
vi.mock("./audit", () => ({ auditChange: vi.fn() }));
const chooseSiteLayout = vi.fn(async () => ({ ok: true }));
vi.mock("./site-layouts", async (importOriginal) => ({ ...(await importOriginal<typeof import("./site-layouts")>()), chooseSiteLayout }));

const storeActions = await import("@/app/admin/(gated)/[store]/pages/actions");
const platformActions = await import("@/app/admin/(gated)/platform/pages/actions");
const textEdit = await import("./page-text-edit");
const cssEdit = await import("./page-css-edit");
const siteTools = await import("./site-tools");
const { publishedTags } = await import("./page-refresh");

const doc = (text: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text }] }] });
const PAGE: PageContent = {
  ...newPageContent(),
  title: "About",
  slug: "about",
  rows: [{ id: "r1", type: "row", layout: "1", columns: [{ id: "c1", blocks: [{ id: "b1", type: "richText", doc: doc("We make mugs.") }] }] }],
};
const ID = "00000000-0000-4000-8000-000000000001";

const refreshed = () => [...updateTag.mock.calls, ...revalidateTag.mock.calls, ...refreshTagNow.mock.calls].map((call) => String(call[0]));

beforeEach(() => {
  for (const f of [updateTag, revalidateTag, refreshTagNow, savePage, getPageForEdit, setFrontPage]) f.mockReset();
  getPageForEdit.mockResolvedValue({ id: ID, state: "published", draft: PAGE, published: true });
  ROW = { id: ID, store_id: "store-1", type: "page", slug: "about", draft: PAGE, published: PAGE, custom_css: "" };
});

describe.each([
  ["a store's page action (place 1)", "pages:store-1", () => storeActions.saveStorePageAction("shop", "page", ID, JSON.stringify(PAGE), true)],
  ["Kaizena Flow's page action (place 2)", "platform-pages", () => platformActions.savePageAction("page", ID, JSON.stringify(PAGE), true)],
])("%s", (_name, siteTag, publish) => {
  it("refreshes only the page for a publish that reached only the page", async () => {
    savePage.mockResolvedValue({ ok: true, id: ID, scope: "page" });
    await publish();
    expect(refreshed()).toContain(`page:${ID}`);
    expect(refreshed()).not.toContain(siteTag);
  });

  it("refreshes the page and the site for a publish that reached the site", async () => {
    savePage.mockResolvedValue({ ok: true, id: ID, scope: "site" });
    await publish();
    expect(refreshed()).toEqual(expect.arrayContaining([`page:${ID}`, siteTag]));
  });
});

describe("a block's words edited on the live page (place 3, page-text-edit.ts)", () => {
  const edit = (content: PageContent, text: string) =>
    textEdit.applyPageText({
      account: { id: "acct-1", email: "a@example.com", name: "A", platformAdmin: false },
      owner: "store-1",
      page: ID,
      block: "b1",
      rev: textEdit.revisionOf(blockWords(locateBlock(content.rows, "b1")!.block)),
      edit: { kind: "richText", doc: doc(text) },
    });

  it("refreshes only the page when the words are not what other pages show (the page has its own excerpt)", async () => {
    const own = { ...PAGE, excerpt: "Who we are." };
    ROW = { ...ROW, draft: own, published: own };
    expect(await edit(own, "We make bowls.")).toMatchObject({ ok: true });
    expect(refreshed()).toEqual([`page:${ID}`]);
  });

  it("refreshes the site too when the words are its excerpt", async () => {
    expect(await edit(PAGE, "We make bowls.")).toMatchObject({ ok: true });
    expect(refreshed()).toEqual([`page:${ID}`, "pages:store-1"]);
  });
});

describe("a page's own CSS (place 4, page-css-edit.ts)", () => {
  it("refreshes only the page", async () => {
    // The revision of a page and a site with no CSS of their own, as `cssRevision()` makes it.
    const rev = textEdit.revisionOf("\u0000");
    expect(await cssEdit.savePageCss({ store: "shop", page: ID, rev, pageCss: ".a { color: red; }", siteCss: "" })).toMatchObject({ ok: true });
    expect(refreshed()).toEqual([`page:${ID}`]);
  });
});

describe("the AI manager's site tools (places 5, 6 and 7, site-tools.ts)", () => {
  const ctx = () => ({
    account: { id: "acct-1", email: "a@example.com", name: "A", platformAdmin: false },
    store: { id: "store-1", slug: "shop", theme: parseStoreTheme(null), customCss: "", localization: { locales: ["nb-NO"] }, markets: [] } as never,
    invalidate: (tag: string) => updateTag(tag),
  });

  it("publish_page refreshes only the page for a publish that reached only the page (place 5)", async () => {
    savePage.mockResolvedValue({ ok: true, id: ID, scope: "page" });
    await siteTools.publishPageTool(ctx(), { page: ID, type: "page" });
    expect(refreshed()).toEqual([`page:${ID}`]);
  });

  it("publish_page refreshes the page and the site for a publish that reached the site (place 5)", async () => {
    savePage.mockResolvedValue({ ok: true, id: ID, scope: "site" });
    await siteTools.publishPageTool(ctx(), { page: ID, type: "page" });
    expect(refreshed()).toEqual([`page:${ID}`, "pages:store-1"]);
  });

  it("use_header_footer stays site-wide, whatever the publish's reach (place 6)", async () => {
    savePage.mockResolvedValue({ ok: true, id: ID, scope: "page" });
    ROW = { ...ROW, type: "header", title: "Header" };
    getPageForEdit.mockResolvedValue({ id: ID, state: "published", draft: { ...PAGE, rows: [] }, published: true });
    await siteTools.chooseHeaderFooterTool(ctx(), { kind: "header", page: ID });
    expect(refreshed()).toContain("pages:store-1");
  });

  it("set_page_place stays site-wide (place 7)", async () => {
    setFrontPage.mockResolvedValue({ ok: true });
    await siteTools.setPagePlaceTool(ctx(), { place: "front", page: ID });
    expect(refreshed()).toContain("pages:store-1");
  });
});

describe("the schedule runner (place 8, the dispatcher's publishedTags())", () => {
  it("refreshes only the page for a scheduled publish that reached only the page, and the site for one that reached it", () => {
    expect(publishedTags({ pages: [{ store: "store-1", id: "p1", scope: "page" }], stores: [] })).toEqual(["page:p1"]);
    expect(publishedTags({ pages: [{ store: "store-1", id: "p1", scope: "site" }], stores: ["store-1"] })).toEqual(["page:p1", "pages:store-1"]);
  });
});
