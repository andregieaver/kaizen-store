import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parsePageContent, type PageContent, type PageType } from "@/lib/page-content";
import { VERSIONS_KEPT, type PageVersionItem, type VersionKind } from "@/lib/page-versions";

/**
 * A page's versions (D305): what was saved, published or changed on the site, kept so a person can look back and take an earlier version
 * into the page builder. A version is written in the same transaction as the save it records, only by `keepVersion()`, and never changed
 * (a trigger refuses it); a page keeps its newest `VERSIONS_KEPT`, the older go when a newer one is kept. Taking one back never saves or
 * publishes: the editor holds it as unsaved changes, so the person saves or publishes it as any other change.
 */

type Tx = { execute: ReturnType<typeof db>["execute"] };
type Row = Record<string, unknown>;

/**
 * Keeps a version of a page, in the caller's transaction: nothing when it is the same as the page's newest version, and the oldest past
 * `VERSIONS_KEPT` go.
 */
export async function keepVersion(
  tx: Tx,
  input: { owner: string | null; page: string; kind: VersionKind; content: string; account: string | null },
): Promise<void> {
  const [newest] = await tx.execute<Row>(sql`
    select md5(content::text) = md5(${input.content}::jsonb::text) as same, kind from commerce.page_versions
    where page_id = ${input.page}::uuid order by created_at desc, id desc limit 1
  `);
  // The same content again is no new version, unless it now went live: a publish of the saved draft is worth seeing as such.
  if (newest?.same && !(input.kind === "published" && newest.kind !== "published")) return;
  await tx.execute(sql`
    insert into commerce.page_versions (store_id, page_id, kind, content, created_by, created_at)
    values (${input.owner}::uuid, ${input.page}::uuid, ${input.kind}, ${input.content}::jsonb, ${input.account}::uuid, clock_timestamp())
  `);
  await tx.execute(sql`
    delete from commerce.page_versions where page_id = ${input.page}::uuid and id in (
      select id from commerce.page_versions where page_id = ${input.page}::uuid
      order by created_at desc, id desc offset ${VERSIONS_KEPT}
    )
  `);
}


/** A page's versions, newest first, for one owner's page of one type (another owner's page has none). */
export async function listVersions(owner: string | null, page: string, type: PageType): Promise<PageVersionItem[]> {
  const rows = await db().execute<Row>(sql`
    select v.id, v.kind, v.created_at, nullif(a.name, '') as by, v.content ->> 'title' as title
    from commerce.page_versions v
    join commerce.pages p on p.id = v.page_id
    left join commerce.accounts a on a.id = v.created_by
    where v.page_id = ${page}::uuid and p.store_id is not distinct from ${owner}::uuid and p.type = ${type}
    order by v.created_at desc, v.id desc
    limit ${VERSIONS_KEPT}
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as VersionKind,
    at: new Date(String(row.created_at)).toISOString(),
    by: row.by === null ? null : String(row.by),
    title: String(row.title ?? ""),
  }));
}

/** One version's content, for the page builder to hold; null for a version that is not this owner's page's. */
export async function readVersion(owner: string | null, page: string, type: PageType, version: string): Promise<PageContent | null> {
  const [row] = await db().execute<Row>(sql`
    select v.content from commerce.page_versions v
    join commerce.pages p on p.id = v.page_id
    where v.id = ${version}::uuid and v.page_id = ${page}::uuid and p.store_id is not distinct from ${owner}::uuid and p.type = ${type}
  `);
  return row ? parsePageContent(row.content) : null;
}
