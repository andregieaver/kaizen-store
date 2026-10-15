import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const { syncLaunchThemes } = await import("./launch-themes");
const designs = await import("./design-presets");
const installs = await import("./platform-theme-installs");
const fixtures = await import("./trust-fixtures");

/**
 * Kaizena Flow's own site on themes (`docs/theme-phase-4.md` step 1): a published theme is added to its library without going live, the site
 * switches to it and back, only the look columns change (the theme, fonts, CSS, header and footer), the look it switched away from is kept
 * with every change, the live one is never removed, a theme it has installed is not deleted, and only platform admins do any of it.
 */

type Row = Record<string, unknown>;
const deps = { installFonts: async () => ({ ok: true as const }) };
let admin: Account;
let owner: Account;
let before: Row;

const lookNow = async () =>
  (await db().execute<Row>(sql`select theme, fonts, custom_css, header_id, footer_id from commerce.platform_settings`))[0];
/** Everything of Kaizena Flow's that is not its look: switching must never change it. */
const contentNow = async () =>
  (
    await db().execute<Row>(sql`
      select
        md5(coalesce((select jsonb_agg(jsonb_build_object('id', p.id, 'type', p.type, 'slug', p.slug, 'draft', p.draft, 'published', p.published) order by p.id)
                        from commerce.pages p where p.store_id is null and p.type in ('page', 'article')), '[]')::text) as pages,
        md5(coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'items', m.items) order by m.id) from commerce.menus m where m.store_id is null), '[]')::text) as menus,
        (select md5(jsonb_build_array(k.navigation, k.business, k.header_menu_id, k.footer_menu_id, k.seo)::text) from commerce.platform_settings k) as settings
    `)
  )[0];

beforeAll(async () => {
  admin = await fixtures.makeAccount(`kaizena-themes-${Date.now().toString(36)}`, { platformAdmin: true });
  owner = await fixtures.makeAccount(`kaizena-themes-owner-${Date.now().toString(36)}`);
  expect((await syncLaunchThemes(admin, deps)).problems).toEqual([]);
  before = await lookNow();
});

afterAll(async () => {
  // Back to the look the site had, whatever a failed run left.
  const custom = (await installs.listPlatformInstalls()).find((install) => install.presetId === null);
  if (custom && !custom.live) await installs.switchPlatformInstall(admin, custom.id);
  await closeDb();
});

describe("Kaizena Flow's theme library", () => {
  it("starts with its own look as the live Custom", async () => {
    const list = await installs.listPlatformInstalls();
    expect(list[0]).toMatchObject({ title: "Custom", live: true, presetId: null });
  });

  it("adds a theme without going live, switches to it and back with nothing but the look changed", async () => {
    const hearth = (await designs.listOfferedDesigns()).find((design) => design.title === "Hearth");
    if (!hearth) throw new Error("Hearth is not published");
    const content = await contentNow();

    const added = await designs.installPresetOnPlatform(admin, hearth.id, deps);
    if (!added.ok) throw new Error(added.problems.join(" "));
    expect(await lookNow()).toEqual(before);
    expect((await installs.listPlatformInstalls()).find((install) => install.id === added.installId)).toMatchObject({ live: false, presetId: hearth.id });
    expect((await designs.getDesign(hearth.id))?.onPlatform).toBe(true);

    const switched = await installs.switchPlatformInstall(admin, added.installId);
    if (!switched.ok) throw new Error(switched.problems.join(" "));
    expect(switched.from).toBe("Custom");
    const worn = await lookNow();
    expect((worn.theme as { settings: { fonts: unknown } }).settings.fonts).toEqual({ heading: "Playfair Display", body: "Lora" });
    expect(worn.fonts).toEqual({ heading: "Playfair Display", body: "Lora" });
    expect(await contentNow()).toEqual(content);

    const custom = (await installs.listPlatformInstalls()).find((install) => install.presetId === null);
    if (!custom) throw new Error("Custom is gone");
    expect((await installs.switchPlatformInstall(admin, custom.id)).ok).toBe(true);
    expect(await lookNow()).toEqual(before);
    expect(await contentNow()).toEqual(content);

    // The live one is never removed; one that is not live is, and the theme can then be deleted again if nothing else uses it.
    expect(await installs.removePlatformInstall(admin, custom.id)).toEqual({ ok: false, problems: ["Only a theme that is not live can be removed."] });
    expect(await designs.deleteDesign(admin, hearth.id)).toMatchObject({ ok: false });
    expect((await installs.removePlatformInstall(admin, added.installId)).ok).toBe(true);
    expect((await designs.getDesign(hearth.id))?.onPlatform).toBe(false);
  });

  it("is a platform admin's only", async () => {
    const hearth = (await designs.listOfferedDesigns()).find((design) => design.title === "Hearth");
    if (!hearth) throw new Error("Hearth is not published");
    expect((await designs.installPresetOnPlatform(owner, hearth.id, deps)).ok).toBe(false);
    const custom = (await installs.listPlatformInstalls())[0];
    expect((await installs.switchPlatformInstall(owner, custom.id)).ok).toBe(false);
    expect((await installs.removePlatformInstall(owner, custom.id)).ok).toBe(false);
  });
});
