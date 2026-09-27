import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  blockSpan,
  exportDates,
  exportFile,
  feedUrlProblem,
  manualBlockSpan,
  MAX_FEED_SIZE,
  parseFeed,
  type ExportEvent,
} from "@/lib/calendar-sync";

import { audit, type Membership } from "./auth";

/**
 * Blocked dates and calendar sync (D67, B3b). A resource (a room, an item,
 * a member of staff) is closed by blocks: ones the store sets, and ones read
 * from other calendars (Airbnb, Booking.com and the like) every quarter of
 * an hour. Each resource can also publish its own taken days at a secret
 * address those sites read back. Booking checks blocks through
 * `busyOn()` and, under a lock, `commerce.resource_blocked()`.
 */

type Row = Record<string, unknown>;
type Kind = "staff" | "unit" | "item";
const asKind = (value: unknown): Kind => (value === "unit" || value === "item" ? value : "staff");

/** How often feeds are read, and how many at a time from the cron. */
const SYNC_MINUTES = 15;
const SYNC_BATCH = 20;
const FETCH_TIMEOUT_MS = 15_000;
/** Imported events are kept from a day ago to two years ahead. */
const KEEP_PAST_MS = 24 * 60 * 60 * 1000;
const KEEP_AHEAD_MS = 2 * 366 * 24 * 60 * 60 * 1000;

