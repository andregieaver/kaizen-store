import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { TOPICS_MAX, type Topic, type TopicNames } from "@/lib/marketing-topics";
import { topicInput } from "@/lib/marketing-topics-schema";

import { audit } from "./auth";
import { owned } from "./owned";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * A store's own email topics (email plan M4.2, D882, `docs/email-topics.md`): the only writer of `commerce.marketing_topics` and
 * `commerce.marketing_topic_choices`. Topics are written by staff with `marketing:write` (checked by the caller) and audited
 * `marketing_topic.*` with ids, never names. A reader is in a topic by their newest choice, else the topic's `default_on` (`inTopic()`),
 * the one rule a broadcast's count and its frozen list both read.
 */

const TOPIC_ROW = z.object({ id: col.uuid, names: z.record(z.string(), z.object({ name: z.string(), line: z.string().default("") })), default_on: col.bool, archived: col.bool });

const asTopic = (r: z.output<typeof TOPIC_ROW>): Topic => ({ id: r.id, names: r.names as TopicNames, defaultOn: r.default_on, archived: r.archived });

/** The store's topics in the owner's order; archived ones only when asked. */
export async function listTopics(storeId: string, withArchived = false): Promise<Topic[]> {
  const rows = await typedRows(
    TOPIC_ROW,
    sql`select id, names, default_on, archived_at is not null as archived from commerce.marketing_topics
         where ${owned(storeId)} ${withArchived ? sql`` : sql`and archived_at is null`} order by position, created_at, id`,
  );
  return rows.map(asTopic);
}

/** One topic of the store, archived or not. */
export async function getTopic(storeId: string, id: string): Promise<Topic | null> {
  if (!z.uuid().safeParse(id).success) return null;
  const row = await typedRow(TOPIC_ROW, sql`select id, names, default_on, archived_at is not null as archived from commerce.marketing_topics where ${owned(storeId)} and id = ${id}::uuid`);
  return row ? asTopic(row) : null;
}

export type TopicProblem = "input" | "full" | "unknown";

/** Adds a topic (`id` null, last in the order) or renames one, from the form's values. */
export async function saveTopic(storeId: string, accountId: string, id: string | null, input: unknown): Promise<{ ok: true; id: string } | { ok: false; problem: TopicProblem; message?: string }> {
  const parsed = topicInput.safeParse(input);
  if (!parsed.success) return { ok: false, problem: "input", message: parsed.error.issues[0]?.message };
  const { names, defaultOn } = parsed.data;
  if (id === null) {
    const count = await typedRow(z.object({ n: col.int }), sql`select count(*)::int as n from commerce.marketing_topics where ${owned(storeId)} and archived_at is null`);
    if ((count?.n ?? 0) >= TOPICS_MAX) return { ok: false, problem: "full" };
    const row = await typedRow(
      z.object({ id: col.uuid }),
      sql`insert into commerce.marketing_topics (store_id, names, default_on, position)
          values (${storeId}::uuid, ${JSON.stringify(names)}::jsonb, ${defaultOn},
                  (select coalesce(max(position), 0) + 1 from commerce.marketing_topics where ${owned(storeId)}))
          returning id`,
    );
    if (!row) return { ok: false, problem: "unknown" };
    await audit(accountId, storeId, "marketing_topic.added", { topic: row.id }, { area: "marketing", target: { type: "marketing_topic", id: row.id } });
    return { ok: true, id: row.id };
  }
  if (!z.uuid().safeParse(id).success) return { ok: false, problem: "unknown" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`update commerce.marketing_topics set names = ${JSON.stringify(names)}::jsonb, default_on = ${defaultOn}, updated_at = now()
        where ${owned(storeId)} and id = ${id}::uuid returning id`,
  );
  if (!row) return { ok: false, problem: "unknown" };
  await audit(accountId, storeId, "marketing_topic.changed", { topic: id }, { area: "marketing", target: { type: "marketing_topic", id } });
  return { ok: true, id };
}

/** Archives a topic (its choices stay as a record; a broadcast about it still reaches those in it) or brings it back. */
export async function archiveTopic(storeId: string, accountId: string, id: string, archived: boolean): Promise<boolean> {
  if (!z.uuid().safeParse(id).success) return false;
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`update commerce.marketing_topics set archived_at = ${archived ? sql`now()` : sql`null`}, updated_at = now()
        where ${owned(storeId)} and id = ${id}::uuid returning id`,
  );
  if (rows.length === 0) return false;
  await audit(accountId, storeId, archived ? "marketing_topic.archived" : "marketing_topic.restored", { topic: id }, { area: "marketing", target: { type: "marketing_topic", id } });
  return true;
}

