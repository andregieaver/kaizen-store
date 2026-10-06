import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db, readDb } from "@/db/client";
import { cutPassages, documentInput, documentType, DOCUMENT_FILE_MAX, pageKnowledgeText } from "@/lib/knowledge";
import { mergeLocales } from "@/lib/localization";
import { parsePageContent } from "@/lib/page-content";
import { localizePage } from "@/lib/page-translation";
import { vectorLiteral } from "@/lib/vectors";

import { AiError, aiFor, embedTexts, type AiConnection } from "./ai";
import { audit, type Account } from "./auth";

type Row = Record<string, unknown>;

/**
 * The chat agent's knowledge (D81): a site's published pages and articles
 * and its knowledge base, cut into passages (`knowledge_chunks`), found by
 * keyword and, with the site's AI (D73), by meaning. Documents are cut when
 * saved; pages when the five-minute cron finds them published anew. Vectors
 * follow in the cron, as products' do (D74).
 */

const owned = (storeId: string | null, column = sql`store_id`) =>
  storeId ? sql`${column} = ${storeId}::uuid` : sql`${column} is null`;

// Documents ------------------------------------------------------------------

export type KnowledgeDocument = { id: string; title: string; fileName: string | null; chars: number; passages: number; updatedAt: string };

/** A site's knowledge base, newest first, with how many passages each was cut into. */
export async function listDocuments(storeId: string | null): Promise<KnowledgeDocument[]> {
  const rows = await db().execute<Row>(sql`
    select d.id, d.title, d.file_name, length(d.content) as chars, d.updated_at,
      (select count(*)::int from commerce.knowledge_chunks c where c.document_id = d.id) as passages
    from commerce.knowledge_documents d
    where ${owned(storeId, sql`d.store_id`)}
    order by d.updated_at desc
  `);
  return rows.map((row) => ({
    id: String(row.id),
    title: String(row.title),
    fileName: row.file_name ? String(row.file_name) : null,
    chars: Number(row.chars),
    passages: Number(row.passages),
    updatedAt: new Date(String(row.updated_at)).toISOString(),
  }));
}

/** At most this many documents per site, so the knowledge base stays one to look after. */
export const DOCUMENTS_MAX = 100;

export type DocumentResult = { ok: true; id: string } | { ok: false; problems: string[] };

/** A file's text: text and Markdown as they are, PDF's text layer, Word's paragraphs. */
export async function readDocumentFile(file: File): Promise<{ ok: true; text: string } | { ok: false; problem: string }> {
  const type = documentType(file.name);
  if (!type) return { ok: false, problem: "Upload a text, Markdown, PDF or Word (.docx) file." };
  if (file.size === 0) return { ok: false, problem: "That file is empty." };
  if (file.size > DOCUMENT_FILE_MAX) return { ok: false, problem: "That file is too large. Upload one under 4 MB, or paste its text." };
  const bytes = new Uint8Array(await file.arrayBuffer());
  try {
    if (type === "txt" || type === "md") return { ok: true, text: new TextDecoder("utf-8").decode(bytes) };
    if (type === "pdf") {
      const { extractText, getDocumentProxy } = await import("unpdf");
      const pdf = await getDocumentProxy(bytes);
      const { text } = await extractText(pdf, { mergePages: false });
      return { ok: true, text: (Array.isArray(text) ? text : [text]).join("\n\n") };
    }
    const mammoth = await import("mammoth");
    const { value } = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return { ok: true, text: value };
  } catch (error) {
    console.warn(`[knowledge] ${file.name} could not be read: ${error instanceof Error ? error.message : String(error)}`);
    return { ok: false, problem: `${file.name} could not be read. Save it again, or paste its text.` };
  }
}

