import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db, readDb } from "@/db/client";
import { readSynonym, SYNONYMS_MAX, type SynonymGroup, type SynonymKind, type SynonymProblem } from "@/lib/search-synonyms";

import { audit } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's search synonyms (wave 6 unit F1, D324, `docs/wave-6-catalogue.md` F.1): the only writer of `commerce.search_synonyms`, and the
 * reader a search asks for its language's groups (`synonymsFor()`). Groups are expanded by `expandQuery()` in keyword search and query
 * understanding; nothing caches the results they change.
 */

/** A list of words as a `text[]`: sent as one JSON value, since a JS array in `sql` would be a list of parameters. */
const textArray = (words: string[]) => sql`array(select jsonb_array_elements_text(${JSON.stringify(words)}::jsonb))`;

const GROUP = z.object({ kind: z.enum(["both", "one_way"]), words: z.array(z.string()), means: z.array(z.string()) });

/** The groups of a language, for one search: a small read on the store's own rows (`search_synonyms_store_idx`). */
export async function synonymsFor(storeId: string, locale: string): Promise<SynonymGroup[]> {
  const rows = await typedRows(
    GROUP,
    sql`select kind, words, means from commerce.search_synonyms where store_id = ${storeId}::uuid and locale = ${locale} order by created_at, id`,
    readDb(),
  );
  return rows.map((row) => ({ kind: row.kind as SynonymKind, words: row.words, means: row.means }));
}

export type SynonymRow = SynonymGroup & { id: string; locale: string };

const ROW = GROUP.extend({ id: col.uuid, locale: col.text });

/** Every group of the store, for the admin: by language, oldest first. */
export async function listSynonyms(storeId: string): Promise<SynonymRow[]> {
  const rows = await typedRows(
    ROW,
    sql`select id, locale, kind, words, means from commerce.search_synonyms where store_id = ${storeId}::uuid order by locale, created_at, id`,
  );
  return rows.map((row) => ({ ...row, kind: row.kind as SynonymKind }));
}

export type SynonymWriter = { account: { id: string }; store: { id: string; localization: { keptLocales: string[] } } };

export type SynonymResult = { ok: true; id: string } | { ok: false; problems: (SynonymProblem | { code: "locale" } | { code: "gone" } | { code: "max" })[] };

/**
 * Saves a group as typed: a new one, or the store's own by `id`, in one of the store's kept languages, checked by `readSynonym()`. At most
 * `SYNONYMS_MAX` a store (the database's trigger holds it too).
 */
export async function saveSynonym({ account, store }: SynonymWriter, raw: unknown): Promise<SynonymResult> {
  const read = readSynonym(raw);
  if (!read.ok) return { ok: false, problems: read.problems };
  const input = read.value;
  if (!store.localization.keptLocales.includes(input.locale)) return { ok: false, problems: [{ code: "locale" }] };
  if (input.id) {
    const updated = await typedRow(
      z.object({ id: col.uuid }),
      sql`
        update commerce.search_synonyms set locale = ${input.locale}, kind = ${input.kind}, words = ${textArray(input.words)}, means = ${textArray(input.means)},
          updated_at = now()
        where store_id = ${store.id}::uuid and id = ${input.id}::uuid
        returning id
      `,
    );
    if (!updated) return { ok: false, problems: [{ code: "gone" }] };
    await audit(account.id, store.id, "search.synonym_saved", { synonym: updated.id, kind: input.kind, words: input.words.length + input.means.length });
    return { ok: true, id: updated.id };
  }
  const count = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.search_synonyms where store_id = ${store.id}::uuid`);
  if ((count?.n ?? 0) >= SYNONYMS_MAX) return { ok: false, problems: [{ code: "max" }] };
  const made = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.search_synonyms (store_id, locale, kind, words, means)
      values (${store.id}::uuid, ${input.locale}, ${input.kind}, ${textArray(input.words)}, ${textArray(input.means)})
      returning id
    `,
  );
  if (!made) return { ok: false, problems: [{ code: "gone" }] };
  await audit(account.id, store.id, "search.synonym_saved", { synonym: made.id, kind: input.kind, words: input.words.length + input.means.length });
  return { ok: true, id: made.id };
}

/** Takes a group of the store's away; one that is gone already says so. */
export async function deleteSynonym({ account, store }: SynonymWriter, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const gone = await db().execute(sql`delete from commerce.search_synonyms where store_id = ${store.id}::uuid and id = ${id}::uuid returning id`);
  if (gone.length === 0) return false;
  await audit(account.id, store.id, "search.synonym_deleted", { synonym: id });
  return true;
}
