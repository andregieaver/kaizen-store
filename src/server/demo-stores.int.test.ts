import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseDesignSnapshot } from "@/lib/design-presets";
import { withCoreStyles } from "@/lib/launch-themes";
import { parseStarterDetails } from "@/lib/store-starters";
import { parseStoreTheme, templateSettings } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const designs = await import("./design-presets");
const variations = await import("./design-variations");
const starters = await import("./store-starters");
const demos = await import("./demo-stores");

/**
 * Demo stores (D277, `docs/themes-content-and-demo-stores.md` section 4): made from published starting content wearing a published theme
 * or preset, published as they stand (never frozen), listed under *See it live* on the theme they wear, never offered as a new store's
 * content, and their look copied once into a new theme, a preset of the theme (only while header, footer, product page and CSS are the
 * theme's) or the theme's next version.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const deps = {
  copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`,
  installFonts: async () => ({ ok: true as const }),
};

let admin: Account;
let theme: string;
let content: string;
let demo: { id: string; slug: string; storeId: string };

const look = (accent: string) => {
  const settings = withCoreStyles(templateSettings("minimal"));
  return { base: "minimal" as const, savedId: null, settings: { ...settings, light: { ...settings.light, accent } } };
};

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`demo-admin-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true } as Account;
  const made = await designs.createDesign(admin, { details: { title: `Harbour ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
  if (!made.ok) throw new Error(made.problems.join(" "));
  theme = made.id;
  const coast = await variations.addVariation(admin, theme, "Coast", look("#0a5c7a"));
  if (!coast.ok) throw new Error(coast.problems.join(" "));
  const published = await designs.publishDesign(admin, theme);
  if (!published.ok) throw new Error(published.problems.join(" "));
  const details = parseStarterDetails({ title: `Linen ${run}`, summary: "", description: "", category: "retail", pictureUrl: "" });
  if (!details.ok) throw new Error(details.problems.join(" "));
  const starter = await starters.createStarter(admin, { slug: `linen-${run}`, details: details.details });
  if (!starter.ok) throw new Error(starter.problems.join(" "));
  content = starter.id;
  const frozen = await starters.publishStarter(admin, content);
  if (!frozen.ok) throw new Error(frozen.problems.join(" "));
});

afterAll(async () => {
  await closeDb();
});

describe("making a demo store", () => {
  it("is a platform admin's, at a free address, wearing a published look", async () => {
    const input = { name: `Field and Fold ${run}`, slug: `field-${run}`, look: { id: theme, variation: "coast" }, contentId: content };
    expect(await demos.createDemoStore({ ...admin, platformAdmin: false }, input, deps)).toMatchObject({ ok: false });
    expect(await demos.createDemoStore(admin, { ...input, slug: `linen-${run}` }, deps)).toMatchObject({ ok: false, problems: [expect.stringMatching(/taken/)] });
    expect(await demos.createDemoStore(admin, { ...input, slug: "admin" }, deps)).toMatchObject({ ok: false, problems: [expect.stringMatching(/reserved/)] });
    expect(await demos.createDemoStore(admin, { ...input, look: { id: theme, variation: "nowhere" } }, deps)).toMatchObject({ ok: false, problems: [expect.stringMatching(/preset/)] });
    const made = await demos.createDemoStore(admin, input, deps);
    expect(made).toMatchObject({ ok: true, slug: `field-${run}`, themed: true });
    const id = (made as { id: string }).id;
    const row = await one(sql`
      select st.kind, st.published, st.published_store_id, s.id as store_id, s.starter, s.name,
             i.preset_id, i.variation
        from commerce.store_starters st join commerce.stores s on s.id = st.store_id
        left join commerce.store_theme_installs i on i.store_id = s.id and i.live
       where st.id = ${id}::uuid
    `);
    expect(row).toMatchObject({ kind: "demo", published: false, published_store_id: null, starter: true, name: `Field and Fold ${run}`, preset_id: theme, variation: "coast" });
    demo = { id, slug: `field-${run}`, storeId: String(row.store_id) };
    // Its look is the preset's.
    const store = await one(sql`select theme from commerce.stores where id = ${demo.storeId}::uuid`);
    expect(parseStoreTheme(store.theme).settings.light.accent).toBe("#0a5c7a");
    // A demo store, never starting content: not among the store templates, never offered to a new store.
    expect((await demos.listDemoStores()).map((d) => d.id)).toContain(id);
    expect((await starters.listStarters()).some((s) => s.id === id)).toBe(false);
    expect(await demos.getDemoStore(content)).toBeNull();
    expect((await demos.getDemoStore(id))?.wears).toMatchObject({ presetId: theme, variation: "coast", presetName: "Coast", launch: false });
    expect((await demos.demoContentChoices()).some((c) => c.id === id)).toBe(false);
    const audited = await one(sql`select count(*)::int as n from commerce.audit_log where action = 'platform.demo_store_created' and details ->> 'starter' = ${id}`);
    expect(audited.n).toBe(1);
  });
});

describe("publishing a demo store", () => {
  it("puts it live as it stands, never frozen, under See it live on the theme it wears", async () => {
    expect(await demos.liveDemosOf(theme)).toEqual([]);
    expect(await demos.publishDemoStore({ ...admin, platformAdmin: false }, demo.id)).toMatchObject({ ok: false });
    expect(await demos.publishDemoStore(admin, demo.id)).toEqual({ ok: true });
    expect(await one(sql`select published, published_store_id from commerce.store_starters where id = ${demo.id}::uuid`)).toEqual({ published: true, published_store_id: null });
    // The store templates' Publish would freeze it: the database refuses.
    expect(await starters.publishStarter(admin, demo.id)).toMatchObject({ ok: false, problems: [expect.stringMatching(/live as it stands/)] });
    const live = await demos.liveDemosOf(theme);
    expect(live).toEqual([expect.objectContaining({ id: demo.id, name: `Field and Fold ${run}`, variation: "coast" })]);
    expect(live[0].href).toContain(demo.slug);
    // Never offered as a new store's content, published or not.
    expect((await starters.listOfferedStarters()).some((s) => s.id === demo.id)).toBe(false);
    expect(await one(sql`select commerce.starter_offered_source(${demo.id}::uuid) as id`)).toEqual({ id: null });
    // Its details show at once.
    expect(await demos.saveDemoDetails(admin, demo.id, { trade: "Linen and home goods", pictureUrl: null })).toEqual({ ok: true });
    expect((await demos.liveDemosOf(theme))[0]).toMatchObject({ trade: "Linen and home goods" });
    // Unpublished, it is no longer shown.
    expect(await starters.unpublishStarter(admin, demo.id)).toMatchObject({ ok: true });
    expect(await demos.liveDemosOf(theme)).toEqual([]);
    expect(await demos.publishDemoStore(admin, demo.id)).toEqual({ ok: true });
  });
});

describe("publishing its look", () => {
  it("adds its theme settings as a preset while its header, footer, product page and CSS are the theme's", async () => {
    const fresh = (await demos.getDemoStore(demo.id))!;
    expect(await demos.presetCheck(fresh)).toEqual({ ok: true, changed: [] });
    // Its colours changed in its store: still a preset.
    const theme0 = parseStoreTheme((await one(sql`select theme from commerce.stores where id = ${demo.storeId}::uuid`)).theme);
    await db().execute(sql`
      update commerce.stores set theme = ${JSON.stringify({ ...theme0, settings: { ...theme0.settings, light: { ...theme0.settings.light, accent: "#7a2e0a" } } })}::jsonb
       where id = ${demo.storeId}::uuid
    `);
    const added = await demos.demoLookAsPreset(admin, demo.id, "Rust");
    expect(added).toMatchObject({ ok: true, presetId: theme });
    const key = (added as { key: string }).key;
    const drafted = await one(sql`select theme from commerce.design_variations where preset_id = ${theme}::uuid and key = ${key}`);
    expect((drafted.theme as { settings: { light: { accent: string } } }).settings.light.accent).toBe("#7a2e0a");
    // A draft: the published version does not have it until the theme is published.
    const published = parseDesignSnapshot((await one(sql`select snapshot from commerce.design_presets where id = ${theme}::uuid`)).snapshot)!;
    expect((published.variations ?? []).map((v) => v.key)).not.toContain(key);
    // Its CSS changed: a preset cannot hold it, said in words.
    await db().execute(sql`update commerce.stores set custom_css = '.x { color: red; }' where id = ${demo.storeId}::uuid`);
    const refused = await demos.demoLookAsPreset(admin, demo.id, "Rust again");
    expect(refused).toMatchObject({ ok: false, problems: [expect.stringMatching(/changed the CSS\. Publish it as a new theme instead/)] });
    await db().execute(sql`update commerce.stores set custom_css = '' where id = ${demo.storeId}::uuid`);
  });

  it("replaces the theme's draft look with its own for the next version, leaving the published one", async () => {
    const before = await one(sql`select snapshot from commerce.design_presets where id = ${theme}::uuid`);
    expect(await demos.demoLookIntoNextVersion({ ...admin, platformAdmin: false }, demo.id)).toMatchObject({ ok: false });
    expect(await demos.demoLookIntoNextVersion(admin, demo.id, deps)).toMatchObject({ ok: true, presetId: theme });
    const workspace = await one(sql`select w.theme from commerce.design_presets d join commerce.stores w on w.id = d.workspace_store_id where d.id = ${theme}::uuid`);
    expect(parseStoreTheme(workspace.theme).settings.light.accent).toBe("#7a2e0a");
    expect(await one(sql`select snapshot from commerce.design_presets where id = ${theme}::uuid`)).toEqual(before);
  });

  it("makes a new unpublished theme with its look and a copy of its content, published or not", async () => {
    expect(await starters.unpublishStarter(admin, demo.id)).toMatchObject({ ok: true });
    const made = await demos.demoLookAsTheme(admin, demo.id, { title: `Field ${run}`, summary: "", description: "", pictureUrl: null }, deps);
    expect(made).toMatchObject({ ok: true, notes: [] });
    const presetId = (made as { presetId: string }).presetId;
    expect(await one(sql`select published from commerce.design_presets where id = ${presetId}::uuid`)).toEqual({ published: false });
    const own = await starters.themeContentOf(presetId);
    expect(own).toMatchObject({ published: false });
    expect(own!.storeId).not.toBe(demo.storeId);
    expect((await one(sql`select made_from_starter from commerce.stores where id = ${own!.storeId}::uuid`)).made_from_starter).toBe(demo.id);
    // The copy is the theme's; the demo store and the theme do not stay linked.
    expect((await demos.getDemoStore(demo.id))?.wears?.presetId).toBe(theme);
  });

  it("is never made from an archived demo store", async () => {
    expect(await starters.archiveStarter(admin, demo.id)).toMatchObject({ ok: true });
    await expect(db().execute(sql`select commerce.starter_source(${demo.id}::uuid)`)).rejects.toThrow();
    expect(await demos.demoLookAsTheme(admin, demo.id, { title: `Nope ${run}`, summary: "", description: "", pictureUrl: null }, deps)).toMatchObject({
      ok: false,
      problems: [expect.stringMatching(/archived/)],
    });
    expect(await demos.publishDemoStore(admin, demo.id)).toMatchObject({ ok: false, problems: [expect.stringMatching(/archived/)] });
  });
});