async function resourceOf(storeId: string, resourceId: string) {
  const [row] = await db().execute<Row>(sql`
    select r.id, r.kind, r.name, r.calendar_token, s.time_zone
    from commerce.booking_resources r join commerce.stores s on s.id = r.store_id
    where r.store_id = ${storeId}::uuid and r.id = ${resourceId}::uuid
  `);
  return row
    ? {
        id: String(row.id),
        kind: asKind(row.kind),
        name: String(row.name),
        token: row.calendar_token ? String(row.calendar_token) : null,
        timeZone: String(row.time_zone),
      }
    : null;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export type ResourceBlock = {
  id: string;
  startsAt: string;
  endsAt: string;
  note: string;
  /** The calendar it came from; null when the store set it. */
  feed: string | null;
  /** Confirmed bookings it overlaps: booked twice, to be sorted out. */
  clashes: number;
};

/** A resource's blocks that have not ended, earliest first. */
export async function listBlocks(storeId: string, resourceId: string): Promise<ResourceBlock[]> {
  const rows = await db().execute<Row>(sql`
    select k.id, k.starts_at, k.ends_at, k.note, f.name as feed,
      (select count(*)::int from commerce.bookings b
        where b.store_id = k.store_id and b.resource_id = k.resource_id and b.status = 'confirmed'
          and b.blocked_from < k.ends_at and b.blocked_to > k.starts_at) as clashes
    from commerce.resource_blocks k
    left join commerce.calendar_feeds f on f.store_id = k.store_id and f.id = k.feed_id
    where k.store_id = ${storeId}::uuid and k.resource_id = ${resourceId}::uuid and k.ends_at > now()
    order by k.starts_at
    limit 500
  `);
  return rows.map((row) => ({
    id: String(row.id),
    startsAt: new Date(String(row.starts_at)).toISOString(),
    endsAt: new Date(String(row.ends_at)).toISOString(),
    note: String(row.note ?? ""),
    feed: row.feed ? String(row.feed) : null,
    clashes: Number(row.clashes ?? 0),
  }));
}

/** Blocks of these resources overlapping a time, for the store's calendars. */
export async function blocksBetween(storeId: string, resourceIds: string[], from: Date, to: Date) {
  if (resourceIds.length === 0) return [];
  const rows = await db().execute<Row>(sql`
    select resource_id, starts_at, ends_at from commerce.resource_blocks
    where store_id = ${storeId}::uuid
      and resource_id in (${sql.join(resourceIds.map((id) => sql`${id}::uuid`), sql`, `)})
      and starts_at < ${to.toISOString()}::timestamptz and ends_at > ${from.toISOString()}::timestamptz
  `);
  return rows.map((row) => ({
    resourceId: String(row.resource_id),
    startsAt: new Date(String(row.starts_at)).toISOString(),
    endsAt: new Date(String(row.ends_at)).toISOString(),
  }));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export const blockInput = z
  .object({
    from: z.string().regex(DATE, "Choose the first date."),
    to: z.string().regex(DATE, "Choose the last date."),
    note: z.string().trim().max(200, "Keep the note under 200 characters."),
  })
  .refine((b) => b.to >= b.from, { message: "The last date cannot be before the first." });

export type BlockResult = { ok: true; clashes: number } | { ok: false; problems: string[] };

/**
 * Closes a resource from one date to another, both included: the nights of
 * a room, the days of anything else. Bookings already there stay; the
 * result says how many there are.
 */
export async function addBlock({ account, store }: Membership, resourceId: string, values: Record<string, unknown>): Promise<BlockResult> {
  const parsed = blockInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  const resource = await resourceOf(store.id, resourceId);
  if (!resource) return { ok: false, problems: ["It is no longer in the store."] };
  const { from, to, note } = parsed.data;
  const span = manualBlockSpan(resource.kind, from, to, resource.timeZone);
  const [row] = await db().execute<Row>(sql`
    insert into commerce.resource_blocks (store_id, resource_id, starts_at, ends_at, note)
    values (${store.id}::uuid, ${resourceId}::uuid, ${new Date(span.startsAt).toISOString()}::timestamptz,
      ${new Date(span.endsAt).toISOString()}::timestamptz, ${note})
    returning id,
      (select count(*)::int from commerce.bookings b
        where b.store_id = ${store.id}::uuid and b.resource_id = ${resourceId}::uuid and b.status = 'confirmed'
          and b.blocked_from < ${new Date(span.endsAt).toISOString()}::timestamptz
          and b.blocked_to > ${new Date(span.startsAt).toISOString()}::timestamptz) as clashes
  `);
  await audit(account.id, store.id, "resource_block.created", { id: String(row.id), resource: resourceId, from, to });
  return { ok: true, clashes: Number(row.clashes ?? 0) };
}

/** Opens a block the store set again; imported ones go when their calendar drops them. */
export async function removeBlock({ account, store }: Membership, blockId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.resource_blocks
    where store_id = ${store.id}::uuid and id = ${blockId}::uuid and feed_id is null
    returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, "resource_block.deleted", { id: blockId });
  return true;
}

// ---------------------------------------------------------------------------
// The resource's own calendar, for other sites to read
// ---------------------------------------------------------------------------

/** The path of a resource's calendar, from its secret. */
export const calendarPath = (token: string) => `/api/calendar/${token}.ics`;

/** Gives the resource a (new) secret address; the old one stops working. */
export async function resetCalendarToken({ account, store }: Membership, resourceId: string): Promise<string | null> {
  const token = randomBytes(24).toString("base64url");
  const rows = await db().execute<Row>(sql`
    update commerce.booking_resources set calendar_token = ${token}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${resourceId}::uuid returning id
  `);
  if (rows.length === 0) return null;
  await audit(account.id, store.id, "booking_resource.calendar_address", { id: resourceId });
  return token;
}

/**
 * The calendar file at a secret address: the resource's confirmed bookings
 * and its blocks, from a month ago, as whole days marked only "Booked" or
 * "Blocked", so no guest's name or note leaves the store.
 */
export async function calendarForToken(token: string): Promise<{ name: string; file: string } | null> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  const [resource] = await db().execute<Row>(sql`
    select r.id, r.store_id, r.kind, r.name, s.time_zone
    from commerce.booking_resources r join commerce.stores s on s.id = r.store_id
    where r.calendar_token = ${token}
  `);
  if (!resource) return null;
  const kind = asKind(resource.kind);
  const tz = String(resource.time_zone);
  const rows = await db().execute<Row>(sql`
    select 'booking-' || b.id as uid, b.starts_at, b.ends_at, 'Booked' as summary
    from commerce.bookings b
    where b.store_id = ${String(resource.store_id)}::uuid and b.resource_id = ${String(resource.id)}::uuid
      and b.status = 'confirmed' and b.ends_at > now() - interval '30 days'
    union all
    select 'block-' || k.id, k.starts_at, k.ends_at, 'Blocked'
    from commerce.resource_blocks k
    where k.store_id = ${String(resource.store_id)}::uuid and k.resource_id = ${String(resource.id)}::uuid
      and k.ends_at > now() - interval '30 days'
    order by 2
  `);
  const events: ExportEvent[] = rows.map((row) => ({
    uid: `${String(row.uid)}@kaizen`,
    summary: String(row.summary),
    ...exportDates(kind, new Date(String(row.starts_at)).getTime(), new Date(String(row.ends_at)).getTime(), tz),
  }));
  return { name: String(resource.name), file: exportFile(String(resource.name), events) };
}

