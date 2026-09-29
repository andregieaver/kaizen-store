import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { vectorLiteral } from "@/lib/vectors";

import { AiError, completeText, embedTexts, type AiConnection } from "./ai";

type Row = Record<string, unknown>;

/**
 * The AI manager's memory (D103), after Kaizen Life's: what it knows about
 * the person it works for, per account, about one store or everywhere.
 * It is told things (`remember`), learns them from each conversation
 * (`learnFromTurn()`, in the background) and from thumbs on its answers,
 * and finds them again by keyword and by meaning, ranked by relevance,
 * recency and importance. The person sees, edits and deletes every memory,
 * and can stop the learning.
 */

export type MemoryKind = "preference" | "fact" | "procedure" | "goal";
export type MemorySource = "told" | "learned" | "feedback";
export const MEMORY_KINDS: readonly MemoryKind[] = ["preference", "fact", "procedure", "goal"];

export type Memory = {
  id: string;
  kind: MemoryKind;
  content: string;
  importance: number;
  source: MemorySource;
  /** The store it is about; null for everywhere. */
  storeId: string | null;
  storeName: string | null;
  uses: number;
  lastUsedAt: string | null;
  updatedAt: string;
};

/** The most memories kept per person: past it, the least important learned ones go first. */
export const MEMORY_MAX = 300;
/** Memories given to the model each turn. */
const PER_TURN = 8;

const toMemory = (row: Row): Memory => ({
  id: String(row.id),
  kind: row.kind as MemoryKind,
  content: String(row.content),
  importance: Number(row.importance),
  source: row.source as MemorySource,
  storeId: row.store_id ? String(row.store_id) : null,
  storeName: row.store_name ? String(row.store_name) : null,
  uses: Number(row.uses ?? 0),
  lastUsedAt: row.last_used_at ? new Date(String(row.last_used_at)).toISOString() : null,
  updatedAt: new Date(String(row.updated_at)).toISOString(),
});

/** Memories that apply where the person is: their general ones, and the store's. */
const applies = (accountId: string, storeId: string | null) =>
  sql`m.account_id = ${accountId}::uuid and (m.store_id is null ${storeId ? sql`or m.store_id = ${storeId}::uuid` : sql``})`;

/** Whether the AI manager may learn from this person's conversations. */
export async function learningOn(accountId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`select assistant_learns from commerce.accounts where id = ${accountId}::uuid`);
  return row ? Boolean(row.assistant_learns) : false;
}

export async function setLearning(accountId: string, on: boolean): Promise<void> {
  await db().execute(sql`update commerce.accounts set assistant_learns = ${on} where id = ${accountId}::uuid`);
}

/** Every memory of the person, for them to see and change. */
export async function listMemories(accountId: string): Promise<Memory[]> {
  const rows = await db().execute<Row>(sql`
    select m.*, s.name as store_name from commerce.assistant_memories m
    left join commerce.stores s on s.id = m.store_id
    where m.account_id = ${accountId}::uuid
    order by m.importance desc, m.updated_at desc
  `);
  return rows.map(toMemory);
}

/** The vector of a text, with its space, or none without an embedding model. */
async function vectorFor(connection: AiConnection | null, text: string): Promise<{ space: string; vector: number[] } | null> {
  if (!connection?.space) return null;
  try {
    const { vectors } = await embedTexts(connection, [text], 5000);
    return vectors[0] ? { space: connection.space, vector: vectors[0] } : null;
  } catch (error) {
    if (error instanceof AiError) return null;
    throw error;
  }
}

/**
 * Keeps a memory. One much like an existing one of the same kind and place
 * replaces its wording and counts as more important, rather than a copy.
 */
