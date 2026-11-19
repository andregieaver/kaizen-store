import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { pagesTag, SITE_STORE_TAG, STORES_TAG, storeTag } from "@/lib/cache-tags";

import { audit, type Account } from "./auth";
import { lastSiteCopy } from "./house-site";
import { log } from "./log";
import { forgetStoreFacts } from "./store-facts";
import { forgetRemembered } from "./redirect-live";
import { refreshTag } from "./refresh";
import { SITE_KEY } from "./site-switch-read";
import { col, typedRow } from "./typed-rows";

export { siteStore } from "./site-switch-read";

export type SiteSwitch = {
  on: boolean;
  /** When it was last switched, and by whom (a name or an email), or null. */
  at: string | null;
  by: string | null;
  /** When the site was last copied into the store (step 3), or null: never. */
  copiedAt: string | null;
  /** The store's slug, or null when Kaizena Flow's store does not exist. */
  store: string | null;
};

/** What Platform → Website shows of the switch. */
export async function siteSwitch(): Promise<SiteSwitch> {
  const [row, copy] = await Promise.all([
    typedRow(
      z.object({ on: col.bool, at: col.timestampOrNull, by: col.textOrNull, store: col.textOrNull }),
      sql`select p.site_from_store as on, p.site_from_store_at as at,
                 (select coalesce(a.name, a.email) from commerce.accounts a where a.id = p.site_from_store_by) as by,
                 (select s.slug from commerce.stores s where s.house) as store
            from commerce.platform_settings p`,
    ),
    lastSiteCopy(),
  ]);
  return {
    on: row?.on ?? false,
    at: row?.at ? new Date(row.at).toISOString() : null,
    by: row?.by ?? null,
    copiedAt: copy.copiedAt,
    store: row?.store ?? null,
  };
}

export type SwitchResult = { ok: true; changed: boolean } | { ok: false; problem: "not_allowed" | "no_store" | "not_copied" | "failed" };

/**
 * Switches Kaizena Flow's site to its own store or back (a platform admin's action), audited as `platform.site_from_store`. On needs the site
 * copied into the store first (step 3); the store is made public with it, and private again when it goes off (`commerce.set_site_from_store()`).
 * Every cached read of the store goes, so its pages are drawn again with their new addresses.
 */
export async function setSiteFromStore(account: Account, on: boolean): Promise<SwitchResult> {
  if (!account.platformAdmin) return { ok: false, problem: "not_allowed" };
  const now = await siteSwitch();
  if (!now.store) return { ok: false, problem: "no_store" };
  if (on && !now.copiedAt) return { ok: false, problem: "not_copied" };
  let changed: boolean;
  try {
    const row = await typedRow(z.object({ changed: col.bool }), sql`select commerce.set_site_from_store(${on}, ${account.id}::uuid) as changed`);
    changed = row?.changed ?? false;
  } catch (error) {
    log("error", "house_site.switch_failed", { account: account.id, on }, error);
    return { ok: false, problem: "failed" };
  }
  forgetRemembered(SITE_KEY);
  forgetStoreFacts(now.store);
  refreshTag(storeTag(now.store));
  refreshTag(STORES_TAG);
  refreshTag(SITE_STORE_TAG);
  const [store] = await db().execute<{ id: string }>(sql`select id from commerce.stores where house`);
  if (store) refreshTag(pagesTag(String(store.id)));
  if (changed) {
    await audit(account.id, store ? String(store.id) : null, "platform.site_from_store", { on }, {
      area: "website",
      target: { type: "store", id: store ? String(store.id) : "" },
      changes: { siteFromStore: { from: !on, to: on } },
    });
  }
  return { ok: true, changed };
}
