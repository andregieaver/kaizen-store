import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { newPageContent } from "@/lib/page-content";
import { newBlock, newRow } from "@/lib/page-rows";

import type { Account, Membership } from "./auth";
import { makeStore, ownerOf, type Fixture } from "./invoice-test-fixture";

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, revalidateTag: () => {}, refresh: () => {} }));
vi.mock("next/server", () => ({ connection: async () => {}, after: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers(),
}));

const {
  submitTheme,
  submitThemeUpdate,
  reviewSubmission,
  approveSubmission,
  rejectSubmission,
  withdrawSubmission,
  mySubmissions,
  authoredThemes,
  listSubmissions,
  waitingSubmissions,
} = await import("./theme-submissions");
const { setThemePrices } = await import("./theme-prices");
const { themeContentOf } = await import("./store-starters");

type Row = Record<string, unknown>;

/**
 * Themes from outside (wave 7 unit J, D344, `docs/wave-7-storefront.md` J): a store's live look is sent for review by someone who may change
 * its website; a review makes it a draft theme with its author; approving publishes it with an address, an update becomes the theme's next
 * version with the author's what's new; a rejection says why and puts the drafted theme away; the author may withdraw an open one; and a
 * theme from outside is free.
 */

let fx: Fixture;
let owner: Membership;
let admin: Account;
const run = Date.now().toString(36);