export async function keepMemory(input: {
  accountId: string;
  storeId: string | null;
  kind: MemoryKind;
  content: string;
  source: MemorySource;
  importance?: number;
  connection?: AiConnection | null;
}): Promise<{ id: string; merged: boolean }> {
  const content = input.content.replace(/\s+/g, " ").trim().slice(0, 500);
  const importance = Math.min(10, Math.max(1, Math.round(input.importance ?? (input.source === "told" ? 7 : 5))));
  const [same] = await db().execute<Row>(sql`
    select id, importance from commerce.assistant_memories
    where account_id = ${input.accountId}::uuid and kind = ${input.kind}
      and store_id is not distinct from ${input.storeId}::uuid
      and (lower(content) = lower(${content}) or extensions.similarity(content, ${content}) > 0.6)
    order by extensions.similarity(content, ${content}) desc limit 1
  `);
  const vector = await vectorFor(input.connection ?? null, content);
  const embedding = vector ? sql`${vectorLiteral(vector.vector)}::extensions.vector` : sql`null`;
  if (same) {
    await db().execute(sql`
      update commerce.assistant_memories set content = ${content},
        importance = least(10, greatest(importance, ${importance}) + 1),
        source = case when ${input.source} = 'told' then 'told' else source end,
        space = ${vector?.space ?? null}, embedding = ${embedding}, updated_at = now()
      where id = ${String(same.id)}::uuid
    `);
    return { id: String(same.id), merged: true };
  }
  const [row] = await db().execute<Row>(sql`
    insert into commerce.assistant_memories (account_id, store_id, kind, content, importance, source, space, embedding)
    values (${input.accountId}::uuid, ${input.storeId}::uuid, ${input.kind}, ${content}, ${importance}, ${input.source},
      ${vector?.space ?? null}, ${embedding})
    returning id
  `);
  // Past the most, the least important learned memories make room.
  await db().execute(sql`
    delete from commerce.assistant_memories where id in (
      select id from commerce.assistant_memories where account_id = ${input.accountId}::uuid
      order by (source = 'told') desc, importance desc, coalesce(last_used_at, updated_at) desc
      offset ${MEMORY_MAX}
    )
  `);
  return { id: String(row.id), merged: false };
}

/** Changes a memory's words or importance; only the person's own. */
export async function updateMemory(accountId: string, id: string, change: { content?: string; importance?: number }): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const content = change.content?.replace(/\s+/g, " ").trim().slice(0, 500);
  if (content !== undefined && !content) return false;
  const rows = await db().execute(sql`
    update commerce.assistant_memories set
      content = coalesce(${content ?? null}, content),
      importance = coalesce(${change.importance === undefined ? null : Math.min(10, Math.max(1, Math.round(change.importance)))}::smallint, importance),
      source = 'told', space = case when ${content ?? null}::text is null then space end,
      embedding = case when ${content ?? null}::text is null then embedding end,
      updated_at = now()
    where account_id = ${accountId}::uuid and id = ${id}::uuid returning 1
  `);
  return rows.length > 0;
}

export async function deleteMemory(accountId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db().execute(sql`delete from commerce.assistant_memories where account_id = ${accountId}::uuid and id = ${id}::uuid returning 1`);
  return rows.length > 0;
}

/** Forgets everything about the person (their choice, from the memory page). */
export async function deleteAllMemories(accountId: string): Promise<number> {
  const rows = await db().execute(sql`delete from commerce.assistant_memories where account_id = ${accountId}::uuid returning 1`);
  return rows.length;
}

/**
 * The memories that matter for what is asked: by keyword and by meaning,
 * fused by reciprocal rank, then weighed by relevance, recency and
 * importance; the person's strongest preferences always come along.
 * Those used count as used, and grow in importance when used again soon.
 */