// ---------------------------------------------------------------------------
// Other calendars, read in
// ---------------------------------------------------------------------------

export type CalendarFeed = {
  id: string;
  name: string;
  url: string;
  syncedAt: string | null;
  error: string;
  events: number;
};

export async function listFeeds(storeId: string, resourceId: string): Promise<CalendarFeed[]> {
  const rows = await db().execute<Row>(sql`
    select id, name, url, synced_at, error, events from commerce.calendar_feeds
    where store_id = ${storeId}::uuid and resource_id = ${resourceId}::uuid order by created_at
  `);
  return rows.map((row) => ({
    id: String(row.id),
    name: String(row.name),
    url: String(row.url),
    syncedAt: row.synced_at ? new Date(String(row.synced_at)).toISOString() : null,
    error: String(row.error ?? ""),
    events: Number(row.events ?? 0),
  }));
}

export const feedInput = z.object({
  name: z.string().trim().min(1, "Name the calendar, such as Airbnb.").max(80),
  url: z
    .string()
    .trim()
    .max(2000, "That address is too long.")
    .superRefine((url, ctx) => {
      const problem = feedUrlProblem(url);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
});

export type FeedResult = { ok: true; id: string; sync: SyncOutcome } | { ok: false; problems: string[] };

/** Adds another calendar the resource is booked in, and reads it at once. */
export async function addFeed(
  member: Membership,
  resourceId: string,
  values: Record<string, unknown>,
  fetcher: typeof fetch = fetch,
): Promise<FeedResult> {
  const { account, store } = member;
  const parsed = feedInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: [...new Set(parsed.error.issues.map((i) => i.message))] };
  if (!(await resourceOf(store.id, resourceId))) return { ok: false, problems: ["It is no longer in the store."] };
  const [row] = await db().execute<Row>(sql`
    insert into commerce.calendar_feeds (store_id, resource_id, name, url)
    values (${store.id}::uuid, ${resourceId}::uuid, ${parsed.data.name}, ${parsed.data.url})
    returning id
  `);
  const id = String(row.id);
  await audit(account.id, store.id, "calendar_feed.created", { id, resource: resourceId });
  return { ok: true, id, sync: await syncFeed(store.id, id, fetcher) };
}

/** Stops reading a calendar; the times it blocked open again. */
export async function removeFeed({ account, store }: Membership, feedId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.calendar_feeds where store_id = ${store.id}::uuid and id = ${feedId}::uuid returning id
  `);
  if (rows.length === 0) return false;
  await audit(account.id, store.id, "calendar_feed.deleted", { id: feedId });
  return true;
}

export type SyncOutcome = { ok: true; events: number } | { ok: false; error: string };

/** Fetches a feed, following up to three redirects, each to an address a feed may have; the body at most `MAX_FEED_SIZE`. */
async function fetchFeed(url: string, fetcher: typeof fetch): Promise<string> {
  let address = url;
  for (let hop = 0; hop < 4; hop++) {
    const problem = feedUrlProblem(address);
    if (problem) throw new Error(problem);
    const response = await fetcher(address, {
      redirect: "manual",
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      headers: { Accept: "text/calendar, text/plain;q=0.8, */*;q=0.1", "User-Agent": "Kaizen calendar sync" },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`The calendar answered ${response.status} without an address.`);
      address = new URL(location, address).toString();
      continue;
    }
    if (!response.ok) throw new Error(`The calendar answered ${response.status}.`);
    if (!response.body) return "";
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      text += decoder.decode(value, { stream: true });
      if (text.length > MAX_FEED_SIZE) {
        await reader.cancel();
        throw new Error("The calendar is too large.");
      }
    }
    return text + decoder.decode();
  }
  throw new Error("The calendar sent too many redirects.");
}

/**
 * Reads a feed and makes its blocks what it says now: events it no longer
 * has are removed, the rest added or moved, all in one transaction. A feed
 * that cannot be read keeps its blocks and records why.
 */
export async function syncFeed(storeId: string, feedId: string, fetcher: typeof fetch = fetch, now = Date.now()): Promise<SyncOutcome> {
  const [feed] = await db().execute<Row>(sql`
    select f.url, f.resource_id, r.kind, s.time_zone
    from commerce.calendar_feeds f
    join commerce.booking_resources r on r.store_id = f.store_id and r.id = f.resource_id
    join commerce.stores s on s.id = f.store_id
    where f.store_id = ${storeId}::uuid and f.id = ${feedId}::uuid
  `);
  if (!feed) return { ok: false, error: "The calendar is no longer there." };
  let text: string;
  try {
    text = await fetchFeed(String(feed.url), fetcher);
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 300) : "The calendar could not be read.";
    await db().execute(sql`
      update commerce.calendar_feeds set synced_at = now(), error = ${message}
      where store_id = ${storeId}::uuid and id = ${feedId}::uuid
    `);
    return { ok: false, error: message };
  }
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    const message = "That address does not give a calendar file.";
    await db().execute(sql`
      update commerce.calendar_feeds set synced_at = now(), error = ${message}
      where store_id = ${storeId}::uuid and id = ${feedId}::uuid
    `);
    return { ok: false, error: message };
  }
  const kind = asKind(feed.kind);
  const tz = String(feed.time_zone);
  const blocks = new Map<string, { startsAt: string; endsAt: string; note: string }>();
  for (const event of parseFeed(text, tz)) {
    const span = blockSpan(event, kind, tz);
    if (!span || span.endsAt < now - KEEP_PAST_MS || span.startsAt > now + KEEP_AHEAD_MS) continue;
    blocks.set(event.uid, {
      startsAt: new Date(span.startsAt).toISOString(),
      endsAt: new Date(span.endsAt).toISOString(),
      note: event.summary.slice(0, 200),
    });
  }
  const values = [...blocks.entries()];
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      delete from commerce.resource_blocks
      where store_id = ${storeId}::uuid and feed_id = ${feedId}::uuid
        ${values.length > 0 ? sql`and uid not in (${sql.join(values.map(([uid]) => sql`${uid}`), sql`, `)})` : sql``}
    `);
    for (const [uid, block] of values) {
      await tx.execute(sql`
        insert into commerce.resource_blocks (store_id, resource_id, starts_at, ends_at, note, feed_id, uid)
        values (${storeId}::uuid, ${String(feed.resource_id)}::uuid, ${block.startsAt}::timestamptz,
          ${block.endsAt}::timestamptz, ${block.note}, ${feedId}::uuid, ${uid})
        on conflict (feed_id, uid) do update
          set starts_at = excluded.starts_at, ends_at = excluded.ends_at, note = excluded.note
      `);
    }
    await tx.execute(sql`
      update commerce.calendar_feeds set synced_at = now(), error = '', events = ${values.length}
      where store_id = ${storeId}::uuid and id = ${feedId}::uuid
    `);
  });
  return { ok: true, events: values.length };
}

/** Reads the feeds not read for a quarter of an hour, a batch at a time (from the five-minute cron). */
export async function syncDueFeeds(fetcher: typeof fetch = fetch): Promise<{ synced: number; failed: number }> {
  // Claimed by marking them read now, so an overlapping run takes others.
  const due = await db().execute<Row>(sql`
    update commerce.calendar_feeds f set synced_at = now()
    where f.id in (
      select id from commerce.calendar_feeds
      where synced_at is null or synced_at < now() - make_interval(mins => ${SYNC_MINUTES})
      order by synced_at nulls first
      limit ${SYNC_BATCH}
      for update skip locked
    )
    returning f.store_id, f.id
  `);
  const outcomes = await Promise.all(due.map((row) => syncFeed(String(row.store_id), String(row.id), fetcher)));
  return { synced: outcomes.filter((o) => o.ok).length, failed: outcomes.filter((o) => !o.ok).length };
}
