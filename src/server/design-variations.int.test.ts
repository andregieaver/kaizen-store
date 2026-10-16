import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import { parseDesignSnapshot } from "@/lib/design-presets";
import { withCoreStyles } from "@/lib/launch-themes";
import { templateSettings, type ThemeSettings } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const designs = await import("./design-presets");
const variations = await import("./design-variations");

/**
 * A theme's presets (`docs/theme-showcase-phase-1.md` step 1): added and edited as the theme's draft, checked and published into its
 * version, previewed by key, installed and applied by key, and followed by an install through updates (the theme's own look when a version
 * drops the preset).
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const deps = {
  copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`,
  installFonts: async () => ({ ok: true as const }),
};

let admin: Account;
let owner: string;
let store: string;
let theme: string;

/** A preset's look: the standard theme (no fonts to install) with its own accent colour and the core section styles. */
const look = (accent: string, extra: Partial<ThemeSettings> = {}) => {
  const settings = withCoreStyles(templateSettings("minimal"));
  return { base: "minimal", savedId: null, settings: { ...settings, light: { ...settings.light, accent }, ...extra } };
};

async function storeOf(email: string, slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}

async function publish(): Promise<void> {
  const result = await designs.publishDesign(admin, theme);
  if (!result.ok) throw new Error(result.problems.join(" "));
}

