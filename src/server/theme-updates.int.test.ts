import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { closeDb, db } from "@/db/client";
import type { DesignSnapshot } from "@/lib/design-presets";
import type { PageRow } from "@/lib/page-content";
import { defaultFooter, defaultHeader } from "@/lib/site-layout";
import { templateSettings, type ThemeSettings } from "@/lib/theme";

vi.mock("@/lib/supabase/mailer", () => ({ emailSignInLink: async () => true }));
vi.mock("next/cache", () => ({ cacheLife: () => {}, cacheTag: () => {}, updateTag: () => {}, refresh: () => {}, revalidateTag: () => {} }));

const designs = await import("./design-presets");
const installs = await import("./theme-installs");

/**
 * Updates of installed themes (D245, `docs/theme-phase-2.md` step 4): a new version reaches a store with the owner's own changes kept (a
 * setting they changed, a footer they edited), an untouched header replaced, What's new said, the update undone while nothing changed since,
 * and the job updating by itself only installs that follow updates.
 */

type Row = Record<string, unknown>;
const run = Date.now().toString(36);
const one = async (query: ReturnType<typeof sql>) => (await db().execute<Row>(query))[0];
const deps = {
  copyFile: async (bucket: string, _from: string, to: string) => `https://x.supabase.co/storage/v1/object/public/${bucket}/${to}`,
  installFonts: async () => ({ ok: true as const }),
};

let store: string;
let owner: string;
let stranger: string;
let preset: string;
let install: string;

