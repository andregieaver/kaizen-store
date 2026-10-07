import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseDesignDetails, type DesignDetails } from "@/lib/design-presets";
import { pageInput, type PageBlock, type PageContent } from "@/lib/page-content";
import { newBlock } from "@/lib/page-rows";
import { DEFAULT_PRODUCT_LAYOUT } from "@/lib/product-layout";
import { parseStarterDetails } from "@/lib/store-starters";
import { defaultFooter, defaultHeader } from "@/lib/site-layout";
import { parseStoreTheme, templateSettings } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {} }));

const designs = await import("./design-presets");
const starters = await import("./store-starters");
const { approveAccessRequest, createAccessRequest, createStoreForOwner } = await import("./platform");

type Row = Record<string, unknown>;

const run = Date.now().toString(36);
const STORAGE = `https://x.supabase.co/storage/v1/object/public/product-images/source-${run}/hero.webp`;
let admin: Account;
let owner: Account;
let stranger: Account;
let source: { id: string; slug: string; headerMenu: string; footerMenu: string; headerPage: string };
let target: { id: string; slug: string; headerMenu: string; footerMenu: string; oldHeader: string };
let presetId: string;

const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const details = (title: string): DesignDetails => {
  const parsed = parseDesignDetails({ title, summary: "Pale wood and deep green." });
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  return parsed.details;
};
/** Storage's copy, in tests: a new public address under the target's folder. */
const copyFile = async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`;
const fontsAsked: string[][] = [];
const deps = {
  copyFile,
  installFonts: async (families: string[]) => {
    fontsAsked.push(families);
    return { ok: true as const };
  },
};

async function account(email: string, name: string, platformAdmin = false): Promise<Account> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.accounts (email, name, platform_admin) values (${email}, ${name}, ${platformAdmin}) returning id, email
  `);
  return { id: String(row.id), email: String(row.email), name, platformAdmin };
}

/** A store owned by `who` (an approved request), with a header and a footer menu of its own. */
async function storeOf(who: string, slug: string): Promise<{ id: string; slug: string; headerMenu: string; footerMenu: string }> {
  const [request] = await db().execute<Row>(sql`
    insert into commerce.access_requests (email, name, store_name) values (${who}, 'Owner', ${slug}) returning id
  `);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  const storeId = String(id);
  const [header] = await db().execute<Row>(sql`insert into commerce.menus (store_id, name, items) values (${storeId}::uuid, ${`Top ${run}`}, '[]') returning id`);
  const [footer] = await db().execute<Row>(sql`insert into commerce.menus (store_id, name, items) values (${storeId}::uuid, ${`Bottom ${run}`}, '[]') returning id`);
  await db().execute(sql`update commerce.stores set header_menu_id = ${String(header.id)}::uuid, footer_menu_id = ${String(footer.id)}::uuid where id = ${storeId}::uuid`);
  return { id: storeId, slug, headerMenu: String(header.id), footerMenu: String(footer.id) };
}

/** A published page of the store's, chosen in `column`. */
async function choose(storeId: string, type: string, slug: string, content: PageContent, column: "header_id" | "footer_id" | "product_layout_id"): Promise<string> {
  const parsed = pageInput.safeParse({ ...content, slug });
  if (!parsed.success) throw new Error(parsed.error.issues.map((i) => i.message).join(" "));
  const json = JSON.stringify(parsed.data);
  const [page] = await db().execute<Row>(sql`
    insert into commerce.pages (store_id, type, slug, draft, published, published_at, first_published_at)
    values (${storeId}::uuid, ${type}, ${slug}, ${json}::jsonb, ${json}::jsonb, now(), now()) returning id
  `);
  await db().execute(sql`update commerce.stores set ${sql.raw(column)} = ${String(page.id)}::uuid where id = ${storeId}::uuid`);
  return String(page.id);
}

let n = 0;
const id = () => `blk-${run}-${(n += 1)}`;

