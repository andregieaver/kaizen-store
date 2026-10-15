import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { DesignSnapshot } from "@/lib/design-presets";
import type { PageRow } from "@/lib/page-content";
import { defaultFooter, defaultHeader } from "@/lib/site-layout";
import { templateSettings, type ThemeSettings } from "@/lib/theme";

import type { Account } from "./auth";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const designs = await import("./design-presets");
const installs = await import("./platform-theme-installs");
const fixtures = await import("./trust-fixtures");

/**
 * Updates of Kaizena Flow's own installed themes (D253, `docs/theme-phase-4.md` step 3), as a store's (D245): a new version reaches the site's
 * live theme with the admins' own changes kept (a font chosen on the Fonts page, a footer they edited), an untouched header replaced, What's new
 * said, the update undone while nothing changed since, the job updating only installs that follow updates, and only platform admins acting.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const deps = {
  copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`,
  installFonts: async () => ({ ok: true as const }),
};

let admin: Account;
let owner: Account;
let preset: string;
let install: string;
let custom: string;
let before: Row;

const heading = (id: string, text: string): PageRow =>
  ({ id: `row-${id}`, type: "row", layout: "1", columns: [{ id: `col-${id}`, blocks: [{ id: `h-${id}`, type: "heading", text, level: 2 }] }] }) as unknown as PageRow;

function snapshot(settings: ThemeSettings, extra: { headerText: string; footerText: string; css: string }): DesignSnapshot {
  const header = defaultHeader(null);
  const footer = defaultFooter(null);
  return {
    v: 1,
    theme: { base: "minimal", settings },
    header: { rows: [...header.rows, heading("hd", extra.headerText)], css: "", menus: {} },
    footer: { rows: [...footer.rows, heading("ft", extra.footerText)], css: "", menus: {} },
    productLayout: null,
    css: extra.css,
  };
}

const v1Settings = (): ThemeSettings => ({ ...templateSettings("minimal"), sectionStyles: { plain: { row: { radius: 1 } } } });
const lookNow = () => one(sql`select theme, fonts, custom_css, header_id, footer_id from commerce.platform_settings`);

async function publishVersion(number: number, snap: DesignSnapshot, notes: string | null) {
  await db().execute(sql`update commerce.design_presets set snapshot = ${JSON.stringify(snap)}::jsonb where id = ${preset}::uuid`);
  await db().execute(sql`
    insert into commerce.design_preset_versions (preset_id, number, snapshot, notes) values (${preset}::uuid, ${number}, ${JSON.stringify(snap)}::jsonb, ${notes})
  `);
}

beforeAll(async () => {
  admin = await fixtures.makeAccount(`kaizena-upd-${run}`, { platformAdmin: true });
  owner = await fixtures.makeAccount(`kaizena-upd-owner-${run}`);
  before = await lookNow();
  const v1 = snapshot(v1Settings(), { headerText: "Welcome", footerText: "Made by hand", css: ".k1 { color: #111111; }" });
  const [row] = await db().execute<Row>(sql`insert into commerce.design_presets (title, snapshot, published) values (${`Kaizena ${run}`}, ${JSON.stringify(v1)}::jsonb, true) returning id`);
  preset = String(row.id);
  await db().execute(sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${preset}::uuid, 1, ${JSON.stringify(v1)}::jsonb)`);
  const added = await designs.installPresetOnPlatform(admin, preset, deps);
  if (!added.ok) throw new Error(added.problems.join(" "));
  install = added.installId;
  const live = (await installs.listPlatformInstalls()).find((i) => i.live);
  if (!live) throw new Error("No live install");
  custom = live.id;
  const switched = await installs.switchPlatformInstall(admin, install);
  if (!switched.ok) throw new Error(switched.problems.join(" "));
});

afterAll(async () => {
  // Back to the look the site had, whatever a failed run left.
  const live = (await installs.listPlatformInstalls()).find((i) => i.live);
  if (live && live.id !== custom) await installs.switchPlatformInstall(admin, custom);
  await installs.removePlatformInstall(admin, install);
  await closeDb();
});

describe("updating Kaizena Flow's installed themes (D253)", () => {
  it("follows updates unless switched off, and only admins switch it", async () => {
    const row = await one(sql`select follows_updates, placed from commerce.platform_theme_installs where id = ${install}::uuid`);
    expect(row.follows_updates).toBe(true);
    expect((row.placed as { layouts: Record<string, unknown> }).layouts.productLayout).toBeNull();
    expect((await installs.setPlatformFollowsUpdates(owner, install, false)).ok).toBe(false);
    expect((await installs.setPlatformFollowsUpdates(admin, custom, false)).ok).toBe(false);
  });

  it("lays the new version under the admins' changes, replaces an untouched header, keeps an edited footer, and undoes", async () => {
    // An admin chooses other fonts on the Fonts page (a column of its own) and edits the footer's words.
    const worn = await lookNow();
    await db().execute(sql`update commerce.platform_settings set fonts = ${JSON.stringify({ heading: "Archivo", body: "Inter" })}::jsonb`);
    const footerId = String(worn.footer_id);
    const footer = await one(sql`select published from commerce.pages where id = ${footerId}::uuid`);
    const edited = { ...(footer.published as Row), rows: [...((footer.published as { rows: PageRow[] }).rows ?? []), heading("own", "Our own words")] };
    await db().execute(sql`update commerce.pages set published = ${JSON.stringify(edited)}::jsonb, draft = ${JSON.stringify(edited)}::jsonb where id = ${footerId}::uuid`);

    const settings = v1Settings();
    settings.light.accent = "#00aa00";
    await publishVersion(2, snapshot(settings, { headerText: "Welcome back", footerText: "Made by hand, again", css: ".k2 { color: #222222; }" }), "Calmer colours.");

    const waiting = await designs.platformThemeUpdates();
    const item = waiting.available.find((a) => a.installId === install);
    expect(item).toMatchObject({ from: 1, to: 2, live: true, followsUpdates: true });
    expect(item?.whatsNew[0]).toBe("Calmer colours.");

    expect((await designs.updatePlatformInstall(owner, install, deps)).ok).toBe(false);
    const updated = await designs.updatePlatformInstall(admin, install, deps);
    if (!updated.ok) throw new Error(updated.problems.join(" "));
    expect(updated.version).toBe(2);
    expect(updated.own).toBeGreaterThan(0);

    const after = await lookNow();
    const theme = after.theme as { settings: ThemeSettings };
    expect(theme.settings.light.accent).toBe("#00aa00");
    expect(after.fonts).toEqual({ heading: "Archivo", body: "Inter" });
    expect(theme.settings.fonts).toEqual({ heading: "Archivo", body: "Inter" });
    expect(after.custom_css).toBe(".k2 { color: #222222; }");
    expect(String(after.header_id)).not.toBe(String(worn.header_id));
    expect(String(after.footer_id)).toBe(footerId);
    const header = await one(sql`select store_id, published from commerce.pages where id = ${String(after.header_id)}::uuid`);
    expect(header.store_id).toBeNull();
    expect(JSON.stringify(header.published)).toContain("Welcome back");
    const draft = await one(sql`
      select count(*)::int as n from commerce.pages where store_id is null and type = 'footer' and published is null and draft::text like '%Made by hand, again%'
    `);
    expect(draft.n).toBe(1);
    expect((await designs.platformThemeUpdates()).available.find((a) => a.installId === install)).toBeUndefined();

    const made = (await designs.platformThemeUpdates()).made.find((m) => m.title.startsWith("Kaizena"));
    if (!made) throw new Error("No update logged");
    expect(made).toMatchObject({ from: 1, to: 2, automatic: false, layoutsKept: ["footer"], undoneAt: null });
    const undone = await designs.undoPlatformThemeUpdate(admin, made.id);
    if (!undone.ok) throw new Error(undone.problems.join(" "));
    expect(await lookNow()).toEqual({ ...worn, fonts: { heading: "Archivo", body: "Inter" } });
    expect((await designs.undoPlatformThemeUpdate(admin, made.id)).ok).toBe(false);
    await db().execute(sql`update commerce.platform_settings set fonts = ${JSON.stringify(worn.fonts ?? {})}::jsonb`);
  });

  it("is updated by the job only while it follows updates", async () => {
    expect((await installs.setPlatformFollowsUpdates(admin, install, false)).ok).toBe(true);
    expect((await designs.runPlatformThemeUpdates(20, deps)).updated).toBe(0);
    expect((await installs.setPlatformFollowsUpdates(admin, install, true)).ok).toBe(true);
    const job = await designs.runPlatformThemeUpdates(20, deps);
    expect(job).toMatchObject({ updated: 1, live: true });
    const made = (await designs.platformThemeUpdates()).made.find((m) => m.title.startsWith("Kaizena") && !m.undoneAt);
    expect(made?.automatic).toBe(true);
    expect((await lookNow()).custom_css).toBe(".k2 { color: #222222; }");
  });

  it("leaves Kaizena Flow's look as it was once switched back", async () => {
    expect((await installs.switchPlatformInstall(admin, custom)).ok).toBe(true);
    expect(await lookNow()).toEqual(before);
  });
});