/** Adds a document to a site's knowledge base, or changes one, and cuts it into passages at once. */
export async function saveDocument(
  account: Account,
  storeId: string | null,
  id: string | null,
  input: unknown,
  fileName: string | null = null,
): Promise<DocumentResult> {
  const parsed = documentInput.safeParse(input);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const { title, content } = parsed.data;
  const saved = await db().transaction(async (tx): Promise<DocumentResult> => {
    let documentId = id;
    if (documentId) {
      const rows = await tx.execute<Row>(sql`
        update commerce.knowledge_documents set title = ${title}, content = ${content}, updated_at = now()
        where id = ${documentId}::uuid and ${owned(storeId)} returning id
      `);
      if (rows.length === 0) return { ok: false, problems: ["This document no longer exists."] };
      await tx.execute(sql`delete from commerce.knowledge_chunks where document_id = ${documentId}::uuid`);
    } else {
      const [count] = await tx.execute<Row>(sql`select count(*)::int as n from commerce.knowledge_documents where ${owned(storeId)}`);
      if (Number(count.n) >= DOCUMENTS_MAX) return { ok: false, problems: [`A knowledge base holds at most ${DOCUMENTS_MAX} documents.`] };
      const [row] = await tx.execute<Row>(sql`
        insert into commerce.knowledge_documents (store_id, title, file_name, content, created_by)
        values (${storeId}::uuid, ${title}, ${fileName}, ${content}, ${account.id}::uuid) returning id
      `);
      documentId = String(row.id);
    }
    const passages = cutPassages(content);
    if (passages.length > 0) {
      await tx.execute(sql`
        insert into commerce.knowledge_chunks (store_id, document_id, position, title, body, version)
        values ${sql.join(
          passages.map((body, position) => sql`(${storeId}::uuid, ${documentId}::uuid, ${position}, ${title}, ${body}, ${"document"})`),
          sql`, `,
        )}
      `);
    }
    return { ok: true, id: documentId };
  });
  if (saved.ok) await audit(account.id, storeId, id ? "knowledge.document_changed" : "knowledge.document_added", { documentId: saved.id, title, fileName });
  return saved;
}

/** A document from the admin's form: a file's text, else the pasted text, titled by the file's name if left untitled. */
export async function addDocumentFromForm(account: Account, storeId: string | null, formData: FormData): Promise<DocumentResult> {
  const file = formData.get("file");
  let title = String(formData.get("title") ?? "").trim();
  let content = String(formData.get("content") ?? "");
  let fileName: string | null = null;
  if (file instanceof File && file.size > 0) {
    const read = await readDocumentFile(file);
    if (!read.ok) return { ok: false, problems: [read.problem] };
    content = read.text;
    fileName = file.name.slice(0, 200);
    if (!title) title = file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim().slice(0, 200);
  }
  return saveDocument(account, storeId, null, { title, content }, fileName);
}

export async function deleteDocument(account: Account, storeId: string | null, id: string): Promise<void> {
  const rows = await db().execute<Row>(sql`delete from commerce.knowledge_documents where id = ${id}::uuid and ${owned(storeId)} returning title`);
  if (rows.length > 0) await audit(account.id, storeId, "knowledge.document_deleted", { documentId: id, title: rows[0].title });
}

// Pages and articles -----------------------------------------------------------

/** The languages a site's pages are read in: a store's own (D109), else its countries' own; Kaizen's English. */
async function siteLocales(storeId: string | null): Promise<string[]> {
  if (!storeId) return ["en-GB"];
  const [rows, [store]] = await Promise.all([
    db().execute<Row>(sql`select distinct default_locale from commerce.markets where store_id = ${storeId}::uuid and active order by 1`),
    db().execute<Row>(sql`select locales from commerce.stores where id = ${storeId}::uuid`),
  ]);
  return mergeLocales(((store?.locales ?? []) as string[]).map(String), rows.map((row) => String(row.default_locale)));
}

/**
 * Cuts a site's published pages and articles into passages in each of its
 * languages, where a page was published since it was last cut, and lets go
 * of those no longer published. Headers, footers and product layouts are
 * not the site's words.
 */
