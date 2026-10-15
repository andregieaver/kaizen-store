import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { canonicalJson } from "@/lib/lifecycle";
import { pageInput, type PageRow } from "@/lib/page-content";
import { defaultHeader } from "@/lib/site-layout";
import { parseStoreTheme } from "@/lib/theme";
import { themedRows } from "@/lib/theme-elements";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const detach = await import("./theme-detach");

/**
 * The page migration run for real (D243, `docs/theme-phase-2.md` step 2): pages are drawn exactly as before and follow the theme after;
 * a run is undone while a page is as the run left it; pages a theme that is not live keeps are left alone.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];

let store: string;
let owner: string;
let stranger: string;

const ELEMENTS = { h2: { typography: { text: { size: { value: 2, unit: "rem" }, weight: 700 } } }, row: { radius: 8 } };

const rowsOf = (extra: Record<string, unknown> = {}): PageRow[] => [
  {
    id: "r1",
    type: "row",
    layout: "1",
    radius: 8,
    columns: [
      {
        id: "c1",
        blocks: [
          { id: "h1", type: "heading", text: "Hello", level: 2, typography: { text: { size: { value: 2, unit: "rem" }, color: "#ff0000" } }, ...extra },
          { id: "h2", type: "heading", text: "Own", level: 2, typography: { text: { weight: 400 } } },
        ],
      },
    ],
  } as unknown as PageRow,
];

async function pageOf(type: string, slug: string, rows: PageRow[], published = true): Promise<string> {
  const parsed = pageInput.safeParse({ ...defaultHeader(store, { header: null, footer: null }), title: slug, slug, rows });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
  const json = JSON.stringify(parsed.data);
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
    values (${store}::uuid, ${type}, ${slug}, ${json}::jsonb, ${published ? sql`${json}::jsonb` : sql`null`}, ${published ? sql`now()` : sql`null`}, ${published ? sql`now()` : sql`null`})
    returning id
  `);
  return String(page.id);
}

async function storeOf(email: string, slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}

const accountId = async (email: string) => String((await one(sql`select id from commerce.accounts where lower(email) = lower(${email})`)).id);
const pageRow = (id: string) => one(sql`select draft, published from commerce.pages where id = ${id}::uuid`);
const drawn = (content: unknown) => canonicalJson(themedRows((content as { rows: PageRow[] }).rows, ELEMENTS as never));

beforeAll(async () => {
  store = await storeOf(`detach-${run}@example.com`, `detach-${run}`);
  owner = await accountId(`detach-${run}@example.com`);
  await storeOf(`detach-x-${run}@example.com`, `detach-x-${run}`);
  stranger = await accountId(`detach-x-${run}@example.com`);
  // The store's live theme gives headings of level 2 their size and weight, and rows their corners.
  const { theme } = await one(sql`select theme from commerce.stores where id = ${store}::uuid`);
  const parsed = parseStoreTheme(theme);
  const next = { ...(theme as Row), settings: { ...parsed.settings, elements: ELEMENTS } };
  await db().execute(sql`update commerce.stores set theme = ${JSON.stringify(next)}::jsonb where id = ${store}::uuid`);
  expect(parseStoreTheme(next).settings.elements).toEqual(ELEMENTS);
});

afterAll(async () => {
  await closeDb();
});

describe("making a store's pages follow the theme (D243)", () => {
  let page: string;
  let kept: string;
  let runId: string;

  it("takes out what only repeats the theme, keeps the owner's own, and the page is drawn exactly as before", async () => {
    page = await pageOf("page", `follow-${run}`, rowsOf());
    // A header a theme that is not live chose: it is drawn under that theme once switched to, so it is left as it is.
    kept = await pageOf("header", `kept-${run}`, rowsOf());
    await db().execute(sql`
      insert into commerce.store_theme_installs (store_id, title, look, live)
      values (${store}::uuid, 'Put away', ${JSON.stringify({ theme: {}, css: "", headerId: kept, footerId: null, productLayoutId: null })}::jsonb, false)
    `);
    const before = await pageRow(page);
    const keptBefore = await pageRow(kept);

    const report = await detach.detachDryRun(store);
    expect(report!.pages.find((p) => p.id === page)).toMatchObject({ followed: 2, own: 2 });
    expect(report!.pages.find((p) => p.id === kept)).toBeUndefined();

    expect(await detach.runDetach(store, stranger)).toEqual({ ok: false, problems: ["You do not work in this store."] });
    const result = await detach.runDetach(store, owner);
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result.runId).not.toBeNull();
    runId = result.runId!;
    expect(result.followed).toBeGreaterThanOrEqual(4);

    const after = await pageRow(page);
    for (const version of ["draft", "published"] as const) {
      const row = (after[version] as { rows: PageRow[] }).rows[0] as unknown as Row;
      expect(row.radius).toBeUndefined();
      const [first, second] = (row.columns as { blocks: Row[] }[])[0].blocks;
      expect(first.typography).toEqual({ text: { color: "#ff0000" } });
      expect(second.typography).toEqual({ text: { weight: 400 } });
      expect(first.text).toBe("Hello");
      expect(drawn(after[version])).toBe(drawn(before[version]));
    }
    expect(await pageRow(kept)).toEqual(keptBefore);

    // A second run has nothing left to take out.
    expect(await detach.runDetach(store, owner)).toMatchObject({ ok: true, runId: null, pages: 0 });
    const runs = await detach.listDetachRuns(store);
    expect(runs[0]).toMatchObject({ runId, undoneAt: null });
    const audit = await one(sql`select area from commerce.audit_log where action = 'store.theme_pages_detached' and store_id = ${store}::uuid limit 1`);
    expect(audit.area).toBe("website");
  });

  it("undoes a run where a page is as it left it, and keeps a change made since", async () => {
    const other = await pageOf("page", `since-${run}`, rowsOf({ id: "h9" }));
    const second = await detach.runDetach(store, owner);
    if (!second.ok || !second.runId) throw new Error("no run");
    const original = await pageRow(other);
    // The owner changes the draft afterwards; the published version stays as the run left it.
    const edited = { ...(original.draft as Row), title: "Edited" };
    await db().execute(sql`update commerce.pages set draft = ${JSON.stringify(edited)}::jsonb where id = ${other}::uuid`);

    expect(await detach.undoDetach(store, second.runId, owner)).toEqual({ ok: true, restored: 0, changedSince: 1 });
    const now = await pageRow(other);
    expect((now.draft as Row).title).toBe("Edited");
    expect(((now.published as { rows: Row[] }).rows[0]).radius).toBe(8);

    const before = await pageRow(page);
    expect(await detach.undoDetach(store, runId, owner)).toEqual({ ok: true, restored: 1, changedSince: 0 });
    const back = await pageRow(page);
    expect(((back.draft as { rows: Row[] }).rows[0]).radius).toBe(8);
    expect(drawn(back.published)).toBe(drawn(before.published));
    expect((await detach.undoDetach(store, runId, owner)).ok).toBe(false);
    expect((await detach.listDetachRuns(store)).every((r) => r.undoneAt !== null)).toBe(true);
  });

  it("prunes only runs older than the days they are kept", async () => {
    expect(await detach.pruneThemeDetaches()).toBe(0);
    expect((await detach.listDetachRuns(store)).length).toBeGreaterThan(0);
  });
});
