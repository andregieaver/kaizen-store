import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { claimSeconds, eventFilter, EVENT_KEEP_DAYS, isConsumerName, nextCursor, readLimit, type LoggedEvent } from "@/lib/event-log";

import { log } from "./log";
import { owned } from "./owned";
import { textList } from "./sql-arrays";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The event log (ecosystem plan E3.1, D718): every event the database queues is kept in `commerce.events` for `EVENT_KEEP_DAYS`, written in
 * the transaction that made it whether or not anyone subscribes (`commerce.log_event()`). An engine reads it from where it left off: each
 * reader (a `consumer`) has a cursor in `commerce.event_cursors`, and a read claims it, so two runners of one reader never take the same
 * events; `advanceCursor()` moves it on and lets the claim go.
 *
 * The log is read in the order of `(tx, id)`, the writing transaction's id and then the row's, and only below the oldest transaction still
 * running (`pg_snapshot_xmin(pg_current_snapshot())`). An id alone would not do: a transaction that wrote event 101 can commit after the one
 * that wrote 102, and a reader that had moved past 102 would never see 101. A transaction still running holds the reader back, never loses
 * it an event. Ids only: what an event is about is read where it lives, as the webhooks and workflows read it (`subjectData()`).
 */

const bigId = z.union([z.number(), z.string()]).transform(Number).pipe(z.int().nonnegative());

/** A read's batch: the events, the claim to hand back to `advanceCursor()` (null when another runner holds the cursor) and where to move it. */
export type EventBatch = { claim: string | null; events: LoggedEvent[]; lastId: number | null };

export type ReadOptions = {
  /** Only these events (`order.paid`, …); every event when left out. */
  events?: readonly string[];
  /** Only this store's events, or Kaizena Flow's own (`null`); every store's when left out. */
  storeId?: string | null;
  limit?: number;
  /** How long the claim holds while the batch is handled. */
  claimSeconds?: number;
  /** Where a reader new to the log starts: at what happens from now on (the default), or at the oldest event kept. */
  from?: "now" | "start";
};

function checkedConsumer(consumer: string): string {
  if (!isConsumerName(consumer)) throw new Error("Not a reader's name: lower case letters, digits and _ . : -, starting with a letter.");
  return consumer;
}

/** The reader's cursor, made where it starts when it has none. */
async function ensureCursor(consumer: string, from: "now" | "start"): Promise<void> {
  // From now: just before the oldest transaction still running, so every one that has finished is past and anything still running (and
  // everything after) is read. Ids start at 1, so `(xmin, 0)` is before all of that transaction's events.
  await db().execute(sql`
    insert into commerce.event_cursors (consumer, last_tx, last_id)
    select ${consumer}, case when ${from} = 'start' then 0 else pg_snapshot_xmin(pg_current_snapshot())::text::bigint end, 0
    on conflict (consumer) do nothing
  `);
}

/**
 * The reader's next events after its cursor, claimed for `claimSeconds`: in order, at most `limit`, only those asked for. Answers no claim
 * and no events while another runner holds the cursor. Hand the claim and `lastId` to `advanceCursor()` once the batch is handled; the
 * claim runs out by itself if the runner dies, and the next read takes the same events again (at least once, never skipped).
 */
export async function readEventsAfter(consumer: string, options: ReadOptions = {}): Promise<EventBatch> {
  const name = checkedConsumer(consumer);
  const wanted = eventFilter(options.events);
  const limit = readLimit(options.limit);
  await ensureCursor(name, options.from ?? "now");
  const cursor = await typedRow(
    z.object({ claim: col.uuid, last_tx: bigId, last_id: bigId }),
    sql`
      update commerce.event_cursors
      set claim = gen_random_uuid(), claimed_until = now() + make_interval(secs => ${claimSeconds(options.claimSeconds)}), updated_at = now()
      where consumer = ${name} and (claimed_until is null or claimed_until <= now())
      returning claim, last_tx, last_id
    `,
  );
  if (!cursor) return { claim: null, events: [], lastId: null };
  const store = options.storeId === undefined ? sql`true` : owned(options.storeId, sql`e.store_id`);
  const events = wanted.length > 0 ? sql`e.event = any(${textList(wanted)})` : sql`true`;
  // One statement, so the newest settled event and the batch are read in one snapshot: a batch that is not full holds every event the reader
  // asked for up to the newest, and the cursor may move past the rest.
  const rows = await typedRows(
    z.object({
      newest_id: bigId,
      newest_is_new: col.bool,
      id: bigId.nullable(),
      store_id: col.uuid.nullable(),
      event: col.textOrNull,
      subject_id: col.uuid.nullable(),
      at: col.timestampOrNull,
    }),
    sql`
      with horizon as materialized (select pg_snapshot_xmin(pg_current_snapshot())::text::bigint as xmin)
      select n.id as newest_id, (n.tx, n.id) > (${cursor.last_tx}::bigint, ${cursor.last_id}::bigint) as newest_is_new,
        b.id, b.store_id, b.event, b.subject_id, b.at
      from (
        select e.tx, e.id from commerce.events e, horizon h where e.tx < h.xmin order by e.tx desc, e.id desc limit 1
      ) n
      left join lateral (
        select e.tx, e.id, e.store_id, e.event, e.subject_id, e.at from commerce.events e, horizon h
        where (e.tx, e.id) > (${cursor.last_tx}::bigint, ${cursor.last_id}::bigint) and e.tx < h.xmin and ${store} and ${events}
        order by e.tx, e.id
        limit ${limit}
      ) b on true
      order by b.tx, b.id
    `,
  );
  const batch: LoggedEvent[] = rows.flatMap((r) =>
    r.id === null || r.event === null || r.at === null ? [] : [{ id: r.id, storeId: r.store_id, event: r.event, subjectId: r.subject_id, at: r.at }],
  );
  const newest = rows[0] ? { id: rows[0].newest_id, isNew: rows[0].newest_is_new } : null;
  return { claim: cursor.claim, events: batch, lastId: nextCursor(batch, limit, newest) };
}

