import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { remembered } from "./short-memory";
import { FACTS_MS } from "./store-facts";
import { col, typedRow } from "./typed-rows";

/**
 * The switch that serves Kaizena Flow's site from its own store (D484, step 5 of `docs/platform-parity-plan.md`). On, the proxy answers every
 * page request on Kaizena Flow's own host that is no platform route (`platformKeeps()`) with the store's pages, and the store's own host sends
 * its visitors there; off, the platform's own pages answer as before. Switching needs no deployment: the proxy reads the switch every few
 * seconds (`siteStore()`), and the store's pages read it with the store (`Store.onSite`).
 */

export const SITE_KEY = "house|site";

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