export async function memoriesFor(
  accountId: string,
  storeId: string | null,
  query: string,
  connection: AiConnection | null,
  limit = PER_TURN,
): Promise<Memory[]> {
  const scope = applies(accountId, storeId);
  const text = query.slice(0, 500);
  // Any of the words: a question's words all together rarely match a note.
  const terms = [...new Set(text.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].slice(0, 24);
  const [byKeyword, vector, strongest] = await Promise.all([
    terms.length
      ? db().execute<Row>(sql`
          select m.id from commerce.assistant_memories m, to_tsquery('simple', ${terms.join(" | ")}) q
          where ${scope} and m.search @@ q
          order by ts_rank(m.search, q) desc limit 20
        `)
      : Promise.resolve([] as Row[]),
    text.trim() ? vectorFor(connection, text) : Promise.resolve(null),
    db().execute<Row>(sql`
      select m.id from commerce.assistant_memories m
      where ${scope} and m.kind = 'preference' and m.importance >= 7
      order by m.importance desc, m.updated_at desc limit 4
    `),
  ]);
  const byMeaning = vector
    ? await db().execute<Row>(sql`
        select m.id from commerce.assistant_memories m
        where ${scope} and m.space = ${vector.space}
        order by m.embedding OPERATOR(extensions.<=>) ${vectorLiteral(vector.vector)}::extensions.vector limit 20
      `)
    : [];
  const fused = new Map<string, number>();
  for (const list of [byMeaning, byKeyword]) list.forEach((row, rank) => fused.set(String(row.id), (fused.get(String(row.id)) ?? 0) + 1 / (60 + rank)));
  const ids = [...new Set([...fused.keys(), ...strongest.map((r) => String(r.id))])];
  if (ids.length === 0) {
    // Nothing matches the words: the most important memories still help.
    const top = await db().execute<Row>(sql`
      select m.*, s.name as store_name from commerce.assistant_memories m left join commerce.stores s on s.id = m.store_id
      where ${scope} order by m.importance desc, m.updated_at desc limit ${limit}
    `);
    return top.map(toMemory);
  }
  const rows = await db().execute<Row>(sql`
    select m.*, s.name as store_name from commerce.assistant_memories m left join commerce.stores s on s.id = m.store_id
    where m.id in (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
  `);
  const top = Math.max(0, ...fused.values());
  const now = Date.now();
  const scored = rows.map((row) => {
    const memory = toMemory(row);
    const relevance = top > 0 ? (fused.get(memory.id) ?? 0) / top : 0;
    const age = (now - new Date(memory.lastUsedAt ?? memory.updatedAt).getTime()) / 86_400_000;
    const recency = Math.pow(0.5, age / 30);
    return { memory, score: 0.6 * relevance + 0.25 * recency + 0.15 * (memory.importance / 10) };
  });
  const chosen = scored.sort((a, b) => b.score - a.score).slice(0, limit).map((s) => s.memory);
  if (chosen.length > 0) {
    await db().execute(sql`
      update commerce.assistant_memories set uses = uses + 1,
        importance = case when last_used_at > now() - interval '14 days' then least(importance + 1, greatest(importance, 8)) else importance end,
        last_used_at = now()
      where id in (${sql.join(chosen.map((m) => sql`${m.id}::uuid`), sql`, `)})
    `);
  }
  return chosen;
}

/**
 * Lets learned memories nobody used fade (daily): less important after 60
 * days unused, gone after 180 if they matter little. What the person told
 * it to remember stays until they delete it.
 */
export async function fadeMemories(): Promise<{ faded: number; forgotten: number }> {
  const faded = await db().execute(sql`
    update commerce.assistant_memories set importance = greatest(1, importance - 1), updated_at = now()
    where source <> 'told' and importance > 1 and coalesce(last_used_at, updated_at) < now() - interval '60 days'
    returning 1
  `);
  const forgotten = await db().execute(sql`
    delete from commerce.assistant_memories
    where source <> 'told' and importance <= 2 and coalesce(last_used_at, updated_at) < now() - interval '180 days'
    returning 1
  `);
  return { faded: faded.length, forgotten: forgotten.length };
}

// Learning -----------------------------------------------------------------------------

const LEARN_SYSTEM = [
  "You keep notes about a person for their AI manager in an online store admin, so it serves them better in later conversations.",
  "From the exchange you are given, write down only lasting things worth knowing next time:",
  "- how they like to work and be answered (language, length, tone, level of detail);",
  "- their routines and schedules (such as when they ship or restock);",
  "- facts about their business they state (what they sell, to whom, suppliers, plans, goals);",
  "- rules and decisions they set for the store or for the assistant.",
  "Never note: one-off requests; anything the store's own data holds (orders, products, prices, stock, customers); customers' personal details; passwords, keys or payment details; what the assistant said unless the person agreed with it.",
  "Write each as one short statement in the third person, in English, such as 'Prefers short answers in Norwegian' or 'Restocks coffee every Monday'.",
  'Answer with JSON only: {"memories":[{"kind":"preference|fact|procedure|goal","content":"…","everywhere":true|false,"importance":1-10}]}, at most 3, or {"memories":[]} when there is nothing lasting. "everywhere" is true for things about the person in any store, false for things about this store.',
].join("\n");

type Learned = { kind: MemoryKind; content: string; everywhere: boolean; importance: number };

/** The model's notes, read defensively: only well-formed ones pass. */
export function readLearned(text: string): Learned[] {
  const json = /\{[\s\S]*\}/.exec(text)?.[0];
  if (!json) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return [];
  }
  const list = (parsed as { memories?: unknown }).memories;
  if (!Array.isArray(list)) return [];
  return list
    .slice(0, 3)
    .flatMap((item: Record<string, unknown>) => {
      const content = typeof item?.content === "string" ? item.content.replace(/\s+/g, " ").trim() : "";
      const kind = MEMORY_KINDS.includes(item?.kind as MemoryKind) ? (item.kind as MemoryKind) : "preference";
      if (content.length < 3 || content.length > 300) return [];
      // No addresses, card numbers or emails: those are never kept.
      if (/@|\b\d{12,}\b|password|passord/i.test(content)) return [];
      const importance = Number.isFinite(Number(item.importance)) ? Math.min(9, Math.max(1, Math.round(Number(item.importance)))) : 5;
      return [{ kind, content, everywhere: item.everywhere === true, importance }];
    });
}

