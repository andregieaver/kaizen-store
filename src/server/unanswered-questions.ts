import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import {
  ANSWER_MAX,
  answerInput,
  answerTitle,
  QUESTION_CONVERSATIONS,
  QUESTION_KEEP_DAYS,
  QUESTION_STATUSES,
  QUESTIONS_KEPT_MAX,
  questionKey,
  questionText,
  type GapSignal,
  type QuestionStatus,
  type UnansweredQuestion,
} from "@/lib/unanswered-questions";

import { audit, type Account } from "./auth";
import { saveDocument } from "./knowledge";
import { owned } from "./owned";
import { uuidList } from "./sql-arrays";
import type { Desk } from "./support-desk";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Questions the chat assistant could not answer (ecosystem plan E4.3, D729): the only writer and reader of `commerce.unanswered_questions`.
 * A support turn (`runSupportTurn()`) keeps a question when the code saw that the answer stood on nothing (`gapOf()`); the owner reads them
 * on the chat assistant's Questions page, the most asked first, writes the answer once (a knowledge document through `saveDocument()`, so
 * it is cut, embedded and searched like every other) or says it is not a question for the assistant. A store's rows are its own
 * (`owned()`); Kaizena Flow's are the rows without a store, gathered from its own chat, its desk for owners and its website chats.
 *
 * A visitor's words are personal data and untrusted text: kept cut and masked (`questionText()`), shown as text, never sent to a model,
 * never emailed or logged, and this module's audits carry ids and counts only (the document an owner saves from one is audited as any
 * knowledge document is, under the title they saved). They go `QUESTION_KEEP_DAYS` after last asked
 * (`pruneUnanswered()`, the retention run), and at once with an erased person's conversations (`forgetQuestionsOf()`).
 */

/** A conversation's language as the gap list keeps it: two or three lower-case letters (`nb-NO` is `nb`), else English. */
const langOf = (lang: string): string => {
  const base = lang.split("-")[0]?.toLowerCase() ?? "";
  return /^[a-z]{2,3}$/.test(base) ? base : "en";
};

/**
 * Keeps a question the AI could not answer: a new one (while the site keeps fewer than `QUESTIONS_KEPT_MAX`), or one more ask of the same
 * wording, whose newest words and conversation are kept. A conversation counts once for a question however often it asks it. An answered
 * question asked again by another conversation goes back to the open list, its document still linked: the answer did not reach the AI. A
 * dismissed one stays dismissed. Whether it was kept.
 */