export async function syncPageKnowledge(storeId: string | null): Promise<{ cut: number; dropped: number }> {
  const locales = await siteLocales(storeId);
  const pages = await db().execute<Row>(sql`
    select p.id, p.type, p.slug, p.published, p.published_at,
      (select min(c.version) from commerce.knowledge_chunks c where c.page_id = p.id) as version
    from commerce.pages p
    where ${owned(storeId, sql`p.store_id`)} and p.type in ('page', 'article') and p.published_at is not null
  `);
  let cut = 0;
  for (const page of pages) {
    const version = new Date(String(page.published_at)).toISOString();
    if (page.version === version) continue;
    const content = parsePageContent(page.published);
    if (!content) continue;
    const path = page.type === "article" ? `/blog/${page.slug}` : `/${page.slug}`;
    const rows: SQL[] = [];
    for (const locale of locales) {
      const localized = localizePage(content, locale);
      cutPassages(pageKnowledgeText(localized)).forEach((body, position) => {
        rows.push(sql`(${storeId}::uuid, ${String(page.id)}::uuid, ${locale}, ${position}, ${localized.title.slice(0, 300)}, ${path}, ${body}, ${version})`);
      });
    }
    await db().transaction(async (tx) => {
      await tx.execute(sql`delete from commerce.knowledge_chunks where page_id = ${String(page.id)}::uuid`);
      if (rows.length > 0) {
        await tx.execute(sql`
          insert into commerce.knowledge_chunks (store_id, page_id, locale, position, title, path, body, version)
          values ${sql.join(rows, sql`, `)}
        `);
      }
    });
    cut += 1;
  }
  const dropped = await db().execute<Row>(sql`
    delete from commerce.knowledge_chunks c
    where ${owned(storeId, sql`c.store_id`)} and c.page_id is not null
      and not exists (select 1 from commerce.pages p where p.id = c.page_id and p.published_at is not null)
    returning c.id
  `);
  return { cut, dropped: dropped.length };
}

// Vectors ---------------------------------------------------------------------

const BATCH = 32;
const PER_RUN = 256;

/** Gives a site's passages vectors from its AI where they have none from its current model; stops at the first failure. */
export async function embedKnowledge(storeId: string | null, connection: AiConnection, limit = PER_RUN): Promise<{ embedded: number; failed: string | null }> {
  const space = connection.space;
  if (!space) return { embedded: 0, failed: null };
  const stale = await db().execute<Row>(sql`
    select id, title, body from commerce.knowledge_chunks
    where ${owned(storeId)} and (space is null or space <> ${space})
    order by id limit ${limit}
  `);
  let embedded = 0;
  for (let start = 0; start < stale.length; start += BATCH) {
    const batch = stale.slice(start, start + BATCH);
    try {
      const { vectors } = await embedTexts(connection, batch.map((row) => `${row.title}\n\n${row.body}`));
      await db().execute(sql`
        update commerce.knowledge_chunks c set space = ${space}, embedding = v.embedding::extensions.vector
        from (values ${sql.join(
          batch.map((row, i) => sql`(${Number(row.id)}::bigint, ${vectorLiteral(vectors[i])})`),
          sql`, `,
        )}) as v(id, embedding)
        where c.id = v.id
      `);
      embedded += batch.length;
    } catch (error) {
      const message = error instanceof AiError ? error.message : String(error);
      console.warn(`[knowledge] embedding failed (${connection.source} AI, ${space}): ${message}`);
      return { embedded, failed: message };
    }
  }
  return { embedded, failed: null };
}

