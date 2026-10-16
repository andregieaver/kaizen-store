import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { LAUNCH_THEMES } from "@/lib/launch-themes";

import type { Account } from "./auth";
import { applyDesignPreset, designTags, updateThemeInstall, type ApplyDeps } from "./design-presets";
import { refreshTag } from "./refresh";

/**
 * A signature theme's demo store wears its theme (`docs/signature-themes.md` step 1). Far Light is drawn for Orbit: its pages, art and words
 * were made for that look, so the store template's own preview, the starter cards and the stores copied from it show it in Orbit, never in
 * the default template's look, and the template recommends Orbit (D176) where a new store chooses its look.
 *
 * Both syncs call it (the pack and its theme are written by two presses, in either order): it does nothing until both are there, the theme
 * published and neither archived. Its look comes only through `applyDesignPreset()` the first time and `updateThemeInstall()` for a newer
 * version, so the store's look before stays in its theme library and nothing piles up on a second press. A recommendation the platform's admin
 * chose is kept. Never throws: a problem is said.
 */
type Row = Record<string, unknown>;

export async function dressSignaturePacks(admin: Account, deps: ApplyDeps = {}): Promise<string[]> {
  const problems: string[] = [];
  if (!admin.platformAdmin) return problems;
  for (const theme of LAUNCH_THEMES) {
    if (!theme.signature) continue;
    try {
      const [row] = await db().execute<Row>(sql`
        select ss.id as starter_id, s.id as store_id, s.slug, p.id as preset_id,
          (select v.id from commerce.design_preset_versions v where v.preset_id = p.id order by v.number desc limit 1) as latest_version,
          (select i.id from commerce.store_theme_installs i where i.store_id = s.id and i.live and i.preset_id = p.id) as live_install,
          (select i.version_id from commerce.store_theme_installs i where i.store_id = s.id and i.live and i.preset_id = p.id) as live_version
        from commerce.store_starters ss
        join commerce.stores s on s.id = ss.store_id
        join commerce.design_presets p on p.launch_key = ${theme.key} and p.published and p.archived_at is null
        where ss.pack_key = ${theme.listing.pack} and ss.archived_at is null and s.status = 'active'
      `);
      if (!row?.latest_version) continue;
      const storeId = String(row.store_id);
      await db().execute(sql`
        update commerce.store_starters set recommended_design = ${String(row.preset_id)}::uuid
        where id = ${String(row.starter_id)}::uuid and recommended_design is null
      `);
      if (row.live_install && String(row.live_version) === String(row.latest_version)) continue;
      const done = row.live_install
        ? await updateThemeInstall(storeId, String(row.live_install), admin.id, deps)
        : await applyDesignPreset(storeId, String(row.preset_id), admin.id, deps);
      if (!done.ok) problems.push(`${theme.title} on its demo store: ${done.problems.join(" ")}`);
      for (const tag of designTags({ id: storeId, slug: String(row.slug) })) refreshTag(tag);
    } catch (error) {
      console.error(`[signature-themes] ${theme.key} could not dress its demo store`, error);
      problems.push(`${theme.title} could not dress its demo store: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return problems;
}
