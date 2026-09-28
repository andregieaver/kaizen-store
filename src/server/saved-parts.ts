import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { asDoc, fromDoc, refreshUses, sameGlobal, type AnyPart, type PartKind, type Translations } from "@/lib/global-parts";
import { newPageContent } from "@/lib/page-content";
import { cleanTranslations } from "@/lib/page-translation";
import { SAVED_PARTS_MAX, parseSavedPart, savedPartInput, type SavedPart } from "@/lib/saved-parts";

import { audit, type Account } from "./auth";
import { GlobalsRefused, globalsIn, lockSavedParts, spreadGlobals, type StoredPart } from "./global-parts";
import { ownerLanguages } from "./pages";

/**
 * Saved rows, columns and components (D46) for the page builder's Saved
 * tab: Kaizen's (`owner` null) and each store's own (D53). Read fresh when
 * the editor opens: they are only for the owner's editors. A global one
 * (D98) is kept the same on every page that uses it: changing or deleting
 * it here reaches those pages at once.
 */

type Row = Record<string, unknown>;

/** `pages`: how many pages a global's change reached, so the site's cached pages are refreshed. */
export type SavedResult = { ok: true; parts: SavedPart[]; id: string; pages?: number } | { ok: false; problems: string[] };

/** Whose: a store's id, or null for Kaizen's. */
type Owner = string | null;
const actionPrefix = (owner: Owner) => (owner === null ? "platform" : "store");

export async function listSavedParts(owner: Owner): Promise<SavedPart[]> {
  const rows = await db().execute<Row>(sql`
    select sp.id, sp.kind, sp.name, sp.content, sp.updated_at, sp.global, sp.translations,
      case when sp.global then (
        select count(*)::int from commerce.pages p
        where p.store_id is not distinct from sp.store_id
          and (p.draft::text like '%' || sp.id::text || '%' or coalesce(p.published::text, '') like '%' || sp.id::text || '%')
      ) else 0 end as uses
    from commerce.saved_parts sp
    where sp.store_id is not distinct from ${owner}::uuid
    order by sp.kind, lower(sp.name), sp.created_at
  `);
  return rows.flatMap((row) => {
    const part = parseSavedPart({
      id: String(row.id),
      kind: String(row.kind),
      name: String(row.name),
      content: row.content,
      updatedAt: new Date(String(row.updated_at)).toISOString(),
      global: Boolean(row.global),
      translations: row.translations,
      uses: Number(row.uses ?? 0),
    });
    return part ? [part] : [];
  });
}

const problemsOf = (issues: { message: string }[]) => [...new Set(issues.map((i) => i.message))];

/**
 * A part as it may be kept: no global's mark on the part itself, the uses
 * of globals in it as they are now (uses of globals gone become plain), and
 * a global's texts in other languages only for texts it has.
 */
async function prepare(
  owner: Owner,
  parts: StoredPart[],
  kind: PartKind,
  content: AnyPart,
  translations: Translations,
  global: boolean,
): Promise<{ content: AnyPart; translations: Translations } | { problems: string[] }> {
  const own = { ...content };
  delete own.global;
  delete own.local;
  const globals = globalsIn(parts);
  const doc = refreshUses(asDoc(kind, own, translations), globals, (id) => !globals.has(id));
  if (!global) return { content: fromDoc(kind, doc), translations: {} };
  const languages = (await ownerLanguages(owner)).slice(1);
  const cleaned = cleanTranslations({ ...newPageContent(), rows: doc.rows, translations: doc.translations }, languages);
  if (!cleaned.ok) return { problems: cleaned.problems };
  const texts = Object.fromEntries(
    Object.entries(cleaned.content.translations ?? {}).map(([locale, entries]) => [
      locale,
      Object.fromEntries(Object.entries(entries).filter(([key]) => key.startsWith("block.") || key.startsWith("column."))),
    ]),
  );
  return { content: fromDoc(kind, doc), translations: texts };
}

/** Runs a change to saved parts in one transaction; a page a global's change would break stops it with its reasons. */
async function inTransaction(run: (tx: Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0]) => Promise<SavedResult>): Promise<SavedResult> {
  try {
    return await db().transaction(run);
  } catch (error) {
    if (error instanceof GlobalsRefused) return { ok: false, problems: error.problems };
    throw error;
  }
}

