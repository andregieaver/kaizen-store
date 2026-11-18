import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, longerTimeout } from "@/db/client";
import type { StyleRow } from "@/lib/style-reading";

import { col, typedRows } from "./typed-rows";

const RowSchema = z.object({
  store_id: col.uuid.nullable(),
  slug: col.textOrNull,
  name: col.textOrNull,
  css_bytes: col.int,
  pages: col.int,
  motion_pages: col.int,
});

/** The parts of a published page that `motionNeeds()` in `src/lib/motion-attrs.ts` reads: an upper bound, since the path test also meets them in a draft-only field name. */
const MOTION = sql`(
  jsonb_path_exists(p.published, '$.**.motion.enter')
  or jsonb_path_exists(p.published, '$.**.motion.hover')
  or jsonb_path_exists(p.published, '$.**.motion.scroll')
  or jsonb_path_exists(p.published, '$.**.backgroundMotion.effect')
  or jsonb_path_exists(p.published, '$.**.backgroundLayers[*].scroll')
  or jsonb_path_exists(p.published, '$.**.backgroundLayers[*].ambient')
)`;

/**
 * The style text each store adds to every document (its own CSS, its header's and its footer's: the three sheets the market layout writes
 * with `<CustomCss>`), the published pages and those that use motion (bloat review step 1.23). One statement, taken on demand from
 * Platform, Usage and limits (`?reading=styles`): no page document leaves the database. Kaizena Flow's own site is the row with a null
 * store; the house store stays in.
 */
export async function styleReading(): Promise<StyleRow[]> {
  const rows = await db().transaction(async (tx) => {
    // The path test reads every published page once.
    await longerTimeout(tx, 30);
    return typedRows(
      RowSchema,
      sql`
        select s.id as store_id, s.slug, s.name,
               (octet_length(s.custom_css) + coalesce(octet_length(h.published->>'css'), 0) + coalesce(octet_length(f.published->>'css'), 0))::int as css_bytes,
               (select count(*)::int from commerce.pages p where p.store_id = s.id and p.type in ('page', 'article') and p.published is not null) as pages,
               (select count(*)::int from commerce.pages p where p.store_id = s.id and p.type in ('page', 'article') and p.published is not null and ${MOTION}) as motion_pages
        from commerce.stores s
        left join commerce.pages h on h.id = s.header_id
        left join commerce.pages f on f.id = s.footer_id
        where not (s.is_template or s.starter or s.sandbox)
        union all
        select null::uuid, null::text, null::text,
               (octet_length(ps.custom_css) + coalesce(octet_length(h.published->>'css'), 0) + coalesce(octet_length(f.published->>'css'), 0))::int,
               (select count(*)::int from commerce.pages p where p.store_id is null and p.type in ('page', 'article') and p.published is not null),
               (select count(*)::int from commerce.pages p where p.store_id is null and p.type in ('page', 'article') and p.published is not null and ${MOTION})
        from (select * from commerce.platform_settings limit 1) ps
        left join commerce.pages h on h.id = ps.header_id
        left join commerce.pages f on f.id = ps.footer_id
        order by css_bytes desc
      `,
      tx,
    );
  });
  return rows.map((r) => ({ storeId: r.store_id, slug: r.slug, name: r.name, cssBytes: r.css_bytes, pages: r.pages, motionPages: r.motion_pages }));
}
