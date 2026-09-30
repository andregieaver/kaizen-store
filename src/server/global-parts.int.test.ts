import { randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { globalContent, markUse, newUse, setLocal, usesIn, type GlobalPart } from "@/lib/global-parts";
import { newPageContent, type HeadingBlock, type PageBlock, type PageContent, type PageRow } from "@/lib/page-content";
import type { SavedPart } from "@/lib/saved-parts";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const pages = await import("./pages");
const parts = await import("./saved-parts");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let owner: Account;
let storeId: string;

const heading = (text: string, level: 1 | 2 = 2): HeadingBlock => ({ id: randomUUID(), type: "heading", text, level });
const hero = (): PageRow => ({
  id: randomUUID(),
  type: "row",
  layout: "2",
  columns: [
    { id: randomUUID(), blocks: [heading("Welcome")] },
    { id: randomUUID(), blocks: [heading("Offer")] },
  ],
});
const page = (slug: string, rows: PageRow[]): PageContent => ({ ...newPageContent(), title: `Page ${slug}`, slug: `${slug}-${run}`, rows });
const texts = (content: PageContent) => content.rows.flatMap((r) => r.columns.flatMap((c) => c.blocks.map((b) => (b as HeadingBlock).text)));
const asGlobal = (part: SavedPart): GlobalPart => {
  if (part.kind === "page") throw new Error("A page layout is never global.");
  return { id: part.id, kind: part.kind, content: part.content, translations: part.translations };
};

async function stored(id: string): Promise<{ draft: PageContent; published: PageContent | null }> {
  const [row] = await db().execute<Row>(sql`select draft, published from commerce.pages where id = ${id}::uuid`);
  return { draft: row.draft as PageContent, published: (row.published ?? null) as PageContent | null };
}

async function save(id: string | null, content: PageContent, options: { publish?: boolean; edits?: string[] } = {}) {
  const result = await pages.savePage(owner, storeId, id, { ...content, globalEdits: options.edits ?? [] }, { publish: options.publish ?? false });
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result;
}

/** A global made from a row on a page, as the builder does it; the page's row becomes its first use. */
async function makeGlobal(row: PageRow, name: string): Promise<{ global: GlobalPart; use: PageRow }> {
  const created = await parts.createSavedPart(owner, storeId, { kind: "row", name: `${name} ${run}`, content: globalContent("row", row), global: true });
  if (!created.ok) throw new Error(created.problems.join(" "));
  const part = created.parts.find((p) => p.id === created.id)!;
  return { global: asGlobal(part), use: markUse([row], row.id, part.id)[0] };
}

beforeAll(async () => {
  const email = `globals-${run}@example.com`;
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', 'Globals') returning id
  `);
  const [store] = await db().execute<Row>(sql`
    select commerce.approve_access_request(${String(request.id)}::uuid, ${`globals-${run}`}, 'Globals', null) as id
  `);
  storeId = String(store.id);
  const [account] = await db().execute<Row>(sql`select id from commerce.accounts where lower(email) = ${email}`);
  owner = { id: String(account.id), email, name: "Owner", platformAdmin: false };
});

afterAll(async () => {
  await closeDb();
});

describe("global rows", () => {
  it("a change on one page reaches every page using it, drafts and live, and each page keeps its own parts", async () => {
    const row = hero();
    const { global, use } = await makeGlobal(row, "Hero");
    const a = await save(null, page("a", [use]), { publish: true });
    const b = await save(null, page("b", [newUse(global, randomUUID()) as PageRow]), { publish: true });
    expect((await parts.listSavedParts(storeId)).find((p) => p.id === global.id)?.uses).toBe(2);

    // Page A changes the welcome, as a draft only: the global changes everywhere, live too.
    const edited = page("a", [{ ...use, columns: [{ ...use.columns[0], blocks: [{ ...(use.columns[0].blocks[0] as HeadingBlock), text: "Hello" }] }, use.columns[1]] }]);
    const result = await save(a.id, edited, { edits: [global.id] });
    expect(result.pages).toBe(2); // B (draft and live) and A's live version
    const onB = await stored(b.id);
    expect(texts(onB.draft)).toEqual(["Hello", "Offer"]);
    expect(texts(onB.published!)).toEqual(["Hello", "Offer"]);
    expect(texts((await stored(a.id)).published!)).toEqual(["Hello", "Offer"]);
    // B's use keeps its own ids.
    expect(onB.draft.rows[0].id).not.toBe(use.id);

    // A makes its offer column its own and writes in it: B keeps its offer, and the column is B's own too.
    const own = setLocal(edited.rows, use.columns[1].id, true);
    const withOffer = page("a", [{ ...own[0], columns: [own[0].columns[0], { ...own[0].columns[1], blocks: [heading("Half price")] }] }]);
    await save(a.id, withOffer, { edits: [global.id] });
    const b2 = await stored(b.id);
    expect(texts(b2.draft)).toEqual(["Hello", "Offer"]);
    expect(b2.draft.rows[0].columns[1].local).toBe(true);

    // B writes its own offer, and sends A's old welcome without saying it changed the global: it gets the global as it is.
    const stale = page("b", [{ ...b2.draft.rows[0], columns: [{ ...b2.draft.rows[0].columns[0], blocks: [heading("Welcome")] }, { ...b2.draft.rows[0].columns[1], blocks: [heading("Two for one")] }] }]);
    const kept = await save(b.id, stale);
    expect(kept.pages).toBeUndefined();
    expect(texts((await stored(b.id)).draft)).toEqual(["Hello", "Two for one"]);
    expect(texts((await stored(a.id)).draft)).toEqual(["Hello", "Half price"]);
  });

  it("refuses a change that would make another page one that cannot be saved", async () => {
    const { global, use } = await makeGlobal(hero(), "Banner");
    const a = await save(null, page("banner-a", [use]));
    // Page C has its own main heading.
    const c = await save(null, page("banner-c", [newUse(global, randomUUID()) as PageRow, { ...hero(), columns: [{ id: randomUUID(), blocks: [heading("Title", 1)] }, { id: randomUUID(), blocks: [] }] }]));
    const withH1 = page("banner-a", [{ ...use, columns: [{ ...use.columns[0], blocks: [heading("Big", 1)] }, use.columns[1]] }]);
    const result = await pages.savePage(owner, storeId, a.id, { ...withH1, globalEdits: [global.id] }, { publish: false });
    expect(result.ok).toBe(false);
    expect(!result.ok && result.problems.join(" ")).toMatch(/Page banner-c.*one main heading/);
    // Nothing changed.
    expect(texts((await stored(a.id)).draft)).toEqual(["Welcome", "Offer"]);
    expect(texts((await stored(c.id)).draft)).toEqual(["Welcome", "Offer", "Title"]);
  });

  it("changing a global under Saved reaches its pages; deleting it leaves them their copies", async () => {
    const { global, use } = await makeGlobal(hero(), "Footer band");
    const a = await save(null, page("band-a", [use]), { publish: true });
    const content = global.content as PageRow;
    const changed = await parts.updateSavedPart(owner, storeId, global.id, {
      kind: "row",
      name: `Footer band ${run}`,
      global: true,
      content: { ...content, columns: [content.columns[0], { ...content.columns[1], blocks: [heading("Sale")] }] },
    });
    expect(changed.ok && changed.pages).toBe(1);
    expect(texts((await stored(a.id)).published!)).toEqual(["Welcome", "Sale"]);

    const deleted = await parts.deleteSavedPart(owner, storeId, global.id);
    expect(deleted.ok && deleted.pages).toBe(1);
    const after = await stored(a.id);
    expect(texts(after.published!)).toEqual(["Welcome", "Sale"]);
    expect(usesIn(after.published!.rows)).toEqual([]);
    // A use of a global that is gone is saved as a plain part.
    const again = await save(a.id, page("band-a", [use]));
    expect(again.ok).toBe(true);
    expect(usesIn((await stored(a.id)).draft.rows)).toEqual([]);
  });
});

describe("a global component inside a global row", () => {
  it("follows its changes on its own and inside the row, on every page", async () => {
    const promise = heading("Free delivery");
    const block = await parts.createSavedPart(owner, storeId, { kind: "block", name: `Promise ${run}`, content: globalContent("block", promise), global: true });
    if (!block.ok) throw new Error(block.problems.join(" "));
    const blockGlobal = asGlobal(block.parts.find((p) => p.id === block.id)!);
    const inner: PageRow = { ...hero(), columns: [{ id: randomUUID(), blocks: [heading("Shop")] }, { id: randomUUID(), blocks: [newUse(blockGlobal, randomUUID()) as PageBlock] }] };
    const { global: rowGlobal, use } = await makeGlobal(inner, "Shop band");
    const d = await save(null, page("promise-d", [{ ...hero(), columns: [{ id: randomUUID(), blocks: [newUse(blockGlobal, randomUUID()) as PageBlock] }, { id: randomUUID(), blocks: [] }] }]));
    const e = await save(null, page("promise-e", [newUse(rowGlobal, randomUUID()) as PageRow]));
    void use;

    const changed = await parts.updateSavedPart(owner, storeId, blockGlobal.id, {
      kind: "block",
      name: `Promise ${run}`,
      global: true,
      content: { ...(blockGlobal.content as HeadingBlock), text: "Free returns" },
    });
    expect(changed.ok).toBe(true);
    expect(texts((await stored(d.id)).draft)).toEqual(["Free returns"]);
    expect(texts((await stored(e.id)).draft)).toEqual(["Shop", "Free returns"]);
    // The row's own content follows too, so its next use has it.
    const row = (await parts.listSavedParts(storeId)).find((p) => p.id === rowGlobal.id)!;
    expect(JSON.stringify(row.content)).toContain("Free returns");
  });
});