beforeAll(async () => {
  admin = await account(`designer-${run}@example.com`, "Designer", true);
  owner = await account(`owner-${run}@example.com`, "Kari");
  stranger = await account(`stranger-${run}@example.com`, "Ola");
  // The fonts the profile names are on Kaizen already: nothing is fetched from Google in a test.
  for (const family of ["Playfair Display", "Lora"]) {
    await db().execute(sql`
      insert into commerce.fonts (family, slug, category, css, bytes) values (${family}, ${family.toLowerCase().replace(/\s+/g, "-")}, 'serif', '', 0)
      on conflict (family) do nothing
    `);
  }

  // The store the look is taken from: the admin's, with a warm theme, its own header, footer, product layout and CSS.
  const src = await storeOf(admin.email, `look-${run}`);
  const settings = { ...templateSettings("warm"), light: { ...templateSettings("warm").light, accent: "#2f6f4e" } };
  await db().execute(sql`
    update commerce.stores set theme = ${JSON.stringify({ base: "warm", savedId: null, settings })}::jsonb,
      custom_css = '.site-header { letter-spacing: .02em }'
    where id = ${src.id}::uuid
  `);
  const header = defaultHeader(src.id, { header: src.headerMenu, footer: src.footerMenu });
  const extra: PageBlock[] = [
    { ...(newBlock("button", id) as Extract<PageBlock, { type: "button" }>), label: "Book", href: `/s/${src.slug}/no/p/massage` },
    { ...(newBlock("image", id) as Extract<PageBlock, { type: "image" }>), image: { url: STORAGE, width: 800, height: 400, alt: "Ferns" } },
  ];
  const headerPage = await choose(
    src.id,
    "header",
    `calm-header-${run}`,
    { ...header, css: ".site-header { padding-block: 4px }", rows: [...header.rows, { id: id(), type: "row", layout: "1", columns: [{ id: id(), blocks: extra }] }] },
    "header_id",
  );
  await choose(src.id, "footer", `calm-footer-${run}`, defaultFooter(src.id, { header: src.headerMenu, footer: src.footerMenu }), "footer_id");
  await choose(src.id, "product_layout", `calm-layout-${run}`, { ...DEFAULT_PRODUCT_LAYOUT, title: "Calm product" }, "product_layout_id");
  await db().execute(sql`
    insert into commerce.media (store_id, kind, url, bucket, path, file_name, content_type, size_bytes, width, height)
    values (${src.id}::uuid, 'image', ${STORAGE}, 'product-images', ${`source-${run}/hero.webp`}, 'hero.webp', 'image/webp', 1000, 800, 400)
  `);
  source = { ...src, headerPage };

  // The store it is applied to: the owner's, with a logo and a header of its own.
  const tgt = await storeOf(owner.email, `shop-${run}`);
  await db().execute(sql`
    update commerce.stores set navigation = ${JSON.stringify({ logo: { url: "https://example.com/logo.png", width: 200, height: 80 } })}::jsonb
    where id = ${tgt.id}::uuid
  `);
  const oldHeader = await choose(tgt.id, "header", `own-header-${run}`, defaultHeader(tgt.id, { header: tgt.headerMenu, footer: tgt.footerMenu }), "header_id");
  target = { ...tgt, oldHeader };
  // Someone who owns another store, not this one.
  await storeOf(stranger.email, `other-${run}`);
});

afterAll(async () => {
  await closeDb();
});

describe("a platform admin makes a design profile from a store (D176)", () => {
  it("refuses anyone who does not run the platform, and a store the admin does not work in", async () => {
    expect(await designs.createDesign(owner, { origin: { kind: "store", storeId: target.id }, details: details("Nope") }, deps)).toMatchObject({ ok: false });
    expect(await designs.createDesign(admin, { origin: { kind: "store", storeId: target.id }, details: details("Nope") }, deps)).toEqual({
      ok: false,
      problems: ["Choose a store you work in."],
    });
  });

  it("keeps the store's look in its workspace, unpublished and last, with nothing in it that points into the store", async () => {
    const result = await designs.createDesign(admin, { origin: { kind: "store", storeId: source.id }, details: details(`Nordic calm ${run}`) }, deps);
    expect(result).toMatchObject({ ok: true });
    presetId = (result as { id: string }).id;
    const row = await one(sql`
      select snapshot, published, source_store_id, workspace_store_id, workspace_key, position from commerce.design_presets where id = ${presetId}::uuid
    `);
    expect(row.published).toBe(false);
    // The look is edited in the profile's workspace (D177), whose library its pictures are copied into; the store is not touched.
    expect(row.workspace_store_id).not.toBeNull();
    expect(row.source_store_id).toBe(row.workspace_store_id);
    expect(row.workspace_key).toMatch(/^[0-9a-f]{64}$/);
    const json = JSON.stringify(row.snapshot);
    for (const foreign of [source.id, source.headerMenu, source.footerMenu, source.headerPage, `/s/${source.slug}`, STORAGE]) expect(json).not.toContain(foreign);
    expect(json).toContain(`/product-images/${String(row.workspace_store_id)}/`);
    const snapshot = row.snapshot as { theme: { settings: { light: { accent: string } } }; css: string; header: object; footer: object; productLayout: object };
    expect(snapshot.theme.settings.light.accent).toBe("#2f6f4e");
    expect(snapshot.css).toContain("letter-spacing");
    expect(snapshot.header && snapshot.footer && snapshot.productLayout).toBeTruthy();
    const audit = await one(sql`select count(*)::int as n from commerce.audit_log where action = 'platform.design_preset_created' and store_id = ${source.id}::uuid`);
    expect(audit.n).toBe(1);
  });
});

