import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { audit, type Account } from "./auth";
import { lastSiteCopy } from "./house-site";
import { log } from "./log";
import { pagesTag } from "./pages";
import { FACTS_MS, forgetStoreFacts } from "./redirect-resolve";
import { forgetRemembered, remembered } from "./redirect-live";
import { refreshTag } from "./refresh";
import { STORES_TAG } from "./seo";
import { SITE_STORE_TAG } from "./site-store";
import { storeTag } from "./stores";
import { col, typedRow } from "./typed-rows";

/**
 * The switch that serves Kaizena Flow's site from its own store (D474, step 5 of `docs/platform-parity-plan.md`). On, the proxy answers every
 * page request on Kaizena Flow's own host that is no platform route (`platformKeeps()`) with the store's pages, and the store's own host sends
 * its visitors there; off, the platform's own pages answer as before. Switching needs no deployment: the proxy reads the switch every few
 * seconds (`siteStore()`), and the store's pages read it with the store (`Store.onSite`).
 */

const SITE_KEY = "house|site";

/** The slug of the store whose pages are Kaizena Flow's site while the switch is on (`kaizenaflow`), else null. Remembered for `FACTS_MS` per instance. */
export async function siteStore(): Promise<string | null> {
  return remembered(
    SITE_KEY,
    async () => {
      const row = await typedRow(
        z.object({ slug: col.text }),
        sql`select s.slug from commerce.platform_settings p join commerce.stores s on s.house and s.status = 'active' where p.site_from_store`,
      );
      return row?.slug ?? null;
    },
    FACTS_MS,
  );
}

/** Whether Kaizena Flow's site is served from its store now, past this instance's memory: for the admin's writers of the platform's own site. */
export async function siteFromStoreNow(): Promise<boolean> {
  const row = await typedRow(z.object({ on: col.bool }), sql`select site_from_store as on from commerce.platform_settings`);
  return row?.on ?? false;
}

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
