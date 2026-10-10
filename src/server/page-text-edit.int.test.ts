import { sql } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, parsePageContent, type PageContent } from "@/lib/page-content";
import { blockWords, locateBlock } from "@/lib/inline-edit";

import type { Account } from "./auth";

// Who is asking and whether a test is running are set by each test; everything else of these modules is real.
const asked = vi.hoisted(() => ({ member: null as unknown, account: null as unknown, running: null as { id: string; name: string } | null, kinds: [] as unknown[][] }));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {} }));
vi.mock("./auth", async (original) => ({ ...(await original<typeof import("./auth")>()), getAccount: async () => asked.account }));
vi.mock("./permissions", async (original) => ({
  ...(await original<typeof import("./permissions")>()),
  checkPageTypeAccess: async (...args: unknown[]) => {
    asked.kinds.push(args);
    return asked.member;
  },
}));
vi.mock("./experiment-admin", async (original) => {
  const actual = await original<typeof import("./experiment-admin")>();
  return { ...actual, runningTestOf: async (store: string, page: string) => asked.running ?? actual.runningTestOf(store, page) };
});

const pages = await import("./pages");
const edit = await import("./page-text-edit");

/**
 * Editing a page's words on the live site (D192): the page as visitors see it changes, the draft with it where it has the same words,
 * and nothing changes when the words moved on, the page is not live or the words would leave nothing to press.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
let admin: Account;

const doc = (words: string) => ({ type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: words }] }] });
const content = (slug: string, heading = "Welcome", words = "Hello there."): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug,
  rows: [
    {
      id: "row-1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "column-1",
          blocks: [
            { id: "heading-1", type: "heading", text: heading, level: 2 },
            { id: "text-1", type: "richText", doc: doc(words) },
          ],
        },
      ],
    },
  ],
});

const make = async (slug: string, publish: boolean, body = content(slug)) => {
  const result = await pages.savePage(admin, null, null, body, { publish });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
};
const stored = async (id: string) => {
  const [row] = await db().execute<Row>(sql`select draft, published, updated_by from commerce.pages where id = ${id}::uuid`);
  return { draft: parsePageContent(row.draft), published: parsePageContent(row.published), by: String(row.updated_by) };
};
const words = (page: PageContent | null, block: string) => (page ? blockWords(locateBlock(page.rows, block)!.block) : null);
const revOf = (page: PageContent, block: string) => edit.revisionOf(words(page, block)!);

const stores: { id: string; slug: string }[] = [];
async function makeStore(name: string) {
  const email = `text-edit-${name}-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, ${name}, ${name}) returning id`);
  const slug = `text-edit-${name}-${run}`;
  const [store] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${name}, null) as id`);
  stores.push({ id: String(store.id), slug });
  return stores.at(-1)!;
}

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`text-edit-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
});

afterEach(() => {
  asked.member = null;
  asked.account = null;
  asked.running = null;
  asked.kinds = [];
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.pages where slug like ${`%-${run}`}`);
  await closeDb();
});

describe("editing a heading and a text on the live page", () => {
  it("changes what visitors see and the draft with it, which had the same words", async () => {
    const id = await make(`one-${run}`, true);
    const before = await stored(id);
    const heading = await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev: revOf(before.published!, "heading-1"), edit: { kind: "heading", text: "Welcome back" } });
    expect(heading).toEqual({ ok: true, draftKept: false });
    const after = await stored(id);
    expect(words(after.published, "heading-1")).toBe("Welcome back");
    expect(words(after.draft, "heading-1")).toBe("Welcome back");
    expect(after.by).toBe(admin.id);
    // The other component is as it was.
    expect(words(after.published, "text-1")).toBe(words(before.published, "text-1"));

    const text = await edit.applyPageText({ account: admin, owner: null, page: id, block: "text-1", rev: revOf(after.published!, "text-1"), edit: { kind: "richText", doc: doc("Changed here.") } });
    expect(text.ok).toBe(true);
    expect(words((await stored(id)).published, "text-1")).toBe(JSON.stringify(doc("Changed here.")));
  });

  it("writes it down, with where and what kind and never the words", async () => {
    const id = await make(`log-${run}`, true);
    const now = await stored(id);
    await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev: revOf(now.published!, "heading-1"), edit: { kind: "heading", text: "A secret plan" } });
    const [entry] = await db().execute<Row>(sql`select action, details from commerce.audit_log where target_id = ${id} and action like '%_text_edited'`);
    expect(String(entry.action)).toBe("platform.page_text_edited");
    expect(JSON.stringify(entry.details)).toContain("heading-1");
    expect(JSON.stringify(entry.details)).not.toContain("secret plan");
  });

  it("leaves a draft that has other words for the block alone, and says so", async () => {
    const slug = `draft-${run}`;
    const id = await make(slug, true);
    // Work in the builder that is not published: the heading has other words in the draft.
    const drafted = await pages.savePage(admin, null, id, content(slug, "Next season's heading"), { publish: false });
    expect(drafted.ok).toBe(true);
    const before = await stored(id);
    expect(words(before.draft, "heading-1")).toBe("Next season's heading");

    const result = await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev: revOf(before.published!, "heading-1"), edit: { kind: "heading", text: "Live fix" } });
    expect(result).toEqual({ ok: true, draftKept: true });
    const after = await stored(id);
    expect(words(after.published, "heading-1")).toBe("Live fix");
    expect(words(after.draft, "heading-1")).toBe("Next season's heading");
  });

  it("refuses words that moved on since they were read, and changes nothing", async () => {
    const id = await make(`stale-${run}`, true);
    const before = await stored(id);
    const rev = revOf(before.published!, "heading-1");
    await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev, edit: { kind: "heading", text: "First" } });
    const late = await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev, edit: { kind: "heading", text: "Second" } });
    expect(late).toMatchObject({ ok: false, status: 409, code: "conflict" });
    expect(words((await stored(id)).published, "heading-1")).toBe("First");
  });

  it("refuses a page that is not live, a block that is gone, a kind that does not fit and words that would leave nothing", async () => {
    const draftOnly = await make(`draftonly-${run}`, false);
    const d = await stored(draftOnly);
    expect(await edit.applyPageText({ account: admin, owner: null, page: draftOnly, block: "heading-1", rev: revOf(d.draft!, "heading-1"), edit: { kind: "heading", text: "x" } })).toMatchObject({ ok: false, code: "not_published" });

    const id = await make(`refuse-${run}`, true);
    const s = await stored(id);
    const rev = revOf(s.published!, "heading-1");
    expect(await edit.applyPageText({ account: admin, owner: null, page: id, block: "nope", rev, edit: { kind: "heading", text: "x" } })).toMatchObject({ ok: false, code: "not_found" });
    expect(await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev, edit: { kind: "richText", doc: doc("x") } })).toMatchObject({ ok: false, code: "refused" });
    expect(await edit.applyPageText({ account: admin, owner: null, page: id, block: "heading-1", rev, edit: { kind: "heading", text: "   " } })).toMatchObject({ ok: false, code: "refused" });
    const empty = await edit.applyPageText({ account: admin, owner: null, page: id, block: "text-1", rev: revOf(s.published!, "text-1"), edit: { kind: "richText", doc: { type: "doc", content: [] } } });
    expect(empty).toMatchObject({ ok: false, code: "refused" });
    // Nothing was written by any of them.
    expect(words((await stored(id)).published, "heading-1")).toBe("Welcome");
  });

  it("is not made on a page of another owner's, whatever the id", async () => {
    const id = await make(`owner-${run}`, true);
    const s = await stored(id);
    const other = "00000000-0000-4000-8000-000000000000";
    expect(await edit.applyPageText({ account: admin, owner: other, page: id, block: "heading-1", rev: revOf(s.published!, "heading-1"), edit: { kind: "heading", text: "x" } })).toMatchObject({ ok: false, code: "not_found" });
  });
});

describe("who may edit, and where", () => {
  it("lets a member who can write the website change their own store's page, and writes it down for the store", async () => {
    const store = await makeStore("own");
    const id = await pages.savePage(admin, store.id, null, content(`own-${run}`), { publish: true }).then((r) => (r.ok ? r.id : Promise.reject(new Error("not saved"))));
    asked.member = { account: admin, store: { id: store.id, slug: store.slug } };
    const before = await stored(id);

    const read = await edit.readPageText({ store: store.slug, page: id, block: "heading-1" });
    expect(read).toMatchObject({ ok: true, kind: "heading", text: "Welcome" });
    const saved = await edit.savePageText({ store: store.slug, page: id, block: "heading-1", rev: revOf(before.published!, "heading-1"), edit: { kind: "heading", text: "Hei, velkommen" } });
    expect(saved).toEqual({ ok: true, draftKept: false });
    expect(words((await stored(id)).published, "heading-1")).toBe("Hei, velkommen");
    // Asked of the page's own type, for writing.
    expect(asked.kinds.at(-1)).toEqual([store.slug, "page", "write"]);
    const [entry] = await db().execute<Row>(sql`select action, store_id from commerce.audit_log where target_id = ${id} and action like '%_text_edited'`);
    expect(entry).toMatchObject({ action: "store.page_text_edited", store_id: store.id });
  });

  it("refuses the person who may not, and a member of another store, and changes nothing", async () => {
    const store = await makeStore("mine");
    const other = await makeStore("theirs");
    const id = await pages.savePage(admin, store.id, null, content(`mine-${run}`), { publish: true }).then((r) => (r.ok ? r.id : Promise.reject(new Error("not saved"))));
    const before = await stored(id);
    const rev = revOf(before.published!, "heading-1");
    const attempt = { page: id, block: "heading-1", rev, edit: { kind: "heading", text: "Taken over" } } as const;

    // No right to write the website (or no session at all).
    asked.member = null;
    expect(await edit.savePageText({ store: store.slug, ...attempt })).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect(await edit.readPageText({ store: store.slug, page: id, block: "heading-1" })).toMatchObject({ ok: false, status: 403 });
    // A member of another store, naming their own store.
    asked.member = { account: admin, store: { id: other.id, slug: other.slug } };
    expect(await edit.savePageText({ store: other.slug, ...attempt })).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    // A platform admin is not a member of a store's page: Kaizen's own pages are theirs, not a store's.
    asked.account = admin;
    expect(await edit.savePageText({ store: null, ...attempt })).toMatchObject({ ok: false, status: 403, code: "forbidden" });
    expect(words((await stored(id)).published, "heading-1")).toBe("Welcome");
  });

  it("keeps Kaizen's own pages to platform admins, and a store's member out of them", async () => {
    const store = await makeStore("kz");
    const id = await make(`kaizen-${run}`, true);
    const s = await stored(id);
    const attempt = { page: id, block: "heading-1", rev: revOf(s.published!, "heading-1"), edit: { kind: "heading", text: "Overtaken" } } as const;

    asked.account = { ...admin, platformAdmin: false };
    expect(await edit.savePageText({ store: null, ...attempt })).toMatchObject({ ok: false, status: 403 });
    asked.account = null;
    expect(await edit.savePageText({ store: null, ...attempt })).toMatchObject({ ok: false, status: 403 });
    // A member naming their own store for a page that is Kaizen's.
    asked.member = { account: admin, store: { id: store.id, slug: store.slug } };
    expect(await edit.savePageText({ store: store.slug, ...attempt })).toMatchObject({ ok: false, status: 403 });
    expect(words((await stored(id)).published, "heading-1")).toBe("Welcome");

    asked.account = admin;
    expect(await edit.savePageText({ store: null, ...attempt })).toEqual({ ok: true, draftKept: false });
  });

  it("leaves a page in a running A/B test as it is, said before anything is typed", async () => {
    const store = await makeStore("ab");
    const id = await pages.savePage(admin, store.id, null, content(`ab-${run}`), { publish: true }).then((r) => (r.ok ? r.id : Promise.reject(new Error("not saved"))));
    asked.member = { account: admin, store: { id: store.id, slug: store.slug } };
    asked.running = { id: "t1", name: "Headline test" };
    const s = await stored(id);

    expect(await edit.readPageText({ store: store.slug, page: id, block: "heading-1" })).toMatchObject({ ok: false, status: 409, code: "running_test" });
    const saved = await edit.savePageText({ store: store.slug, page: id, block: "heading-1", rev: revOf(s.published!, "heading-1"), edit: { kind: "heading", text: "Spoiled" } });
    expect(saved).toMatchObject({ ok: false, status: 409, code: "running_test" });
    expect(saved.ok === false && saved.message).toContain("Headline test");
    expect(words((await stored(id)).published, "heading-1")).toBe("Welcome");
  });

  it("edits an article as a page, asked for its own kind, and leaves a version made for a test to the test", async () => {
    const store = await makeStore("kind");
    const article = await pages.savePage(admin, store.id, null, content(`article-${run}`), { publish: true, type: "article" }).then((r) => (r.ok ? r.id : Promise.reject(new Error("not saved"))));
    const version = await pages.savePage(admin, store.id, null, content(`version-${run}`), { publish: false, type: "variant", variantOf: "page" }).then((r) => (r.ok ? r.id : Promise.reject(new Error("not saved"))));
    asked.member = { account: admin, store: { id: store.id, slug: store.slug } };

    const s = await stored(article);
    const saved = await edit.savePageText({ store: store.slug, page: article, block: "heading-1", rev: revOf(s.published!, "heading-1"), edit: { kind: "heading", text: "New article heading" } });
    expect(saved.ok).toBe(true);
    expect(asked.kinds.at(-1)).toEqual([store.slug, "article", "write"]);
    const [entry] = await db().execute<Row>(sql`select action from commerce.audit_log where target_id = ${article} and action like '%_text_edited'`);
    expect(entry.action).toBe("store.article_text_edited");

    // A version of a page in a test is changed in its test, never from the page it stands in for.
    expect(await edit.readPageText({ store: store.slug, page: version, block: "heading-1" })).toMatchObject({ ok: false, status: 403 });
    expect(await edit.savePageText({ store: store.slug, page: version, block: "heading-1", rev: revOf(s.published!, "heading-1"), edit: { kind: "heading", text: "x" } })).toMatchObject({ ok: false, status: 403 });
  });
});