describe("applying a design profile (D176)", () => {
  it("is refused to an owner while the profile is unpublished", async () => {
    expect(await designs.applyDesignPreset(target.id, presetId, owner.id, deps)).toEqual({
      ok: false,
      problems: ["That design profile is not offered any more. Choose another."],
    });
    expect(await designs.publishDesign(admin, presetId)).toMatchObject({ ok: true });
  });

  it("is refused for a store the account does not work in, and for a store that is not open", async () => {
    expect(await designs.applyDesignPreset(target.id, presetId, stranger.id, deps)).toEqual({ ok: false, problems: ["You do not work in this store."] });
    const closed = await storeOf(owner.email, `closed-${run}`);
    await db().execute(sql`update commerce.stores set status = 'closed' where id = ${closed.id}::uuid`);
    expect(await designs.applyDesignPreset(closed.id, presetId, owner.id, deps)).toEqual({
      ok: false,
      problems: ["The store is not open, so its look cannot be changed."],
    });
  });

  it("changes the look, keeps the brand and the store's own pages, and keeps the look from before as a saved theme", async () => {
    const before = await one(sql`select theme, name, navigation, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${target.id}::uuid`);
    const result = await designs.applyDesignPreset(target.id, presetId, owner.id, deps);
    expect(result).toMatchObject({ ok: true });
    const after = await one(sql`select theme, name, navigation, custom_css, header_id, footer_id, product_layout_id from commerce.stores where id = ${target.id}::uuid`);

    // The theme is the profile's; the name and logo are the store's own.
    expect(parseStoreTheme(after.theme).settings.light.accent).toBe("#2f6f4e");
    expect(parseStoreTheme(after.theme).base).toBe("warm");
    expect(after.name).toBe(before.name);
    expect(after.navigation).toEqual(before.navigation);
    expect(after.custom_css).toBe(".site-header { letter-spacing: .02em }");

    // New pages, published and chosen; the store's own header is still there, unchosen.
    for (const [column, type] of [["header_id", "header"], ["footer_id", "footer"], ["product_layout_id", "product_layout"]] as const) {
      expect(after[column]).not.toBeNull();
      expect(after[column]).not.toBe(before[column]);
      const page = await one(sql`select type, published_at, store_id from commerce.pages where id = ${String(after[column])}::uuid`);
      expect([page.type, String(page.store_id), page.published_at !== null]).toEqual([type, target.id, true]);
    }
    expect((await one(sql`select count(*)::int as n from commerce.pages where id = ${target.oldHeader}::uuid`)).n).toBe(1);

    // Nothing in the new pages points at the source store: no id, no menu, no link, no file of its.
    const pages = await db().execute<Row>(sql`
      select published from commerce.pages where id in (${String(after.header_id)}::uuid, ${String(after.footer_id)}::uuid, ${String(after.product_layout_id)}::uuid)
    `);
    const json = JSON.stringify(pages);
    for (const foreign of [source.id, source.headerMenu, source.footerMenu, source.headerPage, `/s/${source.slug}`, STORAGE]) expect(json).not.toContain(foreign);
    // The menus are the store's own of the same role, and the picture its own copy in its library.
    expect(json).toContain(target.headerMenu);
    expect(json).toContain(target.footerMenu);
    const copied = await one(sql`select url from commerce.media where store_id = ${target.id}::uuid and file_name = 'hero.webp'`);
    expect(String(copied.url)).toContain(`/product-images/${target.id}/`);
    expect(json).toContain(String(copied.url));

    // The fonts were installed first.
    expect(fontsAsked.at(-1)).toEqual(expect.arrayContaining(["Playfair Display", "Lora"]));

    // The look before: a saved theme, and the use that can put it back.
    const ok = result as { savedTheme: string; useId: string };
    expect(ok.savedTheme).toMatch(/^Before Nordic calm/);
    const saved = await one(sql`select base, settings from commerce.store_themes where store_id = ${target.id}::uuid and name = ${ok.savedTheme}`);
    expect(saved.settings).toEqual(parseStoreTheme(before.theme).settings);
    const use = await one(sql`select previous, preset_id, applied_by from commerce.design_preset_uses where id = ${ok.useId}::uuid`);
    expect(use).toMatchObject({ preset_id: presetId, applied_by: owner.id });
    expect((use.previous as { headerId: string }).headerId).toBe(target.oldHeader);
    const audit = await one(sql`select area from commerce.audit_log where action = 'store.design_preset_applied' and store_id = ${target.id}::uuid`);
    expect(audit.area).toBe("website");
  });

  it("puts back the look from before, once", async () => {
    const result = await designs.restoreDesignLook(target.id, owner.id);
    expect(result).toMatchObject({ ok: true });
    const store = await one(sql`select theme, custom_css, header_id from commerce.stores where id = ${target.id}::uuid`);
    expect(parseStoreTheme(store.theme).settings.light.accent).toBe(templateSettings("minimal").light.accent);
    expect(String(store.header_id)).toBe(target.oldHeader);
    expect(store.custom_css).toBe("");
    expect(await designs.restoreDesignLook(target.id, owner.id)).toEqual({ ok: false, problems: ["There is no look from before to put back."] });
  });

  it("lets a platform admin try an unpublished profile on a store template, and on no other store", async () => {
    const draft = await designs.createDesign(admin, { origin: { kind: "store", storeId: source.id }, details: details(`Draft ${run}`) }, deps);
    const draftId = (draft as { id: string }).id;
    const starter = await starters.createStarter(admin, { slug: `tpl-${run}`, details: starterDetails() });
    const starterStore = String((await one(sql`select store_id from commerce.store_starters where id = ${(starter as { id: string }).id}::uuid`)).store_id);
    expect(await designs.applyDesignPreset(starterStore, draftId, admin.id, deps)).toMatchObject({ ok: true });
    expect(await designs.applyDesignPreset(target.id, draftId, admin.id, deps)).toMatchObject({ ok: false });
    // A published one, on any store, the owner's included.
    expect(await designs.applyDesignPreset(target.id, presetId, admin.id, deps)).toMatchObject({ ok: true });
    const audit = await one(sql`
      select details from commerce.audit_log where action = 'store.design_preset_applied' and store_id = ${target.id}::uuid and account_id = ${admin.id}::uuid
    `);
    expect(audit.details).toMatchObject({ byPlatform: true });
  });
});