beforeAll(async () => {
  const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`presets-${run}@example.com`}, 'Admin', true) returning id, email`);
  admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true } as Account;
  store = await storeOf(`presets-owner-${run}@example.com`, `presets-${run}`);
  owner = String((await one(sql`select id from commerce.accounts where lower(email) = lower(${`presets-owner-${run}@example.com`})`)).id);
  const made = await designs.createDesign(admin, { details: { title: `Fjordline ${run}`, summary: "", description: "", pictureUrl: null }, origin: { kind: "scratch" } }, deps);
  if (!made.ok) throw new Error(made.problems.join(" "));
  theme = made.id;
  await publish();
});

afterAll(async () => {
  await closeDb();
});

describe("a theme's presets", () => {
  it("are added by platform admins only, named once each, and are part of the draft until published", async () => {
    expect((await variations.addVariation({ ...admin, platformAdmin: false }, theme, "Coast")).ok).toBe(false);
    const added = await variations.addVariation(admin, theme, "Coast");
    expect(added).toMatchObject({ ok: true, key: "coast" });
    expect((await variations.addVariation(admin, theme, "coast")).ok).toBe(false);
    expect((await variations.listVariations(admin, theme)).map((v) => v.key)).toEqual(["coast"]);
    const design = (await designs.getDesign(theme))!;
    expect(await designs.designChanged(design)).toBe(true);
    // Stores still see the version as it was: no presets.
    const published = await one(sql`select snapshot from commerce.design_presets where id = ${theme}::uuid`);
    expect(parseDesignSnapshot(published.snapshot)).not.toBeNull();
    expect(parseDesignSnapshot(published.snapshot)?.variations).toBeUndefined();
  });

  it("are edited in the theme editor and published into the theme's version", async () => {
    const saved = await variations.saveVariationTheme(admin, theme, "coast", look("#0f5c8c"));
    expect(saved.ok).toBe(true);
    await publish();
    const [version] = await db().execute<Row>(sql`
      select snapshot from commerce.design_preset_versions where preset_id = ${theme}::uuid order by number desc limit 1
    `);
    const published = parseDesignSnapshot(version.snapshot)!;
    expect(published.v).toBe(2);
    expect(published.variations?.map((v) => [v.key, v.name, v.theme.settings.light.accent])).toEqual([["coast", "Coast", "#0f5c8c"]]);
    expect(await designs.designChanged((await designs.getDesign(theme))!)).toBe(false);
  });

  it("are checked one by one, so a preset that fails the theme checks holds the theme back, named", async () => {
    const unreadable = look("#0f5c8c");
    const settings = { ...unreadable.settings, light: { ...unreadable.settings.light, text: unreadable.settings.light.background } };
    expect((await variations.saveVariationTheme(admin, theme, "coast", { ...unreadable, settings })).ok).toBe(true);
    const refused = await designs.publishDesign(admin, theme);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.problems.join(" ")).toMatch(/Coast preset/);
    expect((await variations.saveVariationTheme(admin, theme, "coast", look("#0f5c8c"))).ok).toBe(true);
  });

  it("are previewed by their key, and an unknown key is not found", async () => {
    const preview = await designs.publicDesignPreview(theme, null, "coast");
    expect(preview?.presetName).toBe("Coast");
    expect(preview?.snapshot.theme.settings.light.accent).toBe("#0f5c8c");
    expect(preview?.snapshot).not.toHaveProperty("variations");
    expect(await designs.publicDesignPreview(theme, null, "shore")).toBeNull();
    expect((await designs.publicDesignPreview(theme, null))?.presetName).toBeNull();
  });

  it("are installed by their key, named after the theme and the preset, and an unknown one is refused", async () => {
    expect((await designs.installDesignPreset(store, theme, owner, deps, "shore")).ok).toBe(false);
    const added = await designs.installDesignPreset(store, theme, owner, deps, "coast");
    if (!added.ok) throw new Error(added.problems.join(" "));
    expect(added.title).toBe(`Fjordline ${run} · Coast`);
    const install = await one(sql`select variation, look from commerce.store_theme_installs where id = ${added.installId}::uuid`);
    expect(install.variation).toBe("coast");
    expect((install.look as { theme: { settings: ThemeSettings } }).theme.settings.light.accent).toBe("#0f5c8c");
  });

  it("are followed by an install through updates, which gets the theme's own look when a version drops the preset", async () => {
    const applied = await designs.applyDesignPreset(store, theme, owner, deps, "coast");
    if (!applied.ok) throw new Error(applied.problems.join(" "));
    const accent = async () => ((await one(sql`select theme from commerce.stores where id = ${store}::uuid`)).theme as { settings: ThemeSettings }).settings.light.accent;
    expect(await accent()).toBe("#0f5c8c");

    // A new version of the preset reaches the store.
    expect((await variations.saveVariationTheme(admin, theme, "coast", look("#1d6f4a"))).ok).toBe(true);
    await publish();
    const updated = await designs.updateThemeInstall(store, applied.installId, owner, deps);
    if (!updated.ok) throw new Error(updated.problems.join(" "));
    expect(await accent()).toBe("#1d6f4a");

    // A version without the preset gives the install the theme's own look, says so, and keeps the preset's key.
    expect((await variations.removeVariation(admin, theme, "coast")).ok).toBe(true);
    await publish();
    const waiting = await designs.themeUpdates(store);
    expect(waiting.available.find((u) => u.installId === applied.installId)?.whatsNew.join(" ")).toMatch(/no longer has the Coast preset/);
    const fallen = await designs.updateThemeInstall(store, applied.installId, owner, deps);
    if (!fallen.ok) throw new Error(fallen.problems.join(" "));
    expect(fallen.notes.join(" ")).toMatch(/no longer has the Coast preset/);
    expect(await accent()).toBe(templateSettings("minimal").light.accent);
    expect((await one(sql`select variation from commerce.store_theme_installs where id = ${applied.installId}::uuid`)).variation).toBe("coast");
  });
});

describe("starting a store from a preset (docs/theme-showcase-phase-1.md step 4)", () => {
  const platform = async () => import("./platform");
  const liveInstall = async (storeId: string) =>
    one(sql`select variation, title, (look is null) as columns from commerce.store_theme_installs where store_id = ${storeId}::uuid and live`);
  const requestOf = async (email: string) => one(sql`select id, design_preset_id, design_variation from commerce.access_requests where lower(email) = lower(${email})`);

  beforeAll(async () => {
    expect((await variations.addVariation(admin, theme, "Harbour")).ok).toBe(true);
    expect((await variations.saveVariationTheme(admin, theme, "harbour", look("#7a3b12"))).ok).toBe(true);
    await publish();
  });

  it("keeps the preset with a request only when the theme's published version has it", async () => {
    const { createAccessRequest } = await platform();
    await createAccessRequest({ name: "Ada", email: `ada-${run}@example.com`, storeName: "Ada", message: "", designPresetId: theme, designVariation: "harbour" });
    expect(await requestOf(`ada-${run}@example.com`)).toMatchObject({ design_preset_id: theme, design_variation: "harbour" });
    await createAccessRequest({ name: "Bo", email: `bo-${run}@example.com`, storeName: "Bo", message: "", designPresetId: theme, designVariation: "nowhere" });
    expect(await requestOf(`bo-${run}@example.com`)).toMatchObject({ design_preset_id: theme, design_variation: null });
    // A preset without its theme is never kept (the database refuses it too).
    await createAccessRequest({ name: "Cy", email: `cy-${run}@example.com`, storeName: "Cy", message: "", designPresetId: null, designVariation: "harbour" });
    expect(await requestOf(`cy-${run}@example.com`)).toMatchObject({ design_preset_id: null, design_variation: null });
  });

  it("applies the requester's preset when the request is approved, and the admin's when they change it", async () => {
    const { approveAccessRequest } = await platform();
    const ada = await requestOf(`ada-${run}@example.com`);
    const approved = await approveAccessRequest(admin, String(ada.id), `ada-${run}`, "Ada", "https://example.com");
    if (!approved.ok) throw new Error(approved.problems.join(" "));
    expect(approved.design).toMatchObject({ title: `Fjordline ${run} · Harbour`, problem: null });
    expect(await liveInstall(approved.storeId)).toMatchObject({ variation: "harbour" });
    const accent = await one(sql`select theme -> 'settings' -> 'light' ->> 'accent' as accent from commerce.stores where id = ${approved.storeId}::uuid`);
    expect(accent.accent).toBe("#7a3b12");

    // Bo asked for the theme's own look; the admin chooses the preset instead.
    const bo = await requestOf(`bo-${run}@example.com`);
    const changed = await approveAccessRequest(admin, String(bo.id), `bo-${run}`, "Bo", "https://example.com", undefined, theme, "harbour");
    if (!changed.ok) throw new Error(changed.problems.join(" "));
    expect(await liveInstall(changed.storeId)).toMatchObject({ variation: "harbour" });
  });

  it("applies a preset an owner chooses for a new store, and the theme's own look for one the version no longer has", async () => {
    const { createStoreForOwner } = await platform();
    const account = { id: owner, email: `presets-owner-${run}@example.com`, name: "Owner", platformAdmin: false } as Account;
    const made = await createStoreForOwner(account, "Second", `presets-second-${run}`, null, theme, "harbour");
    if (!made.ok) throw new Error(made.problems.join(" "));
    expect(made.design).toMatchObject({ title: `Fjordline ${run} · Harbour`, problem: null });
    expect(await liveInstall(made.storeId)).toMatchObject({ variation: "harbour" });

    const gone = await createStoreForOwner(account, "Third", `presets-third-${run}`, null, theme, "nowhere");
    if (!gone.ok) throw new Error(gone.problems.join(" "));
    expect(gone.design).toMatchObject({ title: `Fjordline ${run}`, problem: null });
    expect(await liveInstall(gone.storeId)).toMatchObject({ variation: null });
  });
});
