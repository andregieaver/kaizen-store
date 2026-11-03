import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { cleanDocsComment, DOCS_FEEDBACK_COMMENT_MINUTES } from "@/lib/docs-feedback";

import { audit } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * *Was this page helpful?* on the docs (wave 14 unit E1, D442): the only writer and reader of `commerce.docs_feedback`. A yes or no is kept
 * at once; its sentence is added to it afterwards by the id its answer gave, only within the hour and only once, so the id is all a browser
 * holds and nothing else can be changed. Nothing about the reader is kept.
 */

/** Keeps a yes or a no on a page, and answers its id, which the page's feedback part adds a sentence with. */
export async function recordDocsVote(vote: { path: string; lang: "en" | "nb"; helpful: boolean }): Promise<string> {
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.docs_feedback (path, lang, helpful) values (${vote.path}, ${vote.lang}, ${vote.helpful}) returning id`,
  );
  if (!row) throw new Error("docs_feedback insert returned nothing");
  return row.id;
}

export type DocsCommentResult = { ok: true } | { ok: false; reason: "gone" } | { ok: false; reason: "too_long" | "too_many_lines"; over: number };

/**
 * Adds a sentence to a yes or no given within the hour and without one yet; cleaned as a shopper's text is (`cleanDocsComment()`), refused
 * when too long, never cut. An empty sentence changes nothing.
 */
export async function addDocsComment(id: string, comment: string): Promise<DocsCommentResult> {
  const clean = cleanDocsComment(comment);
  if (!clean.ok) return { ok: false, reason: clean.problem, over: clean.over };
  if (clean.value === null) return { ok: true };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.docs_feedback set comment = ${clean.value}
      where id = ${id}::uuid and comment is null and created_at > now() - make_interval(mins => ${DOCS_FEEDBACK_COMMENT_MINUTES})
      returning id
    `,
  );
  return row ? { ok: true } : { ok: false, reason: "gone" };
}

export type DocsFeedbackRow = { id: string; path: string; lang: "en" | "nb"; helpful: boolean; comment: string | null; createdAt: string };

const ROW = z.object({ id: col.uuid, path: col.text, lang: z.enum(["en", "nb"]), helpful: col.bool, comment: col.text.nullable(), created_at: col.timestamp });

/** The answers for the platform's admins, newest first: of one page, only yes or only no, and only those with a sentence, as asked. */
export async function listDocsFeedback(filter: { path?: string | null; helpful?: boolean | null; withComment?: boolean; limit?: number } = {}): Promise<DocsFeedbackRow[]> {
  const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
  const rows = await typedRows(
    ROW,
    sql`
      select id, path, lang, helpful, comment, created_at from commerce.docs_feedback
      where (${filter.path ?? null}::text is null or path = ${filter.path ?? null}::text)
        and (${filter.helpful ?? null}::boolean is null or helpful = ${filter.helpful ?? null}::boolean)
        and (not ${filter.withComment ?? false}::boolean or comment is not null)
      order by created_at desc, id desc
      limit ${limit}
    `,
  );
  return rows.map((r) => ({ id: r.id, path: r.path, lang: r.lang, helpful: r.helpful, comment: r.comment, createdAt: r.created_at }));
}

export type DocsFeedbackTally = { path: string; yes: number; no: number; comments: number; last: string };

/** Each page's answers counted, the pages with the most no first: what to read again. */
export async function tallyDocsFeedback(): Promise<DocsFeedbackTally[]> {
  const rows = await typedRows(
    z.object({ path: col.text, yes: col.int, no: col.int, comments: col.int, last: col.timestamp }),
    sql`
      select path, count(*) filter (where helpful)::int as yes, count(*) filter (where not helpful)::int as no,
             count(comment)::int as comments, max(created_at) as last
      from commerce.docs_feedback group by path order by no desc, yes asc, path
    `,
  );
  return rows;
}

/** Takes a sentence away and keeps its yes or no: for a sentence that names someone. Audited with the answer's id alone. */
export async function removeDocsComment(admin: { id: string }, id: string): Promise<boolean> {
  const row = await typedRow(z.object({ id: col.uuid }), sql`update commerce.docs_feedback set comment = null where id = ${id}::uuid and comment is not null returning id`);
  if (row) await audit(admin.id, null, "platform.docs_comment_removed", { id });
  return row !== null;
}
