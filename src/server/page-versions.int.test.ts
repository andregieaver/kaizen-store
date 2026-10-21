import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, parsePageContent, type PageContent } from "@/lib/page-content";
import { VERSIONS_KEPT } from "@/lib/page-versions";

import type { Account } from "./auth";

// Who is asking is set by each test; everything else of these modules is real.
const asked = vi.hoisted(() => ({ account: null as unknown }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("./auth", async (original) => ({ ...(await original<typeof import("./auth")>()), getAccount: async () => asked.account }));

const pages = await import("./pages");
const versions = await import("./page-versions");
const textEdit = await import("./page-text-edit");
const cssEdit = await import("./page-css-edit");

/**
 * A page's versions (D305) and its CSS changed on the live site (D306): each save, publish and change on the site is kept once, a page
 * keeps its newest fifty, a version is read only as its own owner's page's and never changed, and the live CSS goes where the words do.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let admin: Account;

const content = (slug: string, title = `Page ${slug}`, css?: string): PageContent => ({
  ...newPageContent(),
  title,
  slug,
  ...(css ? { css } : {}),
  rows: [{ id: "row-1", type: "row", layout: "1", columns: [{ id: "column-1", blocks: [{ id: "heading-1", type: "heading", text: "Welcome", level: 2 }] }] }],
});
const save = async (id: string | null, body: PageContent, publish: boolean) => {
  const result = await pages.savePage(admin, null, id, body, { publish });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
};
const kinds = async (id: string) => (await versions.listVersions(null, id, "page")).map((v) => v.kind);

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`versions-${run}@example.com`}, 'Vera Admin', true)
    returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Vera Admin", platformAdmin: true };
});

afterEach(() => {
  asked.account = null;
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.pages where slug like ${`%-${run}`}`);
  await closeDb();
});

describe("a page's versions", () => {
  it("keeps each save and publish once, newest first, with who kept it", async () => {
    const id = await save(null, content(`kept-${run}`), false);
    expect(await kinds(id)).toEqual(["saved"]);
    // The same draft again is no new version; publishing it is.
    await save(id, content(`kept-${run}`), false);
    expect(await kinds(id)).toEqual(["saved"]);
    await save(id, content(`kept-${run}`), true);
    expect(await kinds(id)).toEqual(["published", "saved"]);
    await save(id, content(`kept-${run}`, "Another title"), false);
    const list = await versions.listVersions(null, id, "page");
    expect(list.map((v) => v.kind)).toEqual(["saved", "published", "saved"]);
    expect(list[0]).toMatchObject({ by: "Vera Admin", title: "Another title" });
  });

  it("gives back a version's content, and only for its own owner's page of its type", async () => {
    const id = await save(null, content(`read-${run}`, "First words"), false);
    await save(id, content(`read-${run}`, "Second words"), false);
    const [, first] = await versions.listVersions(null, id, "page");
    expect((await versions.readVersion(null, id, "page", first.id))?.title).toBe("First words");
    const store = "00000000-0000-4000-8000-00000000abcd";
    expect(await versions.listVersions(store, id, "page")).toEqual([]);
    expect(await versions.readVersion(store, id, "page", first.id)).toBeNull();
    expect(await versions.readVersion(null, id, "article", first.id)).toBeNull();
  });

  it("keeps a page's newest fifty", async () => {
    const id = await save(null, content(`many-${run}`, "Title 0"), false);
    for (let n = 1; n <= VERSIONS_KEPT + 2; n++) await save(id, content(`many-${run}`, `Title ${n}`), false);
    const list = await versions.listVersions(null, id, "page");
    expect(list).toHaveLength(VERSIONS_KEPT);
    expect(list[0].title).toBe(`Title ${VERSIONS_KEPT + 2}`);
    const [{ count }] = await db().execute<Row>(sql`select count(*)::int as count from commerce.page_versions where page_id = ${id}::uuid`);
    expect(count).toBe(VERSIONS_KEPT);
  });

  it("is never changed, and goes with its page", async () => {
    const id = await save(null, content(`fixed-${run}`), false);
    const refused = await db()
      .execute(sql`update commerce.page_versions set kind = 'published' where page_id = ${id}::uuid`)
      .then(() => null, (error: { cause?: { message?: string } }) => String(error.cause?.message));
    expect(refused).toMatch(/page_versions.fixed/);
    await db().execute(sql`delete from commerce.pages where id = ${id}::uuid`);
    const [{ count }] = await db().execute<Row>(sql`select count(*)::int as count from commerce.page_versions where page_id = ${id}::uuid`);
    expect(count).toBe(0);
  });

  it("keeps the words changed on the live site as a version of their own", async () => {
    const id = await save(null, content(`site-text-${run}`), true);
    const live = parsePageContent((await db().execute<Row>(sql`select published from commerce.pages where id = ${id}::uuid`))[0].published)!;
    const rev = textEdit.revisionOf((live.rows[0].columns[0].blocks[0] as { text: string }).text);
    const result = await textEdit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev, edit: { kind: "heading", text: "Welcome back" } });
    expect(result.ok).toBe(true);
    expect((await kinds(id))[0]).toBe("site_text");
  });
});

describe("custom CSS on the live site", () => {
  const stored = async (id: string) => {
    const [row] = await db().execute<Row>(sql`select draft, published from commerce.pages where id = ${id}::uuid`);
    return { draft: parsePageContent(row.draft)!, published: parsePageContent(row.published)! };
  };

  it("reads a published page's CSS and its site's, and saves the page's into it and its draft", async () => {
    asked.account = admin;
    const id = await save(null, content(`css-${run}`, "Css", ".a { color: red; }"), true);
    const read = await cssEdit.readPageCss({ store: null, page: id });
    expect(read).toMatchObject({ ok: true, pageCss: ".a { color: red; }", site: true, styles: { page: `page-${id}`, site: "kaizen" } });
    if (!read.ok) return;
    const saved = await cssEdit.savePageCss({ store: null, page: id, rev: read.rev, pageCss: ".a { color: blue; }", siteCss: read.siteCss });
    expect(saved).toMatchObject({ ok: true, draftKept: false });
    const after = await stored(id);
    expect(after.published.css).toBe(".a { color: blue; }");
    expect(after.draft.css).toBe(".a { color: blue; }");
    expect((await kinds(id))[0]).toBe("site_css");
    const [log] = await db().execute<Row>(sql`select action, details from commerce.audit_log where details ->> 'page' = ${id} and action = 'platform.page_css_edited'`);
    expect(log.details).toMatchObject({ page: id });
    expect(JSON.stringify(log.details)).not.toContain("color");
  });

  it("leaves a draft that has CSS of its own as it is, and says so", async () => {
    asked.account = admin;
    const id = await save(null, content(`css-draft-${run}`, "Css", ".a { color: red; }"), true);
    await save(id, content(`css-draft-${run}`, "Css", ".a { color: green; }"), false);
    const read = await cssEdit.readPageCss({ store: null, page: id });
    if (!read.ok) throw new Error("not read");
    const saved = await cssEdit.savePageCss({ store: null, page: id, rev: read.rev, pageCss: ".a { color: blue; }", siteCss: read.siteCss });
    expect(saved).toMatchObject({ ok: true, draftKept: true });
    const after = await stored(id);
    expect(after.published.css).toBe(".a { color: blue; }");
    expect(after.draft.css).toBe(".a { color: green; }");
  });

  it("refuses CSS changed since it was read, CSS with a problem, and a person who may not change the page", async () => {
    asked.account = admin;
    const id = await save(null, content(`css-refused-${run}`), true);
    const read = await cssEdit.readPageCss({ store: null, page: id });
    if (!read.ok) throw new Error("not read");
    expect(await cssEdit.savePageCss({ store: null, page: id, rev: "0000000000000000", pageCss: ".a{}", siteCss: read.siteCss })).toMatchObject({ ok: false, code: "conflict" });
    expect(await cssEdit.savePageCss({ store: null, page: id, rev: read.rev, pageCss: "@import url(x.css);", siteCss: read.siteCss })).toMatchObject({ ok: false, code: "refused" });
    expect((await stored(id)).published.css).toBeUndefined();
    asked.account = { ...admin, platformAdmin: false };
    expect(await cssEdit.readPageCss({ store: null, page: id })).toMatchObject({ ok: false, code: "forbidden" });
  });

  it("saves the whole site's CSS beside the page's", async () => {
    asked.account = admin;
    const [before] = await db().execute<Row>(sql`select custom_css from commerce.platform_settings limit 1`);
    const id = await save(null, content(`css-site-${run}`), true);
    const read = await cssEdit.readPageCss({ store: null, page: id });
    if (!read.ok) throw new Error("not read");
    try {
      const saved = await cssEdit.savePageCss({ store: null, page: id, rev: read.rev, pageCss: "", siteCss: `.site-${run} { margin: 0; }` });
      expect(saved.ok).toBe(true);
      const [after] = await db().execute<Row>(sql`select custom_css from commerce.platform_settings limit 1`);
      expect(after.custom_css).toBe(`.site-${run} { margin: 0; }`);
    } finally {
      await db().execute(sql`update commerce.platform_settings set custom_css = ${before?.custom_css ?? ""}`);
    }
  });
});
