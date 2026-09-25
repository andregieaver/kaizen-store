import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { SAVED_PARTS_MAX, parseSavedPart, savedPartInput, type SavedPart } from "@/lib/saved-parts";

import { audit, type Account } from "./auth";

/**
 * Saved rows, columns and components (D46) for the page builder's Saved
 * tab: Kaizen's (`owner` null) and each store's own (D53). Read fresh when
 * the editor opens: they are only for the owner's editors.
 */

type Row = Record<string, unknown>;

export type SavedResult = { ok: true; parts: SavedPart[]; id: string } | { ok: false; problems: string[] };

/** Whose: a store's id, or null for Kaizen's. */
type Owner = string | null;
const ownedBy = (owner: Owner) => sql`store_id is not distinct from ${owner}::uuid`;
const actionPrefix = (owner: Owner) => (owner === null ? "platform" : "store");

export async function listSavedParts(owner: Owner): Promise<SavedPart[]> {
  const rows = await db().execute<Row>(sql`
    select id, kind, name, content, updated_at from commerce.saved_parts
    where ${ownedBy(owner)}
    order by kind, lower(name), created_at
  `);
  return rows.flatMap((row) => {
    const part = parseSavedPart({
      id: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      content: row.content,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
    });
    return part ? [part] : [];
  });
}

const problemsOf = (issues: { message: string }[]) => [...new Set(issues.map((i) => i.message))];

/** Saves a row, column or component under a name. */
export async function createSavedPart(account: Account, owner: Owner, input: unknown): Promise<SavedResult> {
  const parsed = savedPartInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  const [count] = await db().execute<Row>(sql`select count(*)::int as n from commerce.saved_parts where ${ownedBy(owner)}`);
  if (Number(count?.n) >= SAVED_PARTS_MAX) {
    return { ok: false, problems: [`At most ${SAVED_PARTS_MAX} saved parts. Delete some first.`] };
  }
  const [row] = await db().execute<Row>(sql`
    insert into commerce.saved_parts (store_id, kind, name, content, created_by, updated_by)
    values (${owner}::uuid, ${parsed.data.kind}, ${parsed.data.name}, ${JSON.stringify(parsed.data.content)}::jsonb,
      ${account.id}::uuid, ${account.id}::uuid)
    returning id
  `);
  const id = String(row.id);
  await audit(account.id, owner, `${actionPrefix(owner)}.part_saved`, { part: id, kind: parsed.data.kind, name: parsed.data.name });
  return { ok: true, id, parts: await listSavedParts(owner) };
}

/** Changes a saved part's name and content; its kind stays. Pages that used it keep their copy. */
export async function updateSavedPart(account: Account, owner: Owner, id: string, input: unknown): Promise<SavedResult> {
  const parsed = savedPartInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  const rows = await db().execute<Row>(sql`
    update commerce.saved_parts
       set name = ${parsed.data.name}, content = ${JSON.stringify(parsed.data.content)}::jsonb,
           updated_at = now(), updated_by = ${account.id}::uuid
     where id = ${id}::uuid and ${ownedBy(owner)} and kind = ${parsed.data.kind}
    returning id
  `);
  if (rows.length === 0) return { ok: false, problems: ["This saved part no longer exists."] };
  await audit(account.id, owner, `${actionPrefix(owner)}.part_updated`, { part: id, name: parsed.data.name });
  return { ok: true, id, parts: await listSavedParts(owner) };
}

export async function deleteSavedPart(account: Account, owner: Owner, id: string): Promise<SavedResult> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.saved_parts where id = ${id}::uuid and ${ownedBy(owner)} returning name
  `);
  if (rows.length > 0) await audit(account.id, owner, `${actionPrefix(owner)}.part_deleted`, { part: id, name: rows[0].name });
  return { ok: true, id, parts: await listSavedParts(owner) };
}