/**
 * Moves the reader's cursor to an event it has handled (`lastId` from its batch; null moves nothing) and lets its claim go. Never moves it
 * back. False when the claim is no longer the runner's: it ran out and another runner took the cursor, which then reads the batch again.
 */
export async function advanceCursor(consumer: string, lastId: number | null, claim: string): Promise<boolean> {
  const name = checkedConsumer(consumer);
  const moved = await typedRow(
    z.object({ consumer: col.text }),
    sql`
      update commerce.event_cursors c set
        last_tx = case when (n.tx, n.id) > (c.last_tx, c.last_id) then n.tx else c.last_tx end,
        last_id = case when (n.tx, n.id) > (c.last_tx, c.last_id) then n.id else c.last_id end,
        claim = null, claimed_until = null, updated_at = now()
      from (select 1) one
      left join lateral (select e.tx, e.id from commerce.events e where e.id = ${lastId}::bigint) n on true
      where c.consumer = ${name} and c.claim = ${claim}::uuid
      returning c.consumer
    `,
  );
  if (!moved) log("warn", "event_log.claim_lost", { consumer: name });
  return moved !== null;
}

/** Lets a reader's claim go without moving its cursor (its handler failed): the next read takes the same events again. */
export async function releaseCursor(consumer: string, claim: string): Promise<void> {
  await db().execute(sql`
    update commerce.event_cursors set claim = null, claimed_until = null, updated_at = now()
    where consumer = ${checkedConsumer(consumer)} and claim = ${claim}::uuid
  `);
}

/**
 * Reads a batch, hands it to `handle` and moves the cursor past it: what a new engine runs each time its job does. A handler that throws
 * lets the claim go and the error through, so the same events come again on the next run. `busy` when another runner holds the cursor.
 */
export async function consumeEvents(
  consumer: string,
  options: ReadOptions,
  handle: (events: LoggedEvent[]) => Promise<void>,
): Promise<{ busy: boolean; handled: number }> {
  const batch = await readEventsAfter(consumer, options);
  if (!batch.claim) return { busy: true, handled: 0 };
  try {
    if (batch.events.length > 0) await handle(batch.events);
  } catch (error) {
    await releaseCursor(consumer, batch.claim);
    throw error;
  }
  await advanceCursor(consumer, batch.lastId, batch.claim);
  return { busy: false, handled: batch.events.length };
}

/** Rows a prune deletes in one statement, and the most statements a day's run takes (the rest wait for the next day). */
const PRUNE_BATCH = 10_000;
const PRUNE_ROUNDS = 50;

/**
 * Events older than `EVENT_KEEP_DAYS` go, oldest first, in batches below the first event still young enough to keep: every row before it
 * is older, so the database's guard lets each go (an event that committed late with an older time waits for the next day). Run daily.
 */
export async function pruneEvents(): Promise<number> {
  let deleted = 0;
  for (let round = 0; round < PRUNE_ROUNDS; round++) {
    // Every store's: a range of the oldest ids, up to the batch's last.
    const rows = await db().execute(sql`
      delete from commerce.events
      where at < now() - make_interval(days => ${EVENT_KEEP_DAYS})
        and id < (
          select coalesce(max(b.id) + 1, -9223372036854775808) from (
            select e.id from commerce.events e
            where e.id < coalesce(
                (select f.id from commerce.events f where f.at >= now() - make_interval(days => ${EVENT_KEEP_DAYS}) order by f.id limit 1),
                9223372036854775807)
              and e.at < now() - make_interval(days => ${EVENT_KEEP_DAYS})
            order by e.id
            limit ${PRUNE_BATCH}
          ) b
        )
      returning 1
    `);
    deleted += rows.length;
    if (rows.length < PRUNE_BATCH) break;
  }
  return deleted;
}
