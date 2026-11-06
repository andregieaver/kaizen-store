import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";


import { audit, type Account } from "./auth";
import { houseStoreId } from "./house-customers";
import { log } from "./log";
import { pagesTag } from "./pages";
import { refreshTag } from "./refresh";
import { refreshStoreById } from "./stores";
import { termsTag } from "./taxonomy";
import { textStylesTag } from "./text-styles";
import { col, typedRow } from "./typed-rows";

/**
 * Kaizena Flow's site copied into its own store (D469, `docs/platform-parity-plan.md` step 3): `commerce.copy_platform_site()` copies the
 * platform's own pages, header, footer, menus, saved parts, text styles, categories and content, and the site's look and SEO, into Kaizena
 * Flow's own store, where it can be looked at behind the store's private mode beside the live site. Run by a platform admin from Platform →
 * Website, as often as wanted: each run lands on the same copies and brings the latest. Nothing of the live site changes.
 */

export type SiteCopy = { copiedAt: string | null; rows: number };

/** When the site was last copied into Kaizena Flow's store, and how many of its rows the copy holds. */
export async function lastSiteCopy(): Promise<SiteCopy> {
  const row = await typedRow(
    z.object({ copied_at: col.timestampOrNull, rows: col.int }),
    sql`select max(copied_at) as copied_at, count(*)::int as rows from commerce.house_site_copies`,
  );
  return { copiedAt: row?.copied_at ? new Date(row.copied_at).toISOString() : null, rows: row?.rows ?? 0 };
}

export type CopyResult = { ok: true; counts: Record<string, number> } | { ok: false; problem: "no_store" | "on_site" | "failed" };

/** Copies the platform's own site into Kaizena Flow's own store (a platform admin's action), then lets every cached read of the store go. */
export async function copySiteIntoHouse(account: Account): Promise<CopyResult> {
  if (!account.platformAdmin) return { ok: false, problem: "failed" };
  const house = await houseStoreId();
  if (!house) return { ok: false, problem: "no_store" };
  // While the site is served from the store (D474) the store's pages are the live site: a copy would put the platform's old pages over them.
  const on = await typedRow(z.object({ on: col.bool }), sql`select site_from_store as on from commerce.platform_settings`);
  if (on?.on) return { ok: false, problem: "on_site" };
  let counts: Record<string, number>;
  try {
    const row = await typedRow(z.object({ counts: z.record(z.string(), z.number()) }), sql`select commerce.copy_platform_site(${account.id}::uuid) as counts`);
    counts = row?.counts ?? {};
  } catch (error) {
    log("error", "house_site.copy_failed", { account: account.id }, error);
    return { ok: false, problem: "failed" };
  }
  await refreshStoreById(house);
  refreshTag(pagesTag(house));
  refreshTag(textStylesTag(house));
  refreshTag(termsTag({ storeId: house, contentType: "article" }));
  refreshTag(`menus:${house}`);
  await audit(account.id, house, "platform.site_copied", { counts }, { area: "website", target: { type: "store", id: house } });
  return { ok: true, counts };
}
