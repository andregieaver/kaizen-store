import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { embeddingDocument } from "@/lib/search";
import { vectorLiteral } from "@/lib/vectors";

import { aiFor, AiError, embedTexts, type AiConnection } from "./ai";

type Row = Record<string, unknown>;

/**
 * Product vectors for search by meaning (Phase 2, S2, D74). Each active
 * product's translations are embedded by the store's AI (D73) from their
 * title, categories and tags, and description, and kept in
 * `product_embeddings` with the model's `space` and a hash of what was
 * embedded. A translation is embedded again only when that hash changes:
 * its text, its terms or the model. The five-minute cron keeps every store
 * current; saving a product does its store at once.
 */

/** Texts per request to the provider. */
const BATCH = 32;
/** Texts per run and AI, so one run stays short; the next run carries on. */
const PER_RUN = 256;

type Stale = { storeId: string; productId: string; locale: string; text: string; hash: string };

/** Translations whose vector is missing or out of date for this model, among the stores `scope` picks. */
async function staleTranslations(space: string, scope: SQL, limit: number): Promise<Stale[]> {
  const rows = await db().execute<Row>(sql`
    with docs as (
      select t.store_id, t.product_id, t.locale, t.title, coalesce(t.description, '') as description,
        coalesce((
          select string_agg(te.name, ', ' order by te.kind, te.name)
          from commerce.product_terms pt join commerce.terms te on te.id = pt.term_id
          where pt.store_id = t.store_id and pt.product_id = t.product_id
        ), '') as terms
      from commerce.product_translations t
      join commerce.products p on p.store_id = t.store_id and p.id = t.product_id
      where p.status = 'active' and ${scope}
    )
    select d.*, md5(concat_ws(chr(31), ${space}::text, d.title, d.terms, d.description)) as hash
    from docs d
    left join commerce.product_embeddings e on e.product_id = d.product_id and e.locale = d.locale
    where e.product_id is null or e.space <> ${space} or e.content_hash <> md5(concat_ws(chr(31), ${space}::text, d.title, d.terms, d.description))
    order by d.store_id, d.product_id, d.locale
    limit ${limit}
  `);
  return rows.map((row) => ({
    storeId: String(row.store_id),
    productId: String(row.product_id),
    locale: String(row.locale),
    text: embeddingDocument(String(row.title), String(row.terms), String(row.description)),
    hash: String(row.hash),
  }));
}

async function store(space: string, items: Stale[], vectors: number[][]): Promise<void> {
  if (items.length === 0) return;
  await db().execute(sql`
    insert into commerce.product_embeddings (store_id, product_id, locale, space, content_hash, embedding)
    values ${sql.join(
      items.map(
        (item, i) =>
          sql`(${item.storeId}::uuid, ${item.productId}::uuid, ${item.locale}, ${space}, ${item.hash}, ${vectorLiteral(vectors[i])}::extensions.vector)`,
      ),
      sql`, `,
    )}
    on conflict (product_id, locale) do update set
      space = excluded.space, content_hash = excluded.content_hash, embedding = excluded.embedding, updated_at = now()
  `);
}

export type EmbedRun = { embedded: number; failed: string | null };

/** Embeds what is out of date among the stores `scope` picks, with one AI; stops at the first failure. */
async function embedWith(connection: AiConnection, scope: SQL, limit = PER_RUN): Promise<EmbedRun> {
  const space = connection.space;
  if (!space) return { embedded: 0, failed: null };
  const stale = await staleTranslations(space, scope, limit);
  let embedded = 0;
  for (let start = 0; start < stale.length; start += BATCH) {
    const batch = stale.slice(start, start + BATCH);
    try {
      const { vectors } = await embedTexts(connection, batch.map((item) => item.text));
      await store(space, batch, vectors);
      embedded += batch.length;
    } catch (error) {
      const message = error instanceof AiError ? error.message : String(error);
      console.warn(`Embedding failed (${connection.source} AI, ${space}): ${message}`);
      return { embedded, failed: message };
    }
  }
  return { embedded, failed: null };
}

/** Stores using Kaizen's AI: those without their own switched on. */
const onKaizensAi = sql`not exists (select 1 from commerce.ai_providers a where a.store_id = t.store_id and a.enabled)`;

/** Brings one store's vectors up to date with the AI it uses, after its products change. */
export async function refreshStoreEmbeddings(storeId: string, limit = PER_RUN): Promise<EmbedRun> {
  const connection = await aiFor(storeId, { feature: "embeddings" });
  if (!connection) return { embedded: 0, failed: null };
  return embedWith(connection, sql`t.store_id = ${storeId}::uuid`, limit);
}

/** The cron's share: every store on Kaizen's AI, then each store with its own. */
export async function refreshEmbeddings(): Promise<{ embedded: number; failed: number }> {
  let embedded = 0;
  let failed = 0;
  const count = (run: EmbedRun) => {
    embedded += run.embedded;
    if (run.failed) failed += 1;
  };
  const kaizen = await aiFor(null, { feature: "embeddings" });
  if (kaizen) count(await embedWith(kaizen, onKaizensAi));
  const own = await db().execute<Row>(sql`select store_id from commerce.ai_providers where store_id is not null and enabled and embedding_model is not null`);
  for (const row of own) count(await refreshStoreEmbeddings(String(row.store_id)));
  return { embedded, failed };
}