/**
 * After a turn, in the background: what was lasting in it, kept as learned
 * memories, if the person lets it learn. Thumbs on an answer teach how
 * they like to be answered.
 */
export async function learnFromTurn(input: {
  accountId: string;
  storeId: string | null;
  connection: AiConnection;
  said: string;
  answered: string;
  /** A thumb on the answer: 1 up, -1 down, with what they said about it. */
  feedback?: { value: 1 | -1; note?: string };
}): Promise<number> {
  if (!(await learningOn(input.accountId))) return 0;
  const exchange = [
    `The person wrote: ${input.said.slice(0, 2000)}`,
    `The assistant answered: ${input.answered.slice(0, 2000)}`,
    ...(input.feedback
      ? [
          `The person gave that answer a thumbs ${input.feedback.value > 0 ? "up" : "down"}${input.feedback.note ? `, saying: ${input.feedback.note.slice(0, 500)}` : ""}.`,
          "Note what this says about how they like to be answered, if anything.",
        ]
      : []),
  ].join("\n\n");
  let text: string;
  try {
    ({ text } = await completeText(
      input.connection,
      [
        { role: "system", content: LEARN_SYSTEM },
        { role: "user", content: exchange },
      ],
      { maxTokens: 400, timeoutMs: 20_000, temperature: 0 },
    ));
  } catch (error) {
    if (error instanceof AiError) return 0;
    throw error;
  }
  let kept = 0;
  for (const note of readLearned(text)) {
    await keepMemory({
      accountId: input.accountId,
      storeId: note.everywhere ? null : input.storeId,
      kind: note.kind,
      content: note.content,
      source: input.feedback ? "feedback" : "learned",
      importance: note.importance,
      connection: input.connection,
    });
    kept++;
  }
  return kept;
}