export async function keepUnanswered(desk: Desk, input: { conversationId: string; lang: string; words: string; signal: GapSignal }): Promise<boolean> {
  const question = questionText(input.words);
  if (!question) return false;
  const key = questionKey(question);
  if (!key) return false;
  const lang = langOf(input.lang);
  const conversation = input.conversationId;
  const handed = input.signal === "handoff" ? 1 : 0;
  const q = sql`commerce.unanswered_questions`;
  const again = sql`${conversation}::uuid = any(${q}.conversations)`;
  const kept = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.unanswered_questions (store_id, lang, key, question, asked, handed_over, conversations)
      select ${desk.storeId}::uuid, ${lang}, ${key}, ${question}, 1, ${handed}, array[${conversation}::uuid]
      where (select count(*) from commerce.unanswered_questions where ${owned(desk.storeId)}) < ${QUESTIONS_KEPT_MAX}
         or exists (select 1 from commerce.unanswered_questions where ${owned(desk.storeId)} and lang = ${lang} and key = ${key})
      on conflict on constraint unanswered_questions_key do update set
        asked = ${q}.asked + case when ${again} then 0 else 1 end,
        handed_over = ${q}.handed_over + case when ${again} then 0 else excluded.handed_over end,
        question = excluded.question,
        conversations = (array[${conversation}::uuid] || array_remove(${q}.conversations, ${conversation}::uuid))[1:${QUESTION_CONVERSATIONS}],
        last_at = greatest(now(), ${q}.first_at),
        status = case when ${q}.status = 'answered' and not ${again} then 'open' else ${q}.status end,
        decided_at = case when ${q}.status = 'answered' and not ${again} then null else ${q}.decided_at end,
        decided_by = case when ${q}.status = 'answered' and not ${again} then null else ${q}.decided_by end
      returning id
    `,
  );
  return kept !== null;
}

const QUESTION_ROW = z.object({
  id: col.uuid,
  question: col.text,
  lang: col.text,
  asked: col.int,
  handed_over: col.int,
  status: z.enum(QUESTION_STATUSES),
  first_at: col.timestamp,
  last_at: col.timestamp,
  document_id: z.uuid().nullable(),
  conversations: z.array(z.object({ id: col.uuid, at: col.timestamp })),
});

const toQuestion = (r: z.output<typeof QUESTION_ROW>): UnansweredQuestion => ({
  id: r.id,
  question: r.question,
  lang: r.lang,
  asked: r.asked,
  handedOver: r.handed_over,
  status: r.status,
  firstAt: r.first_at,
  lastAt: r.last_at,
  documentId: r.document_id,
  conversations: r.conversations,
});

/** The rows still inside their period: the retention run deletes the rest each day, and none is shown in between. */
const fresh = sql`q.last_at > now() - make_interval(days => ${QUESTION_KEEP_DAYS})`;

/** A question still to answer, as its page lists it (`q` the table's alias): Home's attention counts by it (`heldCounts()`). */
export const OPEN_QUESTION = sql`q.status = 'open' and ${fresh}`;

/**
 * A site's questions in one state, the most asked first (then the newest), with the conversations they came from that still have their
 * transcript (another site's conversation never: the join names the site).
 */
export async function listUnanswered(storeId: string | null, status: QuestionStatus = "open", limit = 100): Promise<UnansweredQuestion[]> {
  const rows = await typedRows(
    QUESTION_ROW,
    sql`
      select q.id, q.question, q.lang, q.asked, q.handed_over, q.status, q.first_at, q.last_at, q.document_id,
        coalesce((
          select json_agg(json_build_object('id', c.id, 'at', c.created_at) order by array_position(q.conversations, c.id))
          from commerce.support_conversations c
          where c.id = any(q.conversations) and ${owned(storeId, sql`c.store_id`)} and c.anonymised_at is null
        ), '[]'::json) as conversations
      from commerce.unanswered_questions q
      where ${owned(storeId, sql`q.store_id`)} and q.status = ${status} and ${fresh}
      order by q.asked desc, q.last_at desc, q.id
      limit ${Math.min(Math.max(limit, 1), 500)}
    `,
  );
  return rows.map(toQuestion);
}

/** One of a site's questions, or null (another site's is not found). */
export async function getUnanswered(storeId: string | null, id: string): Promise<UnansweredQuestion | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(
    QUESTION_ROW,
    sql`
      select q.id, q.question, q.lang, q.asked, q.handed_over, q.status, q.first_at, q.last_at, q.document_id, '[]'::json as conversations
      from commerce.unanswered_questions q
      where ${owned(storeId, sql`q.store_id`)} and q.id = ${id}::uuid and ${fresh}
    `,
  );
  return row ? toQuestion(row) : null;
}

/** The answers saved before for these questions (their knowledge documents' titles and text, the site's own), for the form to start from. */
export async function savedAnswers(storeId: string | null, questions: readonly UnansweredQuestion[]): Promise<Map<string, { title: string; content: string }>> {
  const ids = [...new Set(questions.map((q) => q.documentId).filter((id): id is string => id !== null))];
  if (ids.length === 0) return new Map();
  const rows = await typedRows(
    z.object({ id: col.uuid, title: col.text, content: col.text }),
    sql`select d.id, d.title, left(d.content, ${ANSWER_MAX}) as content from commerce.knowledge_documents d where ${owned(storeId, sql`d.store_id`)} and d.id = any(${uuidList(ids)})`,
  );
  return new Map(rows.map((r) => [r.id, { title: r.title, content: r.content }]));
}

/** How many questions are open on one site (the chat page's line), counted as the list shows them. */
export async function openUnansweredCount(storeId: string | null): Promise<number> {
  const row = await typedRow(
    z.object({ n: col.int }),
    sql`select count(*)::int as n from commerce.unanswered_questions q where ${owned(storeId, sql`q.store_id`)} and ${OPEN_QUESTION}`,
  );
  return row?.n ?? 0;
}

export type AnswerResult = { ok: true; documentId: string } | { ok: false; problem: "gone" | "invalid" | "document"; problems?: string[] };

/**
 * *Write the answer*: the owner's answer saved as a knowledge document of the site through `saveDocument()` (cut into passages at once,
 * embedded by the knowledge job), titled by the question unless they changed it; a question answered before keeps its document, which
 * is changed. The question is then answered. Audited with ids and counts, never the words.
 */
export async function answerUnanswered(account: Account, storeId: string | null, id: string, raw: unknown): Promise<AnswerResult> {
  const found = await getUnanswered(storeId, id);
  if (!found) return { ok: false, problem: "gone" };
  const parsed = answerInput.safeParse(raw);
  if (!parsed.success) return { ok: false, problem: "invalid" };
  const title = parsed.data.title || answerTitle(found.question);
  const saved = await saveDocument(account, storeId, found.documentId, { title, content: parsed.data.answer });
  if (!saved.ok) return { ok: false, problem: "document", problems: saved.problems };
  const done = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.unanswered_questions set status = 'answered', document_id = ${saved.id}::uuid, decided_at = now(), decided_by = ${account.id}::uuid
      where ${owned(storeId)} and id = ${found.id}::uuid
      returning id
    `,
  );
  if (!done) return { ok: false, problem: "gone" };
  await audit(account.id, storeId, "knowledge.question_answered", { questionId: found.id, documentId: saved.id, asked: found.asked, again: found.documentId !== null });
  return { ok: true, documentId: saved.id };
}