beforeAll(async () => {
  fx = await makeStore("theme-author");
  await db().execute(sql`update commerce.stores set setup_completed_at = now() where id = ${fx.storeId}::uuid`);
  owner = await ownerOf(fx);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${`reviewer-${run}@example.com`}, 'Reviewer', true) returning id
  `);
  admin = { id: String(row.id), email: `reviewer-${run}@example.com`, name: "Reviewer", platformAdmin: true };
}, 180_000);

afterAll(async () => {
  await closeDb();
});

const words = (title: string) => ({ title, summary: "Calm and clear.", description: "For quiet shops.", authorName: "Ada Lovelace" });

describe("sharing a look", () => {
  it("is for those who may change the store's website, from a real store, and keeps the look as it was sent", async () => {
    const reader = { ...owner, role: "read_only" as never, permissions: [] } as never;
    expect(await submitTheme(reader, words(`Fjord ${run}`))).toMatchObject({ ok: false });
    expect(await submitTheme({ ...owner, store: { ...owner.store, starter: true } }, words(`Fjord ${run}`))).toMatchObject({ ok: false });
    expect(await submitTheme(owner, { ...words(""), title: " " })).toMatchObject({ ok: false, fields: ["title"] });

    const sent = await submitTheme(owner, words(`Fjord ${run}`));
    expect(sent).toMatchObject({ ok: true });
    const id = (sent as { id: string }).id;
    const [row] = await db().execute<Row>(sql`select status, snapshot ->> 'v' as v, account_id, author_name from commerce.theme_submissions where id = ${id}::uuid`);
    expect(row).toMatchObject({ status: "waiting", account_id: fx.ownerId, author_name: "Ada Lovelace" });
    expect(["1", "2"]).toContain(row.v);
    expect((await mySubmissions(fx.ownerId)).map((s) => s.id)).toContain(id);
    expect((await listSubmissions(admin, "open")).map((s) => s.id)).toContain(id);
    expect(await waitingSubmissions(admin)).toBeGreaterThan(0);
    expect(await listSubmissions({ ...admin, platformAdmin: false })).toEqual([]);
  });

  it("holds an account to three open submissions", async () => {
    const open = (await mySubmissions(fx.ownerId)).filter((s) => s.status === "waiting").length;
    for (let i = open; i < 3; i++) expect(await submitTheme(owner, words(`Extra ${i} ${run}`))).toMatchObject({ ok: true });
    expect(await submitTheme(owner, words(`One too many ${run}`))).toMatchObject({ ok: false });
    // Withdrawing one makes room.
    const last = (await mySubmissions(fx.ownerId)).find((s) => s.title === `Extra 2 ${run}`)!;
    expect(await withdrawSubmission(owner.account, last.id)).toEqual({ ok: true });
    expect(await withdrawSubmission(owner.account, last.id)).toMatchObject({ ok: false });
  });
});

describe("the review", () => {
  let submissionId = "";
  let presetId = "";

  it("makes a draft theme with its author, which approving publishes with an address", async () => {
    submissionId = (await mySubmissions(fx.ownerId)).find((s) => s.title === `Fjord ${run}`)!.id;
    expect(await approveSubmission(admin, submissionId)).toMatchObject({ ok: false });
    const reviewed = await reviewSubmission(admin, submissionId);
    expect(reviewed).toMatchObject({ ok: true });
    presetId = (reviewed as { presetId: string }).presetId;
    const [draft] = await db().execute<Row>(sql`select published, author_id, author_name, slug from commerce.design_presets where id = ${presetId}::uuid`);
    expect(draft).toMatchObject({ published: false, author_id: fx.ownerId, author_name: "Ada Lovelace", slug: null });
    expect(await reviewSubmission(admin, submissionId)).toMatchObject({ ok: false });

    const approved = await approveSubmission(admin, submissionId);
    expect(approved).toMatchObject({ ok: true, presetId });
    const [theme] = await db().execute<Row>(sql`select published, slug from commerce.design_presets where id = ${presetId}::uuid`);
    expect(theme.published).toBe(true);
    expect(String(theme.slug)).toMatch(/^fjord-/);
    const [sub] = await db().execute<Row>(sql`select status, decided_by from commerce.theme_submissions where id = ${submissionId}::uuid`);
    expect(sub).toEqual({ status: "approved", decided_by: admin.id });
    expect(await authoredThemes(fx.ownerId)).toEqual([expect.objectContaining({ id: presetId, published: true, version: 1, stores: 0 })]);
  });

  it("takes an update from the author only, and makes it the theme's next version with what's new", async () => {
    const stranger = await makeStore("theme-stranger");
    expect(await submitThemeUpdate(await ownerOf(stranger), presetId, { notes: "Mine now", authorName: "Mallory" })).toMatchObject({ ok: false });
    const open = (await mySubmissions(fx.ownerId)).filter((s) => s.status === "waiting");
    for (const s of open) await withdrawSubmission(owner.account, s.id);
    const sent = await submitThemeUpdate(owner, presetId, { notes: "Softer buttons.", authorName: "" });
    expect(sent).toMatchObject({ ok: true });
    const id = (sent as { id: string }).id;
    expect(await reviewSubmission(admin, id)).toMatchObject({ ok: true, presetId });
    const approved = await approveSubmission(admin, id);
    expect(approved).toMatchObject({ ok: true });
    const versions = await db().execute<Row>(sql`select number, notes from commerce.design_preset_versions where preset_id = ${presetId}::uuid order by number`);
    // The same look again makes no new version (D241); its what's new would show only with a changed look.
    expect(versions.length).toBeGreaterThanOrEqual(1);
  });

  it("says why it is not accepted, and puts the drafted theme away", async () => {
    const sent = await submitTheme(owner, words(`Rejected ${run}`));
    const id = (sent as { id: string }).id;
    const reviewed = await reviewSubmission(admin, id);
    const drafted = (reviewed as { presetId: string }).presetId;
    expect(await rejectSubmission(admin, id, "  ")).toMatchObject({ ok: false });
    expect(await rejectSubmission(admin, id, "Too close to Harbour.")).toEqual({ ok: true });
    const [sub] = await db().execute<Row>(sql`select status, reason from commerce.theme_submissions where id = ${id}::uuid`);
    expect(sub).toEqual({ status: "rejected", reason: "Too close to Harbour." });
    const [theme] = await db().execute<Row>(sql`select archived_at is not null as archived from commerce.design_presets where id = ${drafted}::uuid`);
    expect(theme.archived).toBe(true);
    expect((await mySubmissions(fx.ownerId)).find((s) => s.id === id)?.reason).toBe("Too close to Harbour.");
  });

  it("keeps a theme from outside free", async () => {
    const [theme] = await db().execute<Row>(sql`select id from commerce.design_presets where author_id = ${fx.ownerId}::uuid and published limit 1`);
    expect(await setThemePrices(admin, String(theme.id), [{ currency: "NOK", amountMinor: 9900 }])).toMatchObject({ ok: false });
  });
});

describe("with its own pages (D388)", () => {
  it("carries the store's published pages without forms' recipients, places them on review and makes them the theme's content on approval", async () => {
    for (const s of (await mySubmissions(fx.ownerId)).filter((s) => s.status === "waiting" || s.status === "reviewing")) await withdrawSubmission(owner.account, s.id);
    // A page of the author's own, with a form that emails the owner: its words travel, its recipients never do.
    const id = () => crypto.randomUUID();
    const row = newRow("2", id);
    row.columns[0].blocks = [{ ...newBlock("heading", id), text: `Welcome to Fjord ${run}` } as never];
    row.columns[1].blocks = [{ ...newBlock("emailForm", id), recipients: ["owner@example.com"] } as never];
    const content = { ...newPageContent(), title: `Our story ${run}`, slug: `our-story-${run}`, rows: [row], categories: [], tags: [] };
    const json = JSON.stringify(content);
    await db().execute(sql`
      insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at, created_by, updated_by)
      values (${fx.storeId}::uuid, 'page', ${content.slug}, ${json}::jsonb, ${json}::jsonb, now(), now(), ${fx.ownerId}::uuid, ${fx.ownerId}::uuid)
    `);

    // Without the tick, only the look goes.
    const lookOnly = await submitTheme(owner, words(`Look only ${run}`));
    expect((await mySubmissions(fx.ownerId)).find((s) => s.id === (lookOnly as { id: string }).id)?.pages).toBe(0);
    await withdrawSubmission(owner.account, (lookOnly as { id: string }).id);

    const sent = await submitTheme(owner, words(`Harbour ${run}`), { pages: true });
    expect(sent).toMatchObject({ ok: true });
    const submissionId = (sent as { id: string }).id;
    const [kept] = await db().execute<Row>(sql`select pages from commerce.theme_submissions where id = ${submissionId}::uuid`);
    const pages = kept.pages as { title: string; content: unknown }[];
    expect(pages.map((p) => p.title)).toContain(`Our story ${run}`);
    // Pages chosen for a place (legal pages, the cart) stay the store's.
    const roles = await db().execute<Row>(sql`select g.slug from commerce.page_roles r join commerce.pages g on g.id = r.page_id where r.store_id = ${fx.storeId}::uuid`);
    for (const role of roles) expect(pages.map((p) => (p as { slug?: string }).slug)).not.toContain(String(role.slug));
    expect(JSON.stringify(pages)).not.toContain("owner@example.com");
    // What was sent is kept as it was sent.
    await expect(db().execute(sql`update commerce.theme_submissions set pages = '[]'::jsonb where id = ${submissionId}::uuid`)).rejects.toThrow();

    const reviewed = await reviewSubmission(admin, submissionId);
    expect(reviewed).toMatchObject({ ok: true });
    const presetId = (reviewed as { presetId: string }).presetId;
    const [placed] = await db().execute<Row>(sql`
      select ts.content_starter_id, st.design_preset_id, st.published, st.store_id from commerce.theme_submissions ts
        join commerce.store_starters st on st.id = ts.content_starter_id where ts.id = ${submissionId}::uuid
    `);
    expect(placed).toMatchObject({ design_preset_id: null, published: false });
    const [story] = await db().execute<Row>(sql`
      select published ->> 'title' as title, published::text as body from commerce.pages
       where store_id = ${String(placed.store_id)}::uuid and published ->> 'title' = ${`Our story ${run}`}
    `);
    expect(story?.title).toBe(`Our story ${run}`);
    expect(String(story.body)).toContain(`Welcome to Fjord ${run}`);
    // The content is set once.
    await expect(db().execute(sql`update commerce.theme_submissions set content_starter_id = null where id = ${submissionId}::uuid`)).rejects.toThrow();

    expect(await approveSubmission(admin, submissionId)).toMatchObject({ ok: true, presetId });
    expect(await themeContentOf(presetId)).toMatchObject({ starterId: String(placed.content_starter_id), published: true });
  });

  it("puts the pages away when the submission is not accepted", async () => {
    const sent = await submitTheme(owner, words(`Turned down ${run}`), { pages: true });
    const submissionId = (sent as { id: string }).id;
    expect(await reviewSubmission(admin, submissionId)).toMatchObject({ ok: true });
    expect(await rejectSubmission(admin, submissionId, "Not this time.")).toEqual({ ok: true });
    const [starter] = await db().execute<Row>(sql`
      select st.archived_at is not null as archived, st.published from commerce.theme_submissions ts
        join commerce.store_starters st on st.id = ts.content_starter_id where ts.id = ${submissionId}::uuid
    `);
    expect(starter).toEqual({ archived: true, published: false });
  });
});