function starterDetails() {
  const parsed = parseStarterDetails({ title: "Spa", summary: "Treatments", category: "appointments" });
  if (!parsed.ok) throw new Error(parsed.problems.join(" "));
  return parsed.details;
}

describe("choosing a design profile when a store is made (D176)", () => {
  it("applies the profile chosen when an owner creates a store, after the store template's copy", async () => {
    const result = await createStoreForOwner(owner, "Second", `second-${run}`, null, presetId);
    expect(result).toMatchObject({ ok: true, design: { problem: null } });
    const store = await one(sql`select id, theme from commerce.stores where slug = ${`second-${run}`}`);
    expect(parseStoreTheme(store.theme).settings.light.accent).toBe("#2f6f4e");
    expect((await one(sql`select count(*)::int as n from commerce.design_preset_uses where store_id = ${String(store.id)}::uuid`)).n).toBe(1);
  });

  it("refuses a profile that is not offered before making anything", async () => {
    const draft = await designs.createDesign(admin, { origin: { kind: "store", storeId: source.id }, details: details(`Hidden ${run}`) }, deps);
    expect(await createStoreForOwner(owner, "Third", `third-${run}`, null, (draft as { id: string }).id)).toEqual({
      ok: false,
      problems: ["That design profile is not offered any more. Choose another."],
    });
    expect((await one(sql`select count(*)::int as n from commerce.stores where slug = ${`third-${run}`}`)).n).toBe(0);
  });

  it("keeps a sign-up's choice on the request when published, and applies it when the request is approved", async () => {
    await createAccessRequest({ name: "Siri", email: `siri-${run}@example.com`, storeName: "Siri", message: "", designPresetId: presetId });
    const siri = await one(sql`select id, design_preset_id from commerce.access_requests where lower(email) = ${`siri-${run}@example.com`}`);
    expect(String(siri.design_preset_id)).toBe(presetId);
    const approved = await approveAccessRequest(admin, String(siri.id), `siri-${run}`, "Siri", "https://example.com");
    expect(approved).toMatchObject({ ok: true, design: { problem: null } });
    const store = await one(sql`select id, theme from commerce.stores where slug = ${`siri-${run}`}`);
    expect(parseStoreTheme(store.theme).settings.light.accent).toBe("#2f6f4e");
    const use = await one(sql`select applied_by from commerce.design_preset_uses where store_id = ${String(store.id)}::uuid`);
    expect(String(use.applied_by)).toBe(admin.id);

    const hidden = await designs.createDesign(admin, { origin: { kind: "store", storeId: source.id }, details: details(`Unpublished ${run}`) }, deps);
    await createAccessRequest({ name: "Per", email: `per-${run}@example.com`, storeName: "Per", message: "", designPresetId: (hidden as { id: string }).id });
    expect((await one(sql`select design_preset_id from commerce.access_requests where lower(email) = ${`per-${run}@example.com`}`)).design_preset_id).toBeNull();
  });

  it("lets the platform admin change the request's choice before approving", async () => {
    await createAccessRequest({ name: "Liv", email: `liv-${run}@example.com`, storeName: "Liv", message: "", designPresetId: presetId });
    const liv = await one(sql`select id from commerce.access_requests where lower(email) = ${`liv-${run}@example.com`}`);
    // The admin keeps the template's own look instead.
    expect(await approveAccessRequest(admin, String(liv.id), `liv-${run}`, "Liv", "https://example.com", undefined, null)).toMatchObject({ ok: true, design: null });
    expect((await one(sql`select count(*)::int as n from commerce.design_preset_uses u join commerce.stores s on s.id = u.store_id where s.slug = ${`liv-${run}`}`)).n).toBe(0);
  });

  it("keeps the store made, with its template's look, when the profile chosen cannot be applied", async () => {
    // A profile whose header holds what no store's page may (Kaizen's plans): readable, published, and refused by the page rules.
    const header = defaultHeader(null);
    const plans = { ...newBlock("plans", id), buttonLabel: "Start", buttonHref: "/sign-up" } as PageBlock;
    const snapshot = {
      v: 1,
      theme: { base: "bold", settings: templateSettings("bold") },
      header: { rows: [...header.rows, { id: id(), type: "row", layout: "1", columns: [{ id: id(), blocks: [plans] }] }], css: "", menus: {} },
      footer: null,
      productLayout: null,
      css: "",
    };
    const [broken] = await db().execute<Row>(sql`
      insert into commerce.design_presets (title, snapshot, published) values (${`Broken ${run}`}, ${JSON.stringify(snapshot)}::jsonb, true) returning id
    `);
    const result = await createStoreForOwner(owner, "Fourth", `fourth-${run}`, null, String(broken.id));
    expect(result).toMatchObject({ ok: true, slug: `fourth-${run}` });
    expect((result as { design: { problem: string } }).design.problem).toMatch(/header does not fit this store/);
    const store = await one(sql`select theme, header_id from commerce.stores where slug = ${`fourth-${run}`}`);
    expect(parseStoreTheme(store.theme).base).not.toBe("bold");
    expect(store.header_id).toBeNull();
  });

  it("offers a store template's recommended profile first, while both are published", async () => {
    const starter = await starters.createStarter(admin, { slug: `rec-${run}`, details: starterDetails() });
    const starterId = (starter as { id: string }).id;
    // The recommendation is one of the template's details (D177): a draft until the template is published.
    expect(await starters.saveStarterDraft(admin, starterId, { ...starterDetails(), recommendedDesign: presetId })).toEqual({ ok: true });
    expect((await designs.designChoices()).recommended[starterId]).toBeUndefined();
    expect(await starters.publishStarter(admin, starterId)).toMatchObject({ ok: true });
    expect((await designs.designChoices()).recommended[starterId]).toBe(presetId);
    await designs.unpublishDesign(admin, presetId);
    expect((await designs.designChoices()).recommended[starterId]).toBeUndefined();
    await designs.publishDesign(admin, presetId);
    expect(await starters.saveStarterDraft(owner, starterId, { ...starterDetails(), recommendedDesign: presetId })).toMatchObject({ ok: false });
  });
});