/** The cron's share: for every site with its chat agent on, pages cut anew and passages given vectors. */
export async function refreshKnowledge(): Promise<{ sites: number; cut: number; embedded: number }> {
  const agents = await db().execute<Row>(sql`select store_id from commerce.chat_agents where enabled and (store_id is null or commerce.store_is_active(store_id))`);
  let cut = 0;
  let embedded = 0;
  for (const agent of agents) {
    const storeId = agent.store_id ? String(agent.store_id) : null;
    try {
      cut += (await syncPageKnowledge(storeId)).cut;
      const connection = await aiFor(storeId, { feature: "knowledge" });
      if (connection) embedded += (await embedKnowledge(storeId, connection)).embedded;
    } catch (error) {
      console.warn(`[knowledge] refresh failed for ${storeId ?? "Kaizen"}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { sites: agents.length, cut, embedded };
}

/** A site's knowledge brought up to date now (after its agent or a document is saved), as the cron would. */
export async function refreshSiteKnowledge(storeId: string | null): Promise<void> {
  try {
    await syncPageKnowledge(storeId);
    const connection = await aiFor(storeId, { feature: "knowledge" });
    if (connection) await embedKnowledge(storeId, connection);
  } catch (error) {
    console.warn(`[knowledge] refresh failed for ${storeId ?? "Kaizen"}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** What the knowledge base holds, for the admin: passages, and how many have vectors from the current model. */
export async function knowledgeStatus(storeId: string | null): Promise<{ pages: number; documents: number; passages: number; withMeaning: number }> {
  const connection = await aiFor(storeId);
  const [row] = await db().execute<Row>(sql`
    select count(distinct page_id)::int as pages, count(distinct document_id)::int as documents, count(*)::int as passages,
      count(*) filter (where space is not null and space = ${connection?.space ?? ""})::int as with_meaning
    from commerce.knowledge_chunks where ${owned(storeId)}
  `);
  return { pages: Number(row.pages), documents: Number(row.documents), passages: Number(row.passages), withMeaning: Number(row.with_meaning) };
}

// Finding -----------------------------------------------------------------------

export type Passage = { title: string; path: string | null; body: string };

/**
 * The passages that best answer a question, in the visitor's language (or
 * any, for documents): by meaning with the site's AI where it has vectors,
 * and by keyword, merged by reciprocal rank.
 */
export async function searchKnowledge(storeId: string | null, query: string, locale: string, limit = 5): Promise<Passage[]> {
  const inLanguage = sql`(locale is null or locale = ${locale})`;
  const keyword = readDb().execute<Row>(sql`
    select id, title, path, body from commerce.knowledge_chunks,
      websearch_to_tsquery(commerce.search_config(${locale}), ${query}) q,
      websearch_to_tsquery('simple', ${query}) qs
    where ${owned(storeId)} and ${inLanguage} and (search @@ q or search @@ qs)
    order by greatest(ts_rank(search, q), ts_rank(search, qs)) desc
    limit ${limit * 2}
  `);
  const meaning = (async () => {
    const connection = await aiFor(storeId, { feature: "chat_agent" });
    if (!connection?.space) return [] as Row[];
    try {
      const { vectors } = await embedTexts(connection, [query], 5000);
      return await readDb().execute<Row>(sql`
        select id, title, path, body from commerce.knowledge_chunks
        where ${owned(storeId)} and ${inLanguage} and space = ${connection.space}
        order by embedding OPERATOR(extensions.<=>) ${vectorLiteral(vectors[0])}::extensions.vector
        limit ${limit * 2}
      `);
    } catch (error) {
      if (!(error instanceof AiError)) throw error;
      return [] as Row[];
    }
  })();
  const [byKeyword, byMeaning] = await Promise.all([keyword, meaning]);
  const scores = new Map<string, { row: Row; score: number }>();
  for (const list of [byMeaning, byKeyword]) {
    list.forEach((row, rank) => {
      const id = String(row.id);
      const entry = scores.get(id) ?? { row, score: 0 };
      entry.score += 1 / (60 + rank);
      scores.set(id, entry);
    });
  }
  return [...scores.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ row }) => ({ title: String(row.title), path: row.path ? String(row.path) : null, body: String(row.body) }));
}
