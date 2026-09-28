import "server-only";

import { sql } from "drizzle-orm";

import type { db } from "@/db/client";
import {
  asDoc,
  fromDoc,
  refreshUses,
  sameJson,
  type AnyPart,
  type GlobalPart,
  type PartKind,
  type Translations,
} from "@/lib/global-parts";
import { pageInput, type PageContent, type PageType } from "@/lib/page-content";

import { pageRulesProblem } from "./page-rules";

/**
 * Global rows, columns and components (D98) on the server: when a global
 * changes, the saved parts holding a use of it follow (components first,
 * then columns, then rows, so a global inside another is taken along),
 * then every page, draft and live, of its owner. All inside the caller's
 * transaction; a page the change would make invalid stops it all.
 */

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];
type Row = Record<string, unknown>;
type Owner = string | null;

/** A saved part as stored. */
export type StoredPart = { id: string; kind: PartKind; name: string; global: boolean; content: AnyPart; translations: Translations };

/** The changes cannot be made: a page would become one that cannot be saved. */
export class GlobalsRefused extends Error {
  constructor(readonly problems: string[]) {
    super(problems.join(" "));
  }
}

const KINDS: PartKind[] = ["block", "column", "row"];

/** The owner's saved parts, locked until the transaction ends. */
export async function lockSavedParts(tx: Tx, owner: Owner): Promise<StoredPart[]> {
  const rows = await tx.execute<Row>(sql`
    select id, kind, name, global, content, translations from commerce.saved_parts
    where store_id is not distinct from ${owner}::uuid
    order by created_at
    for update
  `);
  return rows.map((row) => ({
    id: String(row.id),
    kind: row.kind as PartKind,
    name: String(row.name),
    global: Boolean(row.global),
    content: row.content as AnyPart,
    translations: (row.translations ?? {}) as Translations,
  }));
}

/** The globals among saved parts, by id. */
export function globalsIn(parts: StoredPart[]): Map<string, GlobalPart> {
  return new Map(
    parts.filter((p) => p.global).map((p) => [p.id, { id: p.id, kind: p.kind, content: p.content, translations: p.translations }]),
  );
}

const mentions = (value: unknown, ids: string[]) => {
  const text = JSON.stringify(value ?? null);
  return ids.some((id) => text.includes(id));
};

/**
 * Takes `changed` globals (their new content) and `detach` (globals that
 * are gone or no longer global) to the saved parts and pages that use
 * them. `skip` is a page whose draft (and, while it is published now, live
 * version) the caller writes itself. Returns every global as it now is,
 * and how many pages changed.
 */
export async function spreadGlobals(
  tx: Tx,
  { accountId, owner, parts, changed, detach = new Set(), skip }: {
    accountId: string;
    owner: Owner;
    parts: StoredPart[];
    changed: GlobalPart[];
    detach?: ReadonlySet<string>;
    skip?: { id: string; published: boolean };
  },
): Promise<{ globals: Map<string, GlobalPart>; pages: number }> {
  const globals = globalsIn(parts.filter((p) => !detach.has(p.id)));
  const following = new Map<string, GlobalPart>();
  const writes = new Map<string, { content: AnyPart; translations: Translations }>();
  for (const global of changed) {
    globals.set(global.id, global);
    following.set(global.id, global);
    writes.set(global.id, global);
  }
  const isDetached = (id: string) => detach.has(id);
  const moved = () => [...following.keys(), ...detach];

  // Saved parts holding uses follow, a kind at a time.
  for (const kind of KINDS) {
    for (const part of parts) {
      if (part.kind !== kind || moved().length === 0) continue;
      const current = writes.get(part.id) ?? part;
      if (!mentions(current.content, moved())) continue;
      const doc = refreshUses(asDoc(kind, current.content, current.translations), following, isDetached);
      const next = { content: fromDoc(kind, doc), translations: doc.translations ?? {} };
      if (sameJson(next, { content: current.content, translations: current.translations })) continue;
      writes.set(part.id, next);
      if (part.global && !detach.has(part.id)) {
        const global = { id: part.id, kind, ...next };
        globals.set(part.id, global);
        following.set(part.id, global);
      }
    }
  }
  for (const [id, part] of writes) {
    await tx.execute(sql`
      update commerce.saved_parts
         set content = ${JSON.stringify(part.content)}::jsonb, translations = ${JSON.stringify(part.translations)}::jsonb,
             updated_at = now(), updated_by = ${accountId}::uuid
       where id = ${id}::uuid
    `);
  }

  const ids = moved();
  if (ids.length === 0) return { globals, pages: 0 };
  const anyOf = sql.join(
    ids.map((id) => sql`(p.draft::text like ${`%${id}%`} or coalesce(p.published::text, '') like ${`%${id}%`})`),
    sql` or `,
  );
  const pages = await tx.execute<Row>(sql`
    select p.id, p.type, p.draft, p.published from commerce.pages p
    where p.store_id is not distinct from ${owner}::uuid and (${anyOf})
    for update
  `);
  const problems: string[] = [];
  let count = 0;
  for (const page of pages) {
    const id = String(page.id);
    const type = page.type as PageType;
    const check = (content: PageContent | null, skipped: boolean) => {
      if (!content || skipped) return null;
      const next = refreshUses(content, following, isDetached);
      if (sameJson(next, content)) return null;
      const parsed = pageInput.safeParse(next);
      const problem = parsed.success
        ? pageRulesProblem(owner, type, parsed.data)
        : [...new Set(parsed.error.issues.map((i) => i.message))].join(" ");
      if (problem) problems.push(`It is also on “${content.title}”, which could then not be saved: ${problem}`);
      return next;
    };
    const draft = check(pageInput.safeParse(page.draft).data ?? null, skip?.id === id);
    const published = page.published ? check(pageInput.safeParse(page.published).data ?? null, skip?.id === id && skip.published) : null;
    if (!draft && !published) continue;
    count += 1;
    await tx.execute(sql`
      update commerce.pages set
        draft = coalesce(${draft ? JSON.stringify(draft) : null}::jsonb, draft),
        published = coalesce(${published ? JSON.stringify(published) : null}::jsonb, published),
        published_at = case when ${published !== null} then now() else published_at end,
        updated_at = now(), updated_by = ${accountId}::uuid
      where id = ${id}::uuid
    `);
  }
  if (problems.length > 0) throw new GlobalsRefused([...new Set(problems)]);
  return { globals, pages: count };
}