describe("the preview (D176)", () => {
  it("shows a published profile on the Standard store and refuses an unpublished one, unless a platform admin asks", async () => {
    expect(await designs.publicDesignPreview(presetId, null)).toMatchObject({ id: presetId, starterTitle: null });
    const hidden = await designs.createDesign(admin, { origin: { kind: "store", storeId: source.id }, details: details(`Secret ${run}`) }, deps);
    const hiddenId = (hidden as { id: string }).id;
    expect(await designs.publicDesignPreview(hiddenId, null)).toBeNull();
    expect(await designs.adminDesignPreview(hiddenId, null)).toMatchObject({ id: hiddenId });
    expect(await designs.publicDesignPreview("not-an-id", null)).toBeNull();
  });
});

describe("a design profile's workspace and its draft (D177)", () => {
  let scratch: string;
  let workspace: { id: string; slug: string };

  it("starts from scratch with Kaizen's standard look, in a workspace of its own", async () => {
    const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: details(`Scratch ${run}`) }, deps);
    expect(made).toMatchObject({ ok: true });
    scratch = (made as { id: string }).id;
    const row = await one(sql`
      select d.snapshot, d.published, w.id, w.slug, w.starter, w.theme, w.custom_css, w.header_id, w.footer_id, w.product_layout_id,
             (select count(*)::int from commerce.store_starters st where st.store_id = w.id) as described,
             (select count(*)::int from commerce.products p where p.store_id = w.id) as products
      from commerce.design_presets d join commerce.stores w on w.id = d.workspace_store_id where d.id = ${scratch}::uuid
    `);
    workspace = { id: String(row.id), slug: String(row.slug) };
    expect(row).toMatchObject({ published: false, starter: true, custom_css: "", header_id: null, footer_id: null, product_layout_id: null, described: 0 });
    // Copied from the default template, so the builders and previews have its demo products to draw.
    expect(Number(row.products)).toBeGreaterThan(0);
    expect(parseStoreTheme(row.theme)).toMatchObject({ base: "minimal", settings: templateSettings("minimal") });
    expect(row.snapshot).toMatchObject({ header: null, footer: null, productLayout: null, css: "", theme: { base: "minimal" } });
  });

  it("is never listed among anyone's stores, never a source of a look, and never changed by applying", async () => {
    const { listStores } = await import("./auth");
    const { listStoreBilling } = await import("./billing");
    const { workStoresFor } = await import("./work-owner");
    const seen = [
      ...(await listStores(admin)).map((s) => s.slug),
      ...(await designs.snapshotSources(admin)).map((s) => s.slug),
      ...(await listStoreBilling({ includeClosed: true })).map((s) => s.slug),
      ...(await starters.listStarters()).map((s) => s.storeSlug),
      ...(await starters.listOfferedStarters()).map((s) => s.storeSlug),
      ...Object.values(await workStoresFor(admin)).flatMap((list) => list.map((s: { slug: string }) => s.slug)),
    ];
    expect(seen).not.toContain(workspace.slug);
    expect(await designs.createDesign(admin, { origin: { kind: "store", storeId: workspace.id }, details: details("Loop") }, deps)).toEqual({
      ok: false,
      problems: ["Choose a store you work in."],
    });
    expect(await designs.applyDesignPreset(workspace.id, presetId, admin.id, deps)).toMatchObject({ ok: false, problems: [expect.stringMatching(/kept by the platform/)] });
    expect(await designs.restoreDesignLook(workspace.id, admin.id)).toMatchObject({ ok: false });
  });

  it("is reached only by a platform admin, for its own profile", async () => {
    expect(await designs.workspaceOf(owner, scratch)).toBeNull();
    expect(await designs.workspaceOf(admin, scratch)).toMatchObject({ presetId: scratch, store: workspace });
    expect(await designs.ensureWorkspace(owner, scratch)).toMatchObject({ ok: false });
    expect(await designs.chooseWorkspaceLayout(owner, scratch, "header", "build")).toMatchObject({ ok: false });
  });

  it("keeps changes as a draft: stores see the published profile until it is published again", async () => {
    expect(await designs.publishDesign(admin, scratch)).toMatchObject({ ok: true });
    expect((await designs.publicDesignPreview(scratch, null))?.snapshot.theme.base).toBe("minimal");
    // The admin builds a header and changes the theme in the workspace, and saves new details.
    const header = await designs.chooseWorkspaceLayout(admin, scratch, "header", "build");
    expect(header).toMatchObject({ ok: true, pageId: expect.any(String) });
    const { saveStoreTheme } = await import("./themes");
    expect(await saveStoreTheme(admin, workspace.id, { base: "bold", savedId: null, settings: templateSettings("bold") })).toMatchObject({ ok: true });
    expect(await designs.saveDesignDraft(admin, scratch, details(`Scratch bold ${run}`))).toEqual({ ok: true });

    const design = (await designs.getDesign(scratch))!;
    expect(await designs.designChanged(design)).toBe(true);
    expect(design.title).toBe(`Scratch ${run}`);
    expect(designs.shownDesignDetails(design).title).toBe(`Scratch bold ${run}`);
    // What stores see and apply is still the published profile; the admin's draft preview shows the workspace.
    expect((await designs.publicDesignPreview(scratch, null))).toMatchObject({ title: `Scratch ${run}`, snapshot: { header: null, theme: { base: "minimal" } }, draft: false });
    expect((await designs.adminDesignPreview(scratch, null, true))).toMatchObject({ title: `Scratch bold ${run}`, snapshot: { theme: { base: "bold" } }, draft: true });
    expect((await designs.adminDesignPreview(scratch, null, true))?.snapshot.header).not.toBeNull();
    expect((await designs.listOfferedDesigns()).find((d) => d.id === scratch)?.title).toBe(`Scratch ${run}`);

    expect(await designs.publishDesign(admin, scratch)).toMatchObject({ ok: true });
    const after = (await designs.getDesign(scratch))!;
    expect(await designs.designChanged(after)).toBe(false);
    expect(after).toMatchObject({ title: `Scratch bold ${run}`, draft: null });
    expect((await designs.publicDesignPreview(scratch, null))?.snapshot).toMatchObject({ theme: { base: "bold" } });
    expect((await designs.publicDesignPreview(scratch, null))?.snapshot.header).not.toBeNull();
    // Choosing the standard header again is a draft change too.
    expect(await designs.chooseWorkspaceLayout(admin, scratch, "header", "standard")).toEqual({ ok: true, pageId: null });
    expect(await designs.designChanged((await designs.getDesign(scratch))!)).toBe(true);
    // Building it again takes back the profile's own header, not a new one.
    expect(await designs.chooseWorkspaceLayout(admin, scratch, "header", "build")).toEqual({ ok: true, pageId: (header as { pageId: string }).pageId });
  });

  it("gives a profile made before D177 a workspace the first time it is edited, without counting as changed", async () => {
    const [legacy] = await db().execute<Row>(sql`
      insert into commerce.design_presets (title, snapshot, published, published_at, source_store_id)
      select ${`Legacy ${run}`}, snapshot, true, now(), ${source.id}::uuid from commerce.design_presets where id = ${presetId}::uuid
      returning id
    `);
    const legacyId = String(legacy.id);
    expect(await designs.workspaceOf(admin, legacyId)).toBeNull();
    const ready = await designs.ensureWorkspace(admin, legacyId, deps);
    expect(ready).toMatchObject({ ok: true });
    const again = await designs.ensureWorkspace(admin, legacyId, deps);
    expect((again as { workspace: { store: { id: string } } }).workspace.store.id).toBe((ready as { workspace: { store: { id: string } } }).workspace.store.id);
    const design = (await designs.getDesign(legacyId))!;
    expect(design.workspaceStoreId).not.toBeNull();
    expect(await designs.designChanged(design)).toBe(false);
    const ws = await one(sql`select theme, header_id from commerce.stores where id = ${design.workspaceStoreId}::uuid`);
    expect(parseStoreTheme(ws.theme).settings.light.accent).toBe("#2f6f4e");
    expect(ws.header_id).not.toBeNull();
  });

  it("can start its draft again from a store's look", async () => {
    expect(await designs.copyStoreLookToDraft(owner, scratch, source.id, deps)).toMatchObject({ ok: false });
    expect(await designs.copyStoreLookToDraft(admin, scratch, target.id, deps)).toEqual({ ok: false, problems: ["Choose a store you work in."] });
    expect(await designs.copyStoreLookToDraft(admin, scratch, source.id, deps)).toMatchObject({ ok: true });
    const draft = await designs.adminDesignPreview(scratch, null, true);
    expect(draft?.snapshot.theme.settings.light.accent).toBe("#2f6f4e");
    expect((await designs.publicDesignPreview(scratch, null))?.snapshot.theme.base).toBe("bold");
  });
});

