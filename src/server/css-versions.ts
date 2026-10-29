import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import type { db } from "@/db/client";
import { CSS_VERSIONS_KEPT, type CssVersionItem } from "@/lib/css-versions";

import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Versions of a site's own CSS (wave 11 unit F, D385): the only writer of `commerce.css_versions`. Each save of the CSS panel
 * (`saveSiteCss()`: a store's, a theme's workspace's or Kaizena Flow's, `owner` null) keeps the CSS as it left it, in the save's own
 * transaction, with who saved it; the newest `CSS_VERSIONS_KEPT` per site stay. A version is never changed, and taking one back only puts
 * it in the panel as unsaved: nothing reaches visitors until Save.
 */

type Tx = { execute: ReturnType<typeof db>["execute"] };

const ownerIs = (owner: string | null) => sql`store_id is not distinct from ${owner}::uuid`;

/** Keeps the site's CSS as a save left it, in the caller's transaction: nothing when it is the newest version already. */
export async function keepCssVersion(tx: Tx, input: { owner: string | null; css: string; account: string | null }): Promise<void> {
  const newest = await typedRow(
    z.object({ same: col.bool }),
    sql`select css = ${input.css} as same from commerce.css_versions where ${ownerIs(input.owner)} order by created_at desc, id desc limit 1`,
    tx,
  );
  if (newest?.same) return;
  await tx.execute(sql`
    insert into commerce.css_versions (store_id, css, created_by, created_at)
    values (${input.owner}::uuid, ${input.css}, ${input.account}::uuid, clock_timestamp())
  `);
  await tx.execute(sql`
    delete from commerce.css_versions where ${ownerIs(input.owner)} and id in (
      select id from commerce.css_versions where ${ownerIs(input.owner)} order by created_at desc, id desc offset ${CSS_VERSIONS_KEPT}
    )
  `);
}

/** The site's versions of its CSS, newest first. */
export async function listCssVersions(owner: string | null): Promise<CssVersionItem[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, created_at: col.timestamp, by: col.textOrNull, length: col.int }),
    sql`
      select v.id, v.created_at, nullif(a.name, '') as by, char_length(v.css)::int as length
      from commerce.css_versions v left join commerce.accounts a on a.id = v.created_by
      where v.store_id is not distinct from ${owner}::uuid
      order by v.created_at desc, v.id desc
      limit ${CSS_VERSIONS_KEPT}
    `,
  );
  return rows.map((r) => ({ id: r.id, at: r.created_at, by: r.by, length: r.length }));
}

/** One of the site's versions; null for another site's or one that is gone. */
export async function readCssVersion(owner: string | null, versionId: string): Promise<string | null> {
  if (!z.uuid().safeParse(versionId).success) return null;
  const row = await typedRow(z.object({ css: col.text }), sql`select css from commerce.css_versions where id = ${versionId}::uuid and ${ownerIs(owner)}`);
  return row?.css ?? null;
}
