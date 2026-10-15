import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { cssProblem } from "@/lib/custom-css";

import { audit, type Account } from "./auth";

/**
 * Kaizena Flow's own installed themes (phase 4 of `docs/theme-store.md`, `docs/theme-phase-4.md` step 1): as a store's (D241, `theme-installs.ts`),
 * one live, whose look is `platform_settings`' columns (`theme`, `fonts`, `custom_css`, `header_id`, `footer_id`), read as ever by the
 * platform's layout and builder; an install that is not live keeps its look in its row. Switching swaps the two in one transaction, so what
 * visitors see changes at once and nothing else does: no page, article, menu, word or picture is touched. This module and
 * `installPresetOnPlatform()` are the only writers of `platform_theme_installs` (a scan test). Every function is a platform admin's; callers
 * refresh `PLATFORM_NAVIGATION_TAG` and `PAGES_TAG`.
 */

type Row = Record<string, unknown>;
type Tx = Pick<ReturnType<typeof db>, "execute">;

/** The look an install keeps while it is not live: `platform_settings`' look columns as they were. */
export type PlatformLook = { theme: unknown; fonts: unknown; css: string; headerId: string | null; footerId: string | null };

export type PlatformInstall = {
  id: string;
  title: string;
  /** The theme it came from; null: *Custom*, Kaizena Flow's own look. */
  presetId: string | null;
  version: number | null;
  live: boolean;
  installedAt: string;
  switchedAt: string | null;
};

export type PlatformInstallResult<T = Record<never, never>> = ({ ok: true } & T) | { ok: false; problems: string[] };

/** At most this many themes installed on Kaizena Flow's site, as for a store. */
export const PLATFORM_INSTALLS_MAX = 20;

const UNKNOWN = "That theme is not installed on Kaizena Flow's site.";
const ADMINS_ONLY = "Only Kaizena Flow's admins change its site's look.";
const refuse = (problem: string) => ({ ok: false as const, problems: [problem] });
const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

class Refused extends Error {}

/** Kaizena Flow's installed themes, the live one first, then the newest. */
export async function listPlatformInstalls(): Promise<PlatformInstall[]> {
  const rows = await db().execute<Row>(sql`
    select i.id, i.title, i.preset_id, v.number as version, i.live, i.installed_at, i.switched_at
    from commerce.platform_theme_installs i
    left join commerce.design_preset_versions v on v.id = i.version_id
    order by i.live desc, i.installed_at desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    presetId: row.preset_id ? String(row.preset_id) : null,
    version: row.version == null ? null : Number(row.version),
    live: Boolean(row.live),
    installedAt: new Date(String(row.installed_at)).toISOString(),
    switchedAt: row.switched_at ? new Date(String(row.switched_at)).toISOString() : null,
  }));
}

/** How many themes Kaizena Flow's site has installed. */
export async function platformInstallCount(tx: Tx = db()): Promise<number> {
  const [row] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.platform_theme_installs`);
  return Number(row?.n ?? 0);
}

/**
 * Inside a transaction holding `platform_settings`' row (`for update`): the live install is put away with the site's look as it is now, and
 * its id and title returned. If there is somehow no live install, a *Custom* one is made and put away the same way.
 */
export async function putAwayPlatformLive(tx: Tx): Promise<{ id: string; title: string }> {
  const [settings] = await tx.execute<Row>(sql`select theme, fonts, custom_css, header_id, footer_id from commerce.platform_settings`);
  const look: PlatformLook = {
    theme: settings?.theme ?? null,
    fonts: settings?.fonts ?? {},
    css: String(settings?.custom_css ?? ""),
    headerId: settings?.header_id ? String(settings.header_id) : null,
    footerId: settings?.footer_id ? String(settings.footer_id) : null,
  };
  const json = JSON.stringify(look);
  const [put] = await tx.execute<Row>(sql`
    update commerce.platform_theme_installs set live = false, look = ${json}::jsonb, switched_at = now() where live returning id, title
  `);
  if (put) return { id: String(put.id), title: String(put.title) };
  const [made] = await tx.execute<Row>(sql`
    insert into commerce.platform_theme_installs (title, look, switched_at) values ('Custom', ${json}::jsonb, now()) returning id, title
  `);
  return { id: String(made.id), title: String(made.title) };
}

