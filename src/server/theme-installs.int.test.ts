import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { pageInput } from "@/lib/page-content";
import { defaultHeader } from "@/lib/site-layout";
import { templateSettings } from "@/lib/theme";

vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const installs = await import("./theme-installs");

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];

let owner: string;
let stranger: string;
let store: string;

/** A store owned by the account with this email (an approved request). */
async function storeOf(email: string, slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}

async function accountId(email: string): Promise<string> {
  return String((await one(sql`select id from commerce.accounts where lower(email) = lower(${email})`)).id);
}

async function headerPage(slug: string, published: boolean): Promise<string> {
  const parsed = pageInput.safeParse({ ...defaultHeader(store, { header: null, footer: null }), slug });
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message);
  const json = JSON.stringify(parsed.data);
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
    values (${store}::uuid, 'header', ${slug}, ${json}::jsonb, ${published ? sql`${json}::jsonb` : sql`null`}, ${published ? sql`now()` : sql`null`}, ${published ? sql`now()` : sql`null`})
    returning id
  `);
  return String(page.id);
}

const look = (theme: unknown, extra: Record<string, unknown> = {}) => JSON.stringify({ theme, css: "", headerId: null, footerId: null, productLayoutId: null, ...extra });
const storeLook = async () => one(sql`select theme, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${store}::uuid`);

beforeAll(async () => {
  store = await storeOf(`installs-${run}@example.com`, `installs-${run}`);
  owner = await accountId(`installs-${run}@example.com`);
  await storeOf(`stranger-${run}@example.com`, `stranger-${run}`);
  stranger = await accountId(`stranger-${run}@example.com`);
});

afterAll(async () => {
  await closeDb();
});

describe("a store's installed themes (D241)", () => {
  it("start as its own look, live, read through liveLook() as the store's columns", async () => {
    const list = await installs.listInstalls(store);
    expect(list.map((i) => [i.title, i.live, i.presetId])).toEqual([["Custom", true, null]]);
    const live = await installs.liveLook(store);
    const columns = await storeLook();
    expect(live).toMatchObject({ installId: list[0].id, title: "Custom", theme: columns.theme, css: columns.custom_css ?? "" });
  });

  it("switch in one go: the live one is put away with every change made to it, the other's look checked as it goes in", async () => {
    const shown = await headerPage(`shown-${run}`, true);
    const hidden = await headerPage(`hidden-${run}`, false);
    const bold = { base: "bold", savedId: "00000000-0000-4000-8000-000000000000", settings: templateSettings("bold") };
    const [kept] = await db().execute<Row>(sql`
      insert into commerce.store_theme_installs (store_id, title, look)
      values (${store}::uuid, 'Bold', ${look(bold, { css: ".a { color: red }", headerId: shown, footerId: hidden })}::jsonb) returning id
    `);
    // The owner changes the live look first; switching away keeps that change.
    await db().execute(sql`update commerce.stores set custom_css = '.mine { margin: 0 }' where id = ${store}::uuid`);
    const before = await storeLook();

    const done = await installs.switchToInstall(store, String(kept.id), owner);
    expect(done).toMatchObject({ ok: true, title: "Bold", from: "Custom", notes: ["Its footer is no longer published, so the standard one is shown."] });
    const after = await storeLook();
    expect(after).toMatchObject({ custom_css: ".a { color: red }", header_id: shown, footer_id: null });
    // A saved theme that is not the store's is let go (D60).
    expect(after.theme).toMatchObject({ base: "bold", savedId: null });
    const custom = await one(sql`select look, live from commerce.store_theme_installs where store_id = ${store}::uuid and title = 'Custom'`);
    expect(custom.live).toBe(false);
    expect(custom.look).toMatchObject({ theme: before.theme, css: ".mine { margin: 0 }" });

    // And back: the change made to Custom is there again.
    const customId = (await installs.listInstalls(store)).find((i) => i.title === "Custom")!.id;
    expect(await installs.switchToInstall(store, customId, owner)).toMatchObject({ ok: true, title: "Custom", from: "Bold" });
    expect(await storeLook()).toMatchObject({ custom_css: ".mine { margin: 0 }", theme: before.theme });
    expect((await installs.listInstalls(store))[0]).toMatchObject({ title: "Custom", live: true });
    const audit = await one(sql`select area, target_type from commerce.audit_log where action = 'store.theme_switched' and store_id = ${store}::uuid limit 1`);
    expect(audit).toMatchObject({ area: "website", target_type: "theme_install" });
  });

  it("refuse switching to the live one, another store's or by someone who does not work in the store", async () => {
    const list = await installs.listInstalls(store);
    const live = list.find((i) => i.live)!;
    const other = list.find((i) => !i.live)!;
    expect(await installs.switchToInstall(store, live.id, owner)).toEqual({ ok: false, problems: ["That theme is live already."] });
    expect(await installs.switchToInstall(store, other.id, stranger)).toEqual({ ok: false, problems: ["You do not work in this store."] });
    const elsewhere = (await one(sql`select i.id from commerce.store_theme_installs i join commerce.stores s on s.id = i.store_id where s.slug = ${`stranger-${run}`}`)).id;
    expect(await installs.switchToInstall(store, String(elsewhere), owner)).toEqual({ ok: false, problems: ["That theme is not installed in this store."] });
  });

  it("remove only one that is not live, keeping the pages it chose", async () => {
    const list = await installs.listInstalls(store);
    expect(await installs.removeInstall(store, list.find((i) => i.live)!.id, owner)).toEqual({ ok: false, problems: ["Only a theme that is not live can be removed."] });
    const pages = (await one(sql`select count(*)::int as n from commerce.pages where store_id = ${store}::uuid`)).n;
    expect(await installs.removeInstall(store, list.find((i) => !i.live)!.id, owner)).toEqual({ ok: true, title: "Bold" });
    expect((await installs.listInstalls(store)).map((i) => i.title)).toEqual(["Custom"]);
    expect((await one(sql`select count(*)::int as n from commerce.pages where store_id = ${store}::uuid`)).n).toBe(pages);
  });

  it("are not changed in a store that is not open", async () => {
    const [kept] = await db().execute<Row>(sql`insert into commerce.store_theme_installs (store_id, title, look) values (${store}::uuid, 'Later', ${look({})}::jsonb) returning id`);
    await db().execute(sql`update commerce.stores set status = 'suspended' where id = ${store}::uuid`);
    try {
      expect(await installs.switchToInstall(store, String(kept.id), owner)).toEqual({ ok: false, problems: ["The store is not open, so its look cannot be changed."] });
    } finally {
      await db().execute(sql`update commerce.stores set status = 'active' where id = ${store}::uuid`);
    }
  });
});

describe("the page migration's dry run (D241, docs/theme-store.md 4.4)", () => {
  it("counts a store's page settings and changes nothing", async () => {
    const { detachDryRun } = await import("./theme-detach");
    const before = await db().execute<Row>(sql`select id, draft, published from commerce.pages where store_id = ${store}::uuid order by id`);
    const report = await detachDryRun(store);
    expect(report).not.toBeNull();
    expect(report!.unreadable).toBe(0);
    expect(report!.followed + report!.own).toBe(report!.pages.reduce((sum, page) => sum + page.followed + page.own, 0));
    expect(await db().execute<Row>(sql`select id, draft, published from commerce.pages where store_id = ${store}::uuid order by id`)).toEqual(before);
    expect(await detachDryRun("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("putting back the look from before after switching by hand (D241)", () => {
  it("marks the use put back without switching again, so the next press goes one theme further back", async () => {
    const [preset] = await db().execute<Row>(sql`
      insert into commerce.design_presets (title, snapshot, published) values (${`Hand ${run}`}, '{"v":1,"theme":{"base":"minimal","settings":{}},"header":null,"footer":null,"productLayout":null,"css":""}'::jsonb, true) returning id
    `);
    const custom = (await installs.listInstalls(store)).find((i) => i.live)!;
    // As applying leaves it: the profile's install live, the look before put away and named by the use.
    const [made] = await db().execute<Row>(sql`
      insert into commerce.store_theme_installs (store_id, preset_id, title, look) values (${store}::uuid, ${String(preset.id)}::uuid, 'Hand', ${look({})}::jsonb) returning id
    `);
    expect(await installs.switchToInstall(store, String(made.id), owner)).toMatchObject({ ok: true });
    await db().execute(sql`
      insert into commerce.design_preset_uses (store_id, preset_id, previous, applied_by, install_id, previous_install_id)
      values (${store}::uuid, ${String(preset.id)}::uuid, '{}'::jsonb, ${owner}::uuid, ${String(made.id)}::uuid, ${custom.id}::uuid)
    `);
    // The owner switches back by hand, then presses Put back.
    expect(await installs.switchToInstall(store, custom.id, owner)).toMatchObject({ ok: true });
    const { restoreDesignLook } = await import("./design-presets");
    expect(await restoreDesignLook(store, owner)).toMatchObject({ ok: true });
    expect((await installs.listInstalls(store))[0]).toMatchObject({ id: custom.id, live: true });
    expect((await one(sql`select restored_at from commerce.design_preset_uses where install_id = ${String(made.id)}::uuid`)).restored_at).not.toBeNull();
  });
});
