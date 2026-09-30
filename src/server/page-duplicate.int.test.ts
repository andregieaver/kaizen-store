import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent, type PageContent } from "@/lib/page-content";

import type { Account } from "./auth";
import type { PageResult } from "./pages";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {} }));

const pages = await import("./pages");
const { duplicatePage } = await import("./page-duplicate");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
let admin: Account;
let storeId: string;

const oneRow = (words: string) =>
  [
    {
      id: "row-1",
      type: "row",
      layout: "1",
      columns: [
        {
          id: "column-1",
          blocks: [
            {
              id: "block-1",
              type: "richText",
              doc: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: words }] }] },
            },
          ],
        },
      ],
    },
  ] as PageContent["rows"];

const content = (slug: string, overrides: Partial<PageContent> = {}): PageContent => ({
  ...newPageContent(),
  title: `Page ${slug}`,
  slug,
  rows: oneRow(`About ${slug}.`),
  ...overrides,
});

const made = (result: PageResult) => {
  if (!result.ok) throw new Error(result.problems.join(" "));
  return result.id;
};

beforeAll(async () => {
  const [account] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`dup-${run}@example.com`}, 'Admin', true)
    returning id, email
  `);
  admin = { id: String(account.id), email: String(account.email), name: "Admin", platformAdmin: true };
  const [store] = await db().execute<Row>(
    sql`insert into commerce.stores (slug, name) values (${`dup-${run}`}, 'Duplicates') returning id`,
  );
  storeId = String(store.id);
});

afterAll(async () => {
  await db().execute(sql`delete from commerce.field_values where store_id = ${storeId}::uuid`);
  await db().execute(sql`delete from commerce.pages where slug like ${`%-${run}%`}`);
  await closeDb();
});

describe("duplicating a page (D126)", () => {
  it("makes an unpublished copy with a title and address of its own", async () => {
    const id = made(await pages.savePage(admin, null, null, content(`about-${run}`), { publish: true }));
    const copy = made(await duplicatePage(admin, null, id));
    expect(copy).not.toBe(id);

    const page = await pages.getPageForEdit(null, copy);
    expect(page?.state).toBe("draft");
    expect(page?.slug).toBe(`about-${run}-copy`);
    expect(page?.draft.title).toBe(`Copy of Page about-${run}`);
    expect(page?.draft.rows).toEqual(content(`about-${run}`).rows);
    // The original stays as it was, live.
    expect((await pages.getPageForEdit(null, id))?.state).toBe("published");
    expect(await pages.findPublishedPage(null, `about-${run}-copy`)).toBeNull();
  });

  it("finds a free address each time, and a copy of a copy copies the original's address", async () => {
    const id = made(await pages.savePage(admin, null, null, content(`twice-${run}`), { publish: false }));
    const first = made(await duplicatePage(admin, null, id));
    const second = made(await duplicatePage(admin, null, id));
    const third = made(await duplicatePage(admin, null, first));
    expect((await pages.getPageForEdit(null, first))?.slug).toBe(`twice-${run}-copy`);
    expect((await pages.getPageForEdit(null, second))?.slug).toBe(`twice-${run}-copy-2`);
    expect((await pages.getPageForEdit(null, third))?.slug).toBe(`twice-${run}-copy-3`);
    expect((await pages.getPageForEdit(null, third))?.draft.title).toBe(`Copy of Page twice-${run}`);
  });

  it("copies what the editor holds, unsaved changes too, and never changes a global part", async () => {
    const id = made(await pages.savePage(admin, null, null, content(`held-${run}`), { publish: false }));
    const edited = {
      ...content(`held-${run}`, { rows: oneRow("Not saved yet.") }),
      globalEdits: ["not-a-part"],
      fields: { x: 1 },
    };
    const copy = made(await duplicatePage(admin, null, id, "page", edited));
    expect((await pages.getPageForEdit(null, copy))?.draft.rows).toEqual(oneRow("Not saved yet."));
    // The original's own draft is unchanged.
    expect((await pages.getPageForEdit(null, id))?.draft.rows).toEqual(oneRow(`About held-${run}.`));
  });

  it("says so when the page is gone, and does not copy one owner's page for another", async () => {
    const id = made(await pages.savePage(admin, null, null, content(`gone-${run}`), { publish: false }));
    expect(await duplicatePage(admin, storeId, id)).toMatchObject({ ok: false });
    expect(await duplicatePage(admin, null, "00000000-0000-4000-8000-000000000000")).toMatchObject({ ok: false });
  });

  it("copies a store page with its custom field values in every language", async () => {
    const id = made(await pages.savePage(admin, storeId, null, content(`fields-${run}`), { publish: false }));
    await db().execute(sql`
      insert into commerce.field_values (store_id, entity, entity_id, locale, values) values
        (${storeId}::uuid, 'page', ${id}::uuid, '', ${JSON.stringify({ a: "same" })}::jsonb),
        (${storeId}::uuid, 'page', ${id}::uuid, 'nb', ${JSON.stringify({ b: "norsk" })}::jsonb)
    `);
    const copy = made(await duplicatePage(admin, storeId, id));
    const rows = await db().execute<Row>(sql`
      select locale, values from commerce.field_values where entity = 'page' and entity_id = ${copy}::uuid order by locale
    `);
    expect(rows.map((r) => [r.locale, r.values])).toEqual([
      ["", { a: "same" }],
      ["nb", { b: "norsk" }],
    ]);
  });

  it("records who duplicated what", async () => {
    const id = made(await pages.savePage(admin, null, null, content(`audit-${run}`), { publish: false }));
    const copy = made(await duplicatePage(admin, null, id));
    const [row] = await db().execute<Row>(sql`
      select count(*)::int as n from commerce.audit_log where action = 'platform.page_duplicated' and details->>'page' = ${copy}
    `);
    expect(Number(row.n)).toBe(1);
  });
});