/** Moves a topic one place up or down in the owner's order. */
export async function moveTopic(storeId: string, accountId: string, id: string, by: -1 | 1): Promise<boolean> {
  const topics = await listTopics(storeId);
  const at = topics.findIndex((t) => t.id === id);
  const to = at + by;
  if (at < 0 || to < 0 || to >= topics.length) return false;
  const order = [...topics];
  [order[at], order[to]] = [order[to], order[at]];
  await typedRows(
    z.object({ id: col.uuid }),
    sql`update commerce.marketing_topics t set position = o.n, updated_at = now()
          from (select * from jsonb_to_recordset(${JSON.stringify(order.map((t, n) => ({ id: t.id, n })))}::jsonb) as x(id uuid, n int)) o
         where t.store_id = ${storeId}::uuid and t.id = o.id returning t.id`,
  );
  await audit(accountId, storeId, "marketing_topic.moved", { topic: id }, { area: "marketing", target: { type: "marketing_topic", id } });
  return true;
}

/** The one rule, on the subscriber row `s`: their newest choice for the topic, else its default. */
const inTopicRule = (topicId: SQL, defaultOn: SQL): SQL =>
  sql`coalesce((select c.opted_in from commerce.marketing_topic_choices c
                 where c.store_id = s.store_id and c.subscriber_id = s.id and c.topic_id = ${topicId}
                 order by c.created_at desc, c.id desc limit 1), ${defaultOn})`;

/**
 * Whether the subscriber row `s` is in a topic: their newest choice for it, else the topic's `default_on`. One rule for the count, the
 * frozen list and the preference page.
 */
export function inTopic(topic: Pick<Topic, "id" | "defaultOn">): SQL {
  return inTopicRule(sql`${topic.id}::uuid`, sql`${topic.defaultOn}`);
}

export type TopicSource = "preferences" | "form" | "staff" | "api";

/** Keeps a subscriber's choices as new rows, only for topics whose choice changed; the words are what they saw. */
export async function recordChoices(
  storeId: string,
  subscriberId: string,
  choices: readonly { topicId: string; optedIn: boolean }[],
  source: TopicSource,
  words: string,
): Promise<number> {
  if (choices.length === 0) return 0;
  const rows = await typedRows(
    z.object({ id: col.uuid }),
    sql`
      insert into commerce.marketing_topic_choices (store_id, subscriber_id, topic_id, opted_in, source, words)
      select ${storeId}::uuid, ${subscriberId}::uuid, x.topic_id, x.opted_in, ${source}, ${words.slice(0, 1000)}
        from jsonb_to_recordset(${JSON.stringify(choices.map((c) => ({ topic_id: c.topicId, opted_in: c.optedIn })))}::jsonb) as x(topic_id uuid, opted_in boolean)
        join commerce.marketing_topics t on t.store_id = ${storeId}::uuid and t.id = x.topic_id
        join commerce.marketing_subscribers s on s.store_id = ${storeId}::uuid and s.id = ${subscriberId}::uuid
       where ${inTopicRule(sql`x.topic_id`, sql`t.default_on`)} is distinct from x.opted_in
      returning id
    `,
  );
  return rows.length;
}

/**
 * How many subscribed readers each topic reaches now, in one statement: for a topic on by default, everyone less those whose newest choice
 * is out; otherwise those whose newest choice is in. The same rule as `inTopic()`, counted without reading each reader.
 */
export async function topicCounts(storeId: string): Promise<Map<string, number>> {
  const rows = await typedRows(
    z.object({ id: col.uuid, n: col.int }),
    sql`
      with subscribed as (
        select s.id from commerce.marketing_subscribers s where s.store_id = ${storeId}::uuid and s.status = 'subscribed'
      ), latest as (
        select distinct on (c.subscriber_id, c.topic_id) c.topic_id, c.opted_in
          from commerce.marketing_topic_choices c join subscribed s on s.id = c.subscriber_id
         where c.store_id = ${storeId}::uuid
         order by c.subscriber_id, c.topic_id, c.created_at desc, c.id desc
      )
      select t.id,
             (case when t.default_on then (select count(*) from subscribed) - count(l.topic_id) filter (where not l.opted_in)
                   else count(l.topic_id) filter (where l.opted_in) end)::int as n
        from commerce.marketing_topics t left join latest l on l.topic_id = t.id
       where t.store_id = ${storeId}::uuid and t.archived_at is null
       group by t.id, t.default_on
    `,
  );
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** A reader's topics as the preference page shows them: each live topic of the store, in order, with whether they are in it now. */
export async function readerTopics(storeId: string, subscriberId: string): Promise<(Topic & { in: boolean })[]> {
  const rows = await typedRows(
    TOPIC_ROW.extend({ in: col.bool }),
    sql`select t.id, t.names, t.default_on, false as archived, ${inTopicRule(sql`t.id`, sql`t.default_on`)} as in
          from commerce.marketing_topics t
          join commerce.marketing_subscribers s on s.store_id = t.store_id and s.id = ${subscriberId}::uuid
         where t.store_id = ${storeId}::uuid and t.archived_at is null
         order by t.position, t.created_at, t.id`,
  );
  return rows.map((r) => ({ ...asTopic(r), in: r.in }));
}
