/**
 * The event log (ecosystem plan E3.1, D718): the pure parts. The database writes every event it queues into `commerce.events`
 * (`commerce.log_event()`, from `queue_integration_event()`, `queue_store_event()` and `queue_platform_event()`), ids only; an engine reads
 * it from where it left off with a cursor of its own (`src/server/event-log.ts`). Nothing here reads the database.
 */

/** How long the log keeps an event; the database refuses to delete a younger one (`commerce.guard_events()`), and a test holds them equal. */
export const EVENT_KEEP_DAYS = 90;

/** Events a read hands back when no limit is asked for, and the most it ever does. */
export const EVENT_READ_DEFAULT = 100;
export const EVENT_READ_MAX = 1000;

/** How long a runner holds a reader's cursor while it handles a batch, unless it asks otherwise; and the bounds of what it may ask. */
export const CLAIM_SECONDS_DEFAULT = 300;
export const CLAIM_SECONDS_MIN = 10;
export const CLAIM_SECONDS_MAX = 900;

/** One event as the log keeps it. `storeId` is null for Kaizena Flow's own. */
export type LoggedEvent = { id: number; storeId: string | null; event: string; subjectId: string | null; at: string };

/** A reader's name, as `commerce.event_cursors` holds it: `workflows`, `autopilot:{store}`, … */
const CONSUMER = /^[a-z][a-z0-9_.:-]{0,99}$/;

export const isConsumerName = (value: string): boolean => CONSUMER.test(value);

/** An event's name, as `commerce.events` holds it: `order.paid`, `work_invoice.sent`, … */
const EVENT = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export const isEventName = (value: string): boolean => value.length <= 80 && EVENT.test(value);

const clamp = (value: number | undefined, fallback: number, min: number, max: number) =>
  value === undefined || !Number.isFinite(value) ? fallback : Math.min(max, Math.max(min, Math.trunc(value)));

/** How many events a read takes: the default when none is asked, at least one, at most `EVENT_READ_MAX`. */
export const readLimit = (limit?: number): number => clamp(limit, EVENT_READ_DEFAULT, 1, EVENT_READ_MAX);

/** How long a read holds the cursor, within the bounds. */
export const claimSeconds = (seconds?: number): number => clamp(seconds, CLAIM_SECONDS_DEFAULT, CLAIM_SECONDS_MIN, CLAIM_SECONDS_MAX);

/**
 * Where a reader's cursor moves after a batch: to the batch's last event when the batch is full (there may be more of the reader's after
 * it), else to the newest settled event of the whole log (`newest`), so the events it did not ask for are not read again; null when the log
 * has nothing new for it (`newest` is not after the cursor).
 */
export function nextCursor(batch: readonly { id: number }[], limit: number, newest: { id: number; isNew: boolean } | null): number | null {
  if (batch.length >= limit && batch.length > 0) return batch[batch.length - 1].id;
  if (newest?.isNew) return newest.id;
  return batch.length > 0 ? batch[batch.length - 1].id : null;
}

/** The names asked for, checked and without repeats; an empty list means every event. */
export function eventFilter(events: readonly string[] | undefined): string[] {
  const names = [...new Set((events ?? []).map((e) => e.trim()))];
  const bad = names.filter((e) => !isEventName(e));
  if (bad.length > 0) throw new Error(`Not an event's name: ${bad.slice(0, 3).join(", ")}`);
  return names;
}
