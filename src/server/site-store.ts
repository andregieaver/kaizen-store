import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";
import { z } from "zod";

import { SITE_STORE_TAG } from "@/lib/cache-tags";

import { col, typedRow } from "./typed-rows";

export { SITE_STORE_TAG } from "@/lib/cache-tags";

/**
 * Kaizena Flow's own store while its site is served from it (D484), else null: for what Kaizena Flow's host draws once and keeps, its
 * sitemap, robots.txt and llms.txt and the platform's own routes' consent. Cached, tagged `SITE_STORE_TAG`; the proxy reads the switch its
 * own way (`siteStore()`), every few seconds.
 */
export async function siteStoreCached(): Promise<{ id: string; slug: string } | null> {
  "use cache";
  cacheLife("hours");
  cacheTag(SITE_STORE_TAG);
  const row = await typedRow(
    z.object({ id: col.uuid, slug: col.text }),
    sql`select s.id, s.slug from commerce.platform_settings p join commerce.stores s on s.house and s.status = 'active' where p.site_from_store`,
  );
  return row ?? null;
}
