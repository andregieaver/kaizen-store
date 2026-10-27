import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isLookVersionKind, LOOK_VERSIONS_KEPT, type LookVersionItem, type LookVersionKind } from "@/lib/look-versions";
import { parseStoreTheme, type StoreTheme } from "@/lib/theme";

import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Versions of a store's live look (wave 7 unit F, D340, `docs/wave-7-storefront.md` F): the only writer of `commerce.look_versions`. Each
 * save of the live theme (Design settings, the page builder's Theme tab, its saved colours; all through `saveStoreTheme()`) keeps the theme
 * as it left it, in the save's own transaction, with who saved it; the newest `LOOK_VERSIONS_KEPT` per store stay. A version is never
 * changed, and taking one back only loads it into the theme editor as unsaved changes: nothing reaches visitors until Save.
 */

type Tx = { execute: ReturnType<typeof db>["execute"] };

/** Keeps the store's theme as a save left it, in the caller's transaction: nothing when it is the newest version already. */
export async function keepLookVersion(tx: Tx, input: { store: string; kind: LookVersionKind; theme: StoreTheme; account: string | null }): Promise<void> {
  const json = JSON.stringify(input.theme);
  const newest = await typedRow(
    z.object({ same: col.bool }),
    sql`
      select md5(theme::text) = md5(${json}::jsonb::text) as same from commerce.look_versions
      where store_id = ${input.store}::uuid order by created_at desc, id desc limit 1
    `,
    tx,
  );
  if (newest?.same) return;
  await tx.execute(sql`
    insert into commerce.look_versions (store_id, kind, theme, created_by, created_at)
    values (${input.store}::uuid, ${input.kind}, ${json}::jsonb, ${input.account}::uuid, clock_timestamp())
  `);
  await tx.execute(sql`
    delete from commerce.look_versions where store_id = ${input.store}::uuid and id in (
      select id from commerce.look_versions where store_id = ${input.store}::uuid
      order by created_at desc, id desc offset ${LOOK_VERSIONS_KEPT}
    )
  `);
}

/** The store's versions of its look, newest first. */
export async function listLookVersions(storeId: string): Promise<LookVersionItem[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, kind: col.text, created_at: col.timestamp, by: col.textOrNull }),
    sql`
      select v.id, v.kind, v.created_at, nullif(a.name, '') as by
      from commerce.look_versions v left join commerce.accounts a on a.id = v.created_by
      where v.store_id = ${storeId}::uuid
      order by v.created_at desc, v.id desc
      limit ${LOOK_VERSIONS_KEPT}
    `,
  );
  return rows.flatMap((r) => (isLookVersionKind(r.kind) ? [{ id: r.id, kind: r.kind, at: r.created_at, by: r.by }] : []));
}

/** One of the store's versions, as a theme the editor can hold; null for another store's or one that is gone. */
export async function readLookVersion(storeId: string, versionId: string): Promise<StoreTheme | null> {
  if (!/^[0-9a-f-]{36}$/i.test(versionId)) return null;
  const row = await typedRow(
    z.object({ theme: z.unknown() }),
    sql`select theme from commerce.look_versions where id = ${versionId}::uuid and store_id = ${storeId}::uuid`,
  );
  return row ? parseStoreTheme(row.theme) : null;
}
