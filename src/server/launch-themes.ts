import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LAUNCH_THEMES, launchListing, launchVariation, type LaunchTheme } from "@/lib/launch-themes";

import { audit, type Account } from "./auth";
import { createDesign, markLaunchTheme, publishDesign, saveDesignDraft, writeDesignLook, type ApplyDeps } from "./design-presets";
import { writeLaunchVariations } from "./design-variations";
import { dressSignaturePacks } from "./signature-themes";

/**
 * Kaizena Flow's launch themes (D246, `src/lib/launch-themes.ts`) brought into the platform's themes on a platform admin's press: each one
 * not there yet is made (a theme from scratch with its look written into the workspace and its details), checked and published; each one
 * whose definition in code is newer than the version published is written and published again, with its notes as *What's new*, which
 * installs that follow updates take (D245). A theme an admin archived is left alone. One theme failing never stops the others.
 */

type Row = Record<string, unknown>;

export type LaunchSync = { made: string[]; updated: string[]; current: string[]; skipped: string[]; problems: string[] };

/** Where each launch theme stands, for the platform's themes page. */
export async function launchThemeStates(): Promise<{ key: string; title: string; version: number; published: number | null; presetId: string | null; archived: boolean }[]> {
  const rows = await db().execute<Row>(sql`select id, launch_key, launch_version, archived_at from commerce.design_presets where launch_key is not null`);
  const byKey = new Map(rows.map((row) => [String(row.launch_key), row]));
  return LAUNCH_THEMES.map((theme) => {
    const row = byKey.get(theme.key);
    return {
      key: theme.key,
      title: theme.title,
      version: theme.version,
      published: row?.launch_version == null ? null : Number(row.launch_version),
      presetId: row ? String(row.id) : null,
      archived: Boolean(row?.archived_at),
    };
  });
}

/**
 * A launch theme's details as the code writes them; its main picture is the platform admin's (`docs/theme-showcase-phase-2.md` step 3:
 * their own in place of the made card), so a new version keeps the one it has.
 */
const details = (theme: LaunchTheme, pictureUrl: string | null) => ({ title: theme.title, summary: theme.summary, description: theme.description, pictureUrl });

/** Writes a launch theme's look and details into its profile and publishes it; records the version only once it is published. */
async function publishLaunch(admin: Account, presetId: string, theme: LaunchTheme, first: boolean, deps: ApplyDeps): Promise<string | null> {
  const written = await writeDesignLook(admin, presetId, theme.snapshot, deps);
  if (!written.ok) return written.problems.join(" ");
  // Its presets (`docs/theme-showcase-phase-1.md` step 3), each the theme's look with its changes, into the draft Publish reads.
  const presets = await writeLaunchVariations(admin, presetId, theme.presets.map((preset) => launchVariation(theme, preset)), deps);
  if (!presets.ok) return presets.problems.join(" ");
  const [kept] = await db().execute<Row>(sql`select picture_url from commerce.design_presets where id = ${presetId}::uuid`);
  const saved = await saveDesignDraft(admin, presetId, details(theme, kept?.picture_url ? String(kept.picture_url) : null));
  if (!saved.ok) return saved.problems.join(" ");
  const published = await publishDesign(admin, presetId, first ? null : theme.notes);
  if (!published.ok) return published.problems.join(" ");
  await markLaunchTheme(presetId, theme.key, theme.version, launchListing(theme));
  return null;
}

export async function syncLaunchThemes(admin: Account, deps: ApplyDeps = {}): Promise<LaunchSync> {
  const result: LaunchSync = { made: [], updated: [], current: [], skipped: [], problems: [] };
  if (!admin.platformAdmin) return { ...result, problems: ["Only Kaizena Flow's admins add its themes."] };
  for (const theme of LAUNCH_THEMES) {
    const [row] = await db().execute<Row>(sql`select id, launch_version, archived_at from commerce.design_presets where launch_key = ${theme.key}`);
    if (row?.archived_at) {
      result.skipped.push(theme.title);
      continue;
    }
    if (row && row.launch_version != null && Number(row.launch_version) >= theme.version) {
      // Up to date; its listing in the theme store still follows the code's (`docs/theme-phase-3.md`).
      await markLaunchTheme(String(row.id), theme.key, null, launchListing(theme));
      result.current.push(theme.title);
      continue;
    }
    let presetId = row ? String(row.id) : null;
    const first = !row || row.launch_version == null;
    if (!presetId) {
      const made = await createDesign(admin, { details: details(theme, null), origin: { kind: "scratch" } }, deps);
      if (!made.ok) {
        result.problems.push(`${theme.title}: ${made.problems.join(" ")}`);
        continue;
      }
      presetId = made.id;
      // Claimed at once, so a second press finds it rather than making another.
      await markLaunchTheme(presetId, theme.key, null);
    }
    const problem = await publishLaunch(admin, presetId, theme, first, deps);
    if (problem) result.problems.push(`${theme.title}: ${problem}`);
    else (first ? result.made : result.updated).push(theme.title);
  }
  if (result.made.length + result.updated.length > 0) {
    // A signature theme's demo store wears it once both are there (`dressSignaturePacks()`).
    result.problems.push(...(await dressSignaturePacks(admin, deps)));
    await audit(admin.id, null, "platform.launch_themes_synced", { made: result.made, updated: result.updated });
  }
  return result;
}