describe("the life of a design profile (D177)", () => {
  it("is taken out of the choices at once when unpublished, and says which pending requests chose it", async () => {
    const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: details(`Chosen ${run}`) }, deps);
    const id = (made as { id: string }).id;
    await designs.publishDesign(admin, id);
    await createAccessRequest({ name: "Mia", email: `mia-${run}@example.com`, storeName: "Mia", message: "", designPresetId: id });
    expect(await designs.unpublishDesign(admin, id)).toEqual({ ok: true, pendingRequests: 1 });
    expect((await designs.designChoices()).cards.some((c) => c.id === id)).toBe(false);
    expect(await designs.isOfferedDesign(id)).toBe(false);
    // Approved as asked: the store keeps its template's own design, and the admin is told.
    const mia = await one(sql`select id from commerce.access_requests where lower(email) = ${`mia-${run}@example.com`}`);
    expect(await approveAccessRequest(admin, String(mia.id), `mia-${run}`, "Mia", "https://example.com")).toMatchObject({
      ok: true,
      design: null,
      fellBack: { starter: null, design: `Chosen ${run}` },
    });
    // A request chose it: it is archived, never deleted.
    expect(await designs.deleteDesign(admin, id)).toEqual({ ok: false, problems: ["This design profile cannot be deleted: 1 access request names it. Archive it instead."] });
  });

  it("is archived out of every list and choice and every template's recommendation, and restored unpublished", async () => {
    const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: details(`Shelf ${run}`) }, deps);
    const id = (made as { id: string }).id;
    await designs.publishDesign(admin, id);
    const starter = await starters.createStarter(admin, { slug: `shelf-${run}`, details: starterDetails() });
    const starterId = (starter as { id: string }).id;
    await starters.saveStarterDraft(admin, starterId, { ...starterDetails(), recommendedDesign: id });
    await starters.publishStarter(admin, starterId);
    await starters.saveStarterDraft(admin, starterId, { ...starterDetails(), summary: "Changed", recommendedDesign: id });

    expect(await designs.archiveDesign(admin, id)).toEqual({ ok: true, clearedFrom: ["Spa"] });
    expect((await designs.listDesigns()).some((d) => d.id === id)).toBe(false);
    expect((await designs.listDesigns("archived")).find((d) => d.id === id)).toMatchObject({ published: false });
    expect((await designs.designChoices()).cards.some((c) => c.id === id)).toBe(false);
    expect(await designs.publicDesignPreview(id, null)).toBeNull();
    const row = (await starters.getStarter(starterId))!;
    expect(row.recommendedDesign).toBeNull();
    expect(row.draft?.recommendedDesign).toBeNull();
    expect(await designs.publishDesign(admin, id)).toEqual({ ok: false, problems: ["This design profile is archived. Restore it before publishing it."] });
    expect(await designs.applyDesignPreset(target.id, id, admin.id, deps)).toMatchObject({ ok: false });

    expect(await designs.restoreDesign(admin, id)).toEqual({ ok: true });
    expect((await designs.getDesign(id))).toMatchObject({ archivedAt: null, published: false });
  });

  it("is deleted only while unused: a store that applied it keeps it, else its workspace is closed and kept", async () => {
    expect(await designs.deleteDesign(admin, presetId)).toMatchObject({ ok: false, problems: [expect.stringMatching(/^This design profile cannot be deleted: \d+ stores applied it.* Archive it instead\.$/)] });
    const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: details(`Gone ${run}`) }, deps);
    const id = (made as { id: string }).id;
    const workspaceId = (await designs.getDesign(id))!.workspaceStoreId!;
    const starter = await starters.createStarter(admin, { slug: `gone-${run}`, details: starterDetails() });
    const starterId = (starter as { id: string }).id;
    await starters.saveStarterDraft(admin, starterId, { ...starterDetails(), recommendedDesign: id });
    await starters.publishStarter(admin, starterId);
    expect(await designs.deleteDesign(owner, id)).toMatchObject({ ok: false });
    expect(await designs.deleteDesign(admin, id)).toEqual({ ok: true, clearedFrom: ["Spa"] });
    expect(await designs.getDesign(id)).toBeNull();
    expect((await one(sql`select status from commerce.stores where id = ${workspaceId}::uuid`)).status).toBe("closed");
    expect((await starters.getStarter(starterId))?.recommendedDesign).toBeNull();
  });
});