async function storeOf(email: string, slug: string): Promise<string> {
  const [request] = await db().execute<Row>(sql`insert into commerce.access_requests (email, name, store_name) values (${email}, 'Owner', ${slug}) returning id`);
  const [{ id }] = await db().execute<Row>(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${slug}, ${slug}, null) as id`);
  return String(id);
}
const accountId = async (email: string) => String((await one(sql`select id from commerce.accounts where lower(email) = lower(${email})`)).id);

const heading = (id: string, text: string): PageRow =>
  ({ id: `row-${id}`, type: "row", layout: "1", columns: [{ id: `col-${id}`, blocks: [{ id: `h-${id}`, type: "heading", text, level: 2 }] }] }) as unknown as PageRow;

function snapshot(settings: ThemeSettings, extra: { headerText: string; footerText: string; css: string }): DesignSnapshot {
  const header = defaultHeader(store, { header: null, footer: null });
  const footer = defaultFooter(store, { header: null, footer: null });
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
const storeLook = () => one(sql`select theme, custom_css, header_id, footer_id from commerce.stores where id = ${store}::uuid`);

async function publishVersion(number: number, snap: DesignSnapshot, notes: string | null) {
  await db().execute(sql`update commerce.design_presets set snapshot = ${JSON.stringify(snap)}::jsonb where id = ${preset}::uuid`);
  await db().execute(sql`
    insert into commerce.design_preset_versions (preset_id, number, snapshot, notes) values (${preset}::uuid, ${number}, ${JSON.stringify(snap)}::jsonb, ${notes})
  `);
}

beforeAll(async () => {
  store = await storeOf(`upd-${run}@example.com`, `upd-${run}`);
  owner = await accountId(`upd-${run}@example.com`);
  await storeOf(`upd-x-${run}@example.com`, `upd-x-${run}`);
  stranger = await accountId(`upd-x-${run}@example.com`);
  const v1 = snapshot(v1Settings(), { headerText: "Welcome", footerText: "Made by hand", css: ".v1 { color: #111111; }" });
  const [row] = await db().execute<Row>(sql`insert into commerce.design_presets (title, snapshot, published) values (${`Calm ${run}`}, ${JSON.stringify(v1)}::jsonb, true) returning id`);
  preset = String(row.id);
  await db().execute(sql`insert into commerce.design_preset_versions (preset_id, number, snapshot) values (${preset}::uuid, 1, ${JSON.stringify(v1)}::jsonb)`);
  const applied = await designs.applyDesignPreset(store, preset, owner, deps);
  if (!applied.ok) throw new Error(applied.problems.join(" "));
  install = applied.installId;
});

afterAll(async () => {
  await closeDb();
});

describe("updating an installed theme (D245)", () => {
  it("keeps what applying placed, so the owner's changes can be told apart", async () => {
    const row = await one(sql`select placed, follows_updates from commerce.store_theme_installs where id = ${install}::uuid`);
    const placed = row.placed as { css: string; layouts: Record<string, { id: string; hash: string } | null> };
    expect(row.follows_updates).toBe(true);
    expect(placed.css).toBe(".v1 { color: #111111; }");
    expect(placed.layouts.header?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(placed.layouts.productLayout).toBeNull();
  });

  it("lays the new version under the owner's changes, replaces an untouched header and keeps an edited footer", async () => {
    // The owner changes the accent and edits the footer's words.
    const before = await storeLook();
    const theme = before.theme as { settings: ThemeSettings };
    theme.settings.light.accent = "#ff0000";
    await db().execute(sql`update commerce.stores set theme = ${JSON.stringify(theme)}::jsonb where id = ${store}::uuid`);
    const footerId = String(before.footer_id);
    const footer = await one(sql`select published from commerce.pages where id = ${footerId}::uuid`);
    const edited = { ...(footer.published as Row), rows: [...((footer.published as { rows: PageRow[] }).rows ?? []), heading("own", "Our own words")] };
    await db().execute(sql`update commerce.pages set published = ${JSON.stringify(edited)}::jsonb, draft = ${JSON.stringify(edited)}::jsonb where id = ${footerId}::uuid`);

    // Version 2 changes the accent and the text colour, the header, the footer and the CSS.
    const settings = v1Settings();
    settings.light.accent = "#00aa00";
    settings.light.text = "#222222";
    await publishVersion(2, snapshot(settings, { headerText: "Welcome back", footerText: "Made by hand, again", css: ".v2 { color: #222222; }" }), "Calmer colours.");

    const waiting = await designs.themeUpdates(store);
    const item = waiting.available.find((a) => a.installId === install);
    expect(item).toMatchObject({ from: 1, to: 2, live: true, followsUpdates: true });
    expect(item?.whatsNew[0]).toBe("Calmer colours.");
    expect(item?.whatsNew).toContain("A new header.");

    expect(await designs.updateThemeInstall(store, install, stranger, deps)).toEqual({ ok: false, problems: ["You do not work in this store."] });
    const result = await designs.updateThemeInstall(store, install, owner, deps);
    if (!result.ok) throw new Error(result.problems.join(" "));
    expect(result).toMatchObject({ version: 2, own: 1, kept: ["light.accent"] });

    const after = await storeLook();
    const now = (after.theme as { settings: ThemeSettings }).settings;
    expect(now.light.accent).toBe("#ff0000");
    expect(now.light.text).toBe("#222222");
    expect(after.custom_css).toBe(".v2 { color: #222222; }");
    expect(after.header_id).not.toBe(before.header_id);
    const header = await one(sql`select published from commerce.pages where id = ${String(after.header_id)}::uuid`);
    expect(JSON.stringify(header.published)).toContain("Welcome back");
    expect(after.footer_id).toBe(footerId);
    const offered = await one(sql`
      select count(*)::int as n from commerce.pages where store_id = ${store}::uuid and type = 'footer' and published is null and draft::text like '%again%'
    `);
    expect(offered.n).toBe(1);
    expect(await designs.updateThemeInstall(store, install, owner, deps)).toEqual({ ok: false, problems: ["This theme is up to date."] });
    const audit = await one(sql`select area from commerce.audit_log where action = 'store.theme_updated' and store_id = ${store}::uuid limit 1`);
    expect(audit.area).toBe("website");
  });

  it("is undone while nothing changed since, and only once", async () => {
    const { made } = await designs.themeUpdates(store);
    const update = made[0];
    expect(update).toMatchObject({ from: 1, to: 2, automatic: false, own: 1, layoutsKept: ["footer"], undoneAt: null });
    expect(await designs.undoThemeUpdate(store, update.id, owner)).toMatchObject({ ok: true });
    const look = await storeLook();
    expect((look.theme as { settings: ThemeSettings }).settings.light.text).toBe(templateSettings("minimal").light.text);
    expect(look.custom_css).toBe(".v1 { color: #111111; }");
    expect((await one(sql`select v.number from commerce.store_theme_installs i join commerce.design_preset_versions v on v.id = i.version_id where i.id = ${install}::uuid`)).number).toBe(1);
    expect((await designs.undoThemeUpdate(store, update.id, owner)).ok).toBe(false);
  });

  it("refuses an undo once the theme changed since", async () => {
    const result = await designs.updateThemeInstall(store, install, owner, deps);
    expect(result.ok).toBe(true);
    await db().execute(sql`update commerce.stores set custom_css = '.mine { color: #333333; }' where id = ${store}::uuid`);
    const { made } = await designs.themeUpdates(store);
    expect(await designs.undoThemeUpdate(store, made[0].id, owner)).toEqual({
      ok: false,
      problems: ["This theme has changed since it was updated, so the update cannot be undone. Nothing was changed."],
    });
  });

  it("is applied by the job only to installs that follow updates", async () => {
    const settings = v1Settings();
    settings.light.text = "#444444";
    await publishVersion(3, snapshot(settings, { headerText: "Welcome again", footerText: "Made by hand", css: ".v3 { color: #444444; }" }), null);
    expect(await installs.setFollowsUpdates(store, install, owner, false)).toMatchObject({ ok: true });
    await designs.runThemeUpdates(50, deps);
    expect((await one(sql`select v.number from commerce.store_theme_installs i join commerce.design_preset_versions v on v.id = i.version_id where i.id = ${install}::uuid`)).number).toBe(2);
    expect(await installs.setFollowsUpdates(store, install, owner, true)).toMatchObject({ ok: true });
    const job = await designs.runThemeUpdates(50, deps);
    expect(job.stores.map((s) => s.id)).toContain(store);
    expect((await one(sql`select v.number from commerce.store_theme_installs i join commerce.design_preset_versions v on v.id = i.version_id where i.id = ${install}::uuid`)).number).toBe(3);
    const { made } = await designs.themeUpdates(store);
    expect(made[0]).toMatchObject({ to: 3, automatic: true });
    // The owner's own CSS (set above) stays over the version's.
    expect((await storeLook()).custom_css).toBe(".mine { color: #333333; }");
    expect((await designs.themeUpdates(store)).available.find((a) => a.installId === install)).toBeUndefined();
  });

  it("is published with What's new, and never takes a core section style away", async () => {
    const [row] = await db().execute<Row>(sql`insert into commerce.accounts (email, name, platform_admin) values (${`upd-admin-${run}@example.com`}, 'Admin', true) returning id, email`);
    const admin = { id: String(row.id), email: String(row.email), name: "Admin", platformAdmin: true };
    const { parseDesignDetails } = await import("@/lib/design-presets");
    const parsed = parseDesignDetails({ title: `Scratch ${run}`, summary: "Quiet." });
    if (!parsed.ok) throw new Error(parsed.problems.join(" "));
    const made = await designs.createDesign(admin, { origin: { kind: "scratch" }, details: parsed.details }, deps);
    if (!made.ok) throw new Error(made.problems.join(" "));
    const workspace = (await designs.workspaceOf(admin, made.id))!.store;
    const { saveStoreTheme } = await import("./themes");
    const withHero = { ...templateSettings("minimal"), sectionStyles: { hero: { row: { radius: 4 } } } };
    expect(await saveStoreTheme(admin, workspace.id, { base: "minimal", savedId: null, settings: withHero })).toMatchObject({ ok: true });
    expect(await designs.publishDesign(admin, made.id, "  First light. ")).toMatchObject({ ok: true });
    expect((await one(sql`select notes from commerce.design_preset_versions where preset_id = ${made.id}::uuid and number = 1`)).notes).toBe("First light.");
    // A version without Hero is refused, and no version is added.
    expect(await saveStoreTheme(admin, workspace.id, { base: "minimal", savedId: null, settings: templateSettings("minimal") })).toMatchObject({ ok: true });
    const refused = await designs.publishDesign(admin, made.id, null);
    expect(refused.ok).toBe(false);
    expect(refused.ok ? "" : refused.problems[0]).toContain("core section style hero");
    expect((await one(sql`select count(*)::int as n from commerce.design_preset_versions where preset_id = ${made.id}::uuid`)).n).toBe(1);
  });
});

