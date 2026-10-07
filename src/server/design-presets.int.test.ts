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
    expect(await designs.createDesign(owner, { storeId: target.id, details: details("Nope") })).toMatchObject({ ok: false });
    expect(await designs.createDesign(admin, { storeId: target.id, details: details("Nope") })).toEqual({
      ok: false,
      problems: ["Choose a store you work in."],
    });
  });

  it("keeps the store's look, unpublished and last, with nothing in it that points into the store", async () => {
    const result = await designs.createDesign(admin, { storeId: source.id, details: details(`Nordic calm ${run}`) });
    expect(result).toMatchObject({ ok: true });
    presetId = (result as { id: string }).id;
    const row = await one(sql`select snapshot, published, source_store_id, position from commerce.design_presets where id = ${presetId}::uuid`);
    expect(row.published).toBe(false);
    expect(String(row.source_store_id)).toBe(source.id);
    const json = JSON.stringify(row.snapshot);
    for (const foreign of [source.id, source.headerMenu, source.footerMenu, source.headerPage, `/s/${source.slug}`]) expect(json).not.toContain(foreign);
    expect(json).toContain(STORAGE);
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
    expect(await designs.setDesignPublished(admin, presetId, true)).toEqual({ ok: true });
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
    const draft = await designs.createDesign(admin, { storeId: source.id, details: details(`Draft ${run}`) });
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
    const draft = await designs.createDesign(admin, { storeId: source.id, details: details(`Hidden ${run}`) });
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

    const hidden = await designs.createDesign(admin, { storeId: source.id, details: details(`Unpublished ${run}`) });
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
    await starters.setStarterPublished(admin, starterId, true);
    expect(await designs.setRecommendedDesign(admin, starterId, presetId)).toEqual({ ok: true });
    expect((await designs.designChoices()).recommended[starterId]).toBe(presetId);
    await designs.setDesignPublished(admin, presetId, false);
    expect((await designs.designChoices()).recommended[starterId]).toBeUndefined();
    await designs.setDesignPublished(admin, presetId, true);
    expect(await designs.setRecommendedDesign(owner, starterId, presetId)).toMatchObject({ ok: false });
  });
});

describe("the preview (D176)", () => {
  it("shows a published profile on the Standard store and refuses an unpublished one, unless a platform admin asks", async () => {
    expect(await designs.publicDesignPreview(presetId, null)).toMatchObject({ id: presetId, starterTitle: null });
    const hidden = await designs.createDesign(admin, { storeId: source.id, details: details(`Secret ${run}`) });
    const hiddenId = (hidden as { id: string }).id;
    expect(await designs.publicDesignPreview(hiddenId, null)).toBeNull();
    expect(await designs.adminDesignPreview(hiddenId, null)).toMatchObject({ id: hiddenId });
    expect(await designs.publicDesignPreview("not-an-id", null)).toBeNull();
  });
});