/** *Not a question for the assistant*: the question is dismissed and stays so when asked again (until it is forgotten after its period). */
export async function dismissUnanswered(account: Account, storeId: string | null, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const done = await typedRow(
    z.object({ asked: col.int }),
    sql`
      update commerce.unanswered_questions set status = 'dismissed', decided_at = now(), decided_by = ${account.id}::uuid
      where ${owned(storeId)} and id = ${id}::uuid and status = 'open'
      returning asked
    `,
  );
  if (done) await audit(account.id, storeId, "knowledge.question_dismissed", { questionId: id, asked: done.asked });
  return done !== null;
}

/** *Put it back*: a dismissed question is open again (Lisa's undo). */
export async function restoreUnanswered(account: Account, storeId: string | null, id: string): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const done = await typedRow(
    z.object({ id: col.uuid }),
    sql`
      update commerce.unanswered_questions set status = 'open', decided_at = null, decided_by = null
      where ${owned(storeId)} and id = ${id}::uuid and status = 'dismissed'
      returning id
    `,
  );
  if (done) await audit(account.id, storeId, "knowledge.question_restored", { questionId: id });
  return done !== null;
}

/**
 * Questions not asked since `cutoff` (the retention rule `unanswered_questions`), every site's at once: a site keeps at most
 * `QUESTIONS_KEPT_MAX`, so the run is bounded without batches (the index on `last_at` finds them). How many went.
 */
export async function pruneUnanswered(cutoff: Date): Promise<number> {
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.unanswered_questions where last_at < ${cutoff.toISOString()}::timestamptz returning id`,
  );
  return rows.length;
}

/**
 * Erasure (D162): the questions an erased person's conversations put on the store's gap list go with them, whoever else asked the same
 * (the words kept may be theirs, and a count lost is no harm). Run before the conversations are anonymised, in the same transaction.
 */
export async function forgetQuestionsOf(executor: Executor, storeId: string, conversationIds: readonly string[]): Promise<number> {
  if (conversationIds.length === 0) return 0;
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`delete from commerce.unanswered_questions where ${owned(storeId)} and conversations && ${uuidList(conversationIds)} returning id`,
    executor,
  );
  return rows.length;
}

/** For the export (D162): the questions whose kept words are those of one of these conversations (the newest asker's), by conversation. */
export async function questionsOfConversations(storeId: string, conversationIds: readonly string[]): Promise<Map<string, { question: string; firstAt: string; lastAt: string }[]>> {
  if (conversationIds.length === 0) return new Map();
  const rows = await typedRows(
    z.object({ conversation_id: col.uuid, question: col.text, first_at: col.timestamp, last_at: col.timestamp }),
    sql`
      select q.conversations[1] as conversation_id, q.question, q.first_at, q.last_at from commerce.unanswered_questions q
      where ${owned(storeId, sql`q.store_id`)} and q.conversations[1] = any(${uuidList(conversationIds)})
      order by q.first_at, q.id
    `,
  );
  const by = new Map<string, { question: string; firstAt: string; lastAt: string }[]>();
  for (const r of rows) by.set(r.conversation_id, [...(by.get(r.conversation_id) ?? []), { question: r.question, firstAt: r.first_at, lastAt: r.last_at }]);
  return by;
}