/** Saves a row, column or component under a name; a global one's first use is the part it was made from (D98). */
export async function createSavedPart(account: Account, owner: Owner, input: unknown): Promise<SavedResult> {
  const parsed = savedPartInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  const { kind, name, global } = parsed.data;
  const result = await inTransaction(async (tx) => {
    const parts = await lockSavedParts(tx, owner);
    if (parts.length >= SAVED_PARTS_MAX) {
      return { ok: false, problems: [`At most ${SAVED_PARTS_MAX} saved parts. Delete some first.`] };
    }
    const ready = await prepare(owner, parts, kind, parsed.data.content, parsed.data.translations, global);
    if ("problems" in ready) return { ok: false, problems: ready.problems };
    const [row] = await tx.execute<Row>(sql`
      insert into commerce.saved_parts (store_id, kind, name, content, global, translations, created_by, updated_by)
      values (${owner}::uuid, ${kind}, ${name}, ${JSON.stringify(ready.content)}::jsonb, ${global},
        ${JSON.stringify(ready.translations)}::jsonb, ${account.id}::uuid, ${account.id}::uuid)
      returning id
    `);
    return { ok: true, id: String(row.id), parts: [] };
  });
  if (!result.ok) return result;
  await audit(account.id, owner, `${actionPrefix(owner)}.part_saved`, { part: result.id, kind, name, ...(global && { global }) });
  return { ...result, parts: await listSavedParts(owner) };
}

/**
 * Changes a saved part's name and content (its kind stays), and whether it
 * is global. Pages that used a plain one keep their copy; a global's change
 * reaches every page using it, and one made plain leaves them their copies.
 */
export async function updateSavedPart(account: Account, owner: Owner, id: string, input: unknown): Promise<SavedResult> {
  const parsed = savedPartInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error.issues) };
  const { kind, name, global } = parsed.data;
  let pages = 0;
  const result = await inTransaction(async (tx) => {
    const parts = await lockSavedParts(tx, owner);
    const before = parts.find((p) => p.id === id && p.kind === kind);
    if (!before) return { ok: false, problems: ["This saved part no longer exists."] };
    // The builder's dialog does not show texts in other languages: a global keeps its own.
    const others = parts.filter((p) => p.id !== id);
    const ready = await prepare(owner, others, kind, parsed.data.content, before.translations, global);
    if ("problems" in ready) return { ok: false, problems: ready.problems };
    await tx.execute(sql`
      update commerce.saved_parts
         set name = ${name}, content = ${JSON.stringify(ready.content)}::jsonb, global = ${global},
             translations = ${JSON.stringify(ready.translations)}::jsonb, updated_at = now(), updated_by = ${account.id}::uuid
       where id = ${id}::uuid
    `);
    const after: StoredPart = { ...before, name, global, ...ready };
    const changed = global && before.global && !sameGlobal(kind, ready, before);
    if (changed || (before.global && !global)) {
      const spread = await spreadGlobals(tx, {
        accountId: account.id,
        owner,
        parts: [...others, after],
        changed: changed ? [{ id, kind, ...ready }] : [],
        detach: before.global && !global ? new Set([id]) : new Set(),
      });
      pages = spread.pages;
    }
    return { ok: true, id, parts: [] };
  });
  if (!result.ok) return result;
  await audit(account.id, owner, `${actionPrefix(owner)}.part_updated`, { part: id, name, ...(global && { global }), ...(pages > 0 && { pages }) });
  return { ...result, pages, parts: await listSavedParts(owner) };
}

/** Deletes a saved part; pages that used a global one keep what they had, as their own. */
export async function deleteSavedPart(account: Account, owner: Owner, id: string): Promise<SavedResult> {
  let pages = 0;
  let name: unknown = null;
  const result = await inTransaction(async (tx) => {
    const parts = await lockSavedParts(tx, owner);
    const part = parts.find((p) => p.id === id);
    if (!part) return { ok: true, id, parts: [] };
    await tx.execute(sql`delete from commerce.saved_parts where id = ${id}::uuid`);
    name = part.name;
    if (part.global) {
      const spread = await spreadGlobals(tx, {
        accountId: account.id,
        owner,
        parts: parts.filter((p) => p.id !== id),
        changed: [],
        detach: new Set([id]),
      });
      pages = spread.pages;
    }
    return { ok: true, id, parts: [] };
  });
  if (!result.ok) return result;
  if (name !== null) await audit(account.id, owner, `${actionPrefix(owner)}.part_deleted`, { part: id, name, ...(pages > 0 && { pages }) });
  return { ...result, pages, parts: await listSavedParts(owner) };
}