/**
 * Inside the same transaction: writes a kept look into `platform_settings`, checked again as it goes in: a header or footer only while it is
 * still one of Kaizena Flow's published pages of its kind (else the standard one), the CSS only while `cssProblem()` passes it. Returns what
 * was left out, for the admin.
 */
async function writePlatformLook(tx: Tx, kept: unknown): Promise<string[]> {
  const look = (kept && typeof kept === "object" ? kept : {}) as Partial<PlatformLook>;
  const notes: string[] = [];
  const layout = async (id: unknown, type: "header" | "footer") => {
    if (typeof id !== "string" || !isUuid(id)) return null;
    const [page] = await tx.execute<Row>(sql`
      select id from commerce.pages where store_id is null and id = ${id}::uuid and type = ${type} and published_at is not null
    `);
    if (!page) notes.push(`Its ${type} is no longer published, so the standard one is shown.`);
    return page ? id : null;
  };
  const theme = look.theme && typeof look.theme === "object" ? look.theme : null;
  const fonts = look.fonts && typeof look.fonts === "object" ? look.fonts : {};
  const css = typeof look.css === "string" && cssProblem(look.css) === null ? look.css : "";
  if (typeof look.css === "string" && look.css !== css) notes.push("Its own CSS could not be used and was left out.");
  await tx.execute(sql`
    update commerce.platform_settings set theme = ${theme === null ? null : JSON.stringify(theme)}::jsonb, fonts = ${JSON.stringify(fonts)}::jsonb,
      custom_css = ${css}, header_id = ${await layout(look.headerId, "header")}::uuid, footer_id = ${await layout(look.footerId, "footer")}::uuid
  `);
  return notes;
}

/**
 * Switches Kaizena Flow's site to one of its installed themes: the live one is put away with the look as it is now (every change made to it
 * kept), the chosen one becomes live. One transaction; the caller refreshes the platform's look tags.
 */
export async function switchPlatformInstall(admin: Account, installId: string): Promise<PlatformInstallResult<{ title: string; from: string; notes: string[] }>> {
  if (!admin.platformAdmin) return refuse(ADMINS_ONLY);
  if (!isUuid(installId)) return refuse(UNKNOWN);
  let done: { title: string; from: string; fromId: string; notes: string[] };
  try {
    done = await db().transaction(async (tx) => {
      await tx.execute(sql`select 1 from commerce.platform_settings for update`);
      const [target] = await tx.execute<Row>(sql`select title, look, live from commerce.platform_theme_installs where id = ${installId}::uuid for update`);
      if (!target) throw new Refused(UNKNOWN);
      if (target.live) throw new Refused("That theme is live already.");
      const from = await putAwayPlatformLive(tx);
      // The look first: putting the row live clears its kept look.
      const notes = await writePlatformLook(tx, target.look);
      await tx.execute(sql`update commerce.platform_theme_installs set live = true, look = null, switched_at = now() where id = ${installId}::uuid`);
      return { title: String(target.title), from: from.title, fromId: from.id, notes };
    });
  } catch (error) {
    if (error instanceof Refused) return refuse(error.message);
    console.error("[platform-theme-installs] switching failed", error);
    return refuse("The theme could not be switched. Nothing was changed; try again.");
  }
  await audit(admin.id, null, "platform.theme_switched", { install: installId, title: done.title, from: done.fromId }, {
    target: { type: "theme_install", id: installId },
  });
  return { ok: true, title: done.title, from: done.from, notes: done.notes };
}

/** Removes an installed theme that is not live. The header and footer pages it chose stay among Kaizena Flow's pages. */
export async function removePlatformInstall(admin: Account, installId: string): Promise<PlatformInstallResult<{ title: string }>> {
  if (!admin.platformAdmin) return refuse(ADMINS_ONLY);
  if (!isUuid(installId)) return refuse(UNKNOWN);
  const [row] = await db().execute<Row>(sql`
    delete from commerce.platform_theme_installs where id = ${installId}::uuid and not live returning title, preset_id
  `);
  if (!row) return refuse("Only a theme that is not live can be removed.");
  await audit(admin.id, null, "platform.theme_removed", { install: installId, title: String(row.title), preset: row.preset_id ?? null }, {
    target: { type: "theme_install", id: installId },
  });
  return { ok: true, title: String(row.title) };
}
