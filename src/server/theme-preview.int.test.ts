import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { pageInput, type PageRow } from "@/lib/page-content";
import { defaultHeader } from "@/lib/site-layout";
import { templateSettings } from "@/lib/theme";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const installs = await import("./theme-installs");
const preview = await import("./theme-preview");

/**
 * Trying a theme before switching to it (D244, `docs/theme-phase-2.md` step 3): an installed theme that is not live is customised without
 * touching what visitors see, previewed with its own layouts, and *What changes* is read from the store's real pages.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];

let store: string;
let owner: string;
let stranger: string;
let live: string;
let kept: string;
let header: string;

async function storeOf(email: string, slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}

const accountId = async (email: string) => String((await one(sql`select id from commerce.accounts where lower(email) = lower(${email})`)).id);

async function pageOf(type: string, slug: string, rows: PageRow[]): Promise<string> {
  const parsed = pageInput.safeParse({ ...defaultHeader(store, { header: null, footer: null }), title: slug, slug, ...(rows.length > 0 && { rows }) });
  if (!parsed.success) throw new Error(JSON.stringify(parsed.error.issues.slice(0, 3)));
  const json = JSON.stringify(parsed.data);
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
    values (${store}::uuid, ${type}, ${slug}, ${json}::jsonb, ${json}::jsonb, now(), now())
    returning id
  `);
  return String(page.id);
}

const storeLook = () => one(sql`select theme, custom_css, header_id from commerce.stores where id = ${store}::uuid`);

beforeAll(async () => {
  store = await storeOf(`try-${run}@example.com`, `try-${run}`);
  owner = await accountId(`try-${run}@example.com`);
  await storeOf(`try-x-${run}@example.com`, `try-x-${run}`);
  stranger = await accountId(`try-x-${run}@example.com`);
  live = String((await one(sql`select id from commerce.store_theme_installs where store_id = ${store}::uuid and live`)).id);
  header = await pageOf("header", `calm-header-${run}`, []);
  // A page naming a section style the other theme lacks, so What changes has something to say.
  await pageOf("page", `promo-${run}`, [
    { id: "r1", type: "row", layout: "1", sectionStyle: "promo", columns: [{ id: "c1", blocks: [{ id: "h1", type: "heading", text: "Sale", level: 2 }] }] } as unknown as PageRow,
  ]);
  const theme = { base: "minimal", savedId: null, settings: { ...templateSettings("minimal"), sectionStyles: { plain: { row: { radius: 4 } }, hero: { row: { radius: 12 } } } } };
  kept = String(
    (
      await one(sql`
        insert into commerce.store_theme_installs (store_id, title, look, live)
        values (${store}::uuid, 'Calm', ${JSON.stringify({ theme, css: "", headerId: header, footerId: null, productLayoutId: null })}::jsonb, false)
        returning id
      `)
    ).id,
  );
});

afterAll(async () => {
  await closeDb();
});

describe("customising an installed theme that is not live (D244)", () => {
  it("keeps settings and CSS in the install and leaves the store's live look alone", async () => {
    const before = await storeLook();
    const theme = { base: "minimal", savedId: null, settings: { ...templateSettings("minimal"), sectionStyles: { plain: { row: { radius: 4 } }, hero: { row: { radius: 12 } } } } };
    expect(await installs.saveInstallLook(store, kept, owner, { theme })).toMatchObject({ ok: true });
    expect(await installs.saveInstallLook(store, kept, owner, { css: ".calm { color: #123456; }" })).toEqual({ ok: true, css: ".calm { color: #123456; }" });
    const install = await installs.installLook(store, kept);
    expect(install).toMatchObject({ live: false, title: "Calm", look: { css: ".calm { color: #123456; }", headerId: header } });
    expect((install!.look.theme as { base: string }).base).toBe("minimal");
    expect(await storeLook()).toEqual(before);
    const audit = await one(sql`select area from commerce.audit_log where action = 'store.theme_customised' and store_id = ${store}::uuid limit 1`);
    expect(audit.area).toBe("website");
  });

  it("refuses the live theme, someone from another store, and what the live theme's save would refuse", async () => {
    expect(await installs.saveInstallLook(store, live, owner, { css: "" })).toEqual({
      ok: false,
      problems: ["This theme is live: change it in Design settings, where its changes reach visitors at once."],
    });
    expect(await installs.saveInstallLook(store, kept, stranger, { css: "" })).toEqual({ ok: false, problems: ["You do not work in this store."] });
    expect((await installs.saveInstallLook(store, kept, owner, { css: "</style><script>" })).ok).toBe(false);
    expect((await installs.saveInstallLook(store, kept, owner, { theme: { base: "nope" } })).ok).toBe(false);
    expect((await installs.saveInstallLook(store, "00000000-0000-4000-8000-000000000000", owner, { css: "" })).ok).toBe(false);
  });
});

describe("previewing an installed theme (D244)", () => {
  it("reads the theme's own layouts and the store's published pages, and nothing of another store", async () => {
    const shown = await preview.installPreview(store, kept);
    expect(shown?.header?.id).toBe(header);
    expect(shown?.footer).toBeNull();
    expect(shown?.css).toBe(".calm { color: #123456; }");
    expect(shown?.pages.some((page) => page.title === `promo-${run}`)).toBe(true);
    const page = shown!.pages.find((p) => p.title === `promo-${run}`)!;
    expect((await preview.previewPageContent(store, page.id))?.rows[0]?.sectionStyle).toBe("promo");
    const other = String((await one(sql`select id from commerce.stores where slug = ${`try-x-${run}`}`)).id);
    expect(await preview.installPreview(other, kept)).toBeNull();
    expect(await preview.previewPageContent(other, page.id)).toBeNull();
  });
});

describe("What changes (D244)", () => {
  it("is read from the store's own pages, and is not offered for the live theme", async () => {
    const result = await preview.whatChangesFor(store, kept);
    expect(result?.target).toBe("Calm");
    expect(result?.changes.lines).toContain(`The header changes from the standard header to “calm-header-${run}”.`);
    expect(result?.changes.lines).toContain("1 page uses the section style Promo; “Calm” does not have it, so those rows take its Plain style.");
    // Calm has its own CSS (saved above), so the summary asks for a look at the preview.
    expect(result?.changes.css.target).toBe(true);
    expect(result?.changes.lines).toContain("CSS written for one layout may not fit another: look at the preview before you switch.");
    expect(await preview.whatChangesFor(store, live)).toBeNull();
  });
});
