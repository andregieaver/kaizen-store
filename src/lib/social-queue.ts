/**
 * The posting queue (D870 S3.2, `docs/social-manager.md` 6): when an approved post goes out on its own, how often the queue tries, how long it
 * waits after a refusal, and how many posts a channel takes a day. Only a post a person approved is ever queued; the AI manager's request
 * queues it for now, once the owner said yes. Pure; the server is `src/server/social-queue.ts` (scheduling) and `social-queue-run.ts` (the
 * dispatcher's job).
 */

import { zonedTime } from "./booking-slots";

/** The hour, in the store's time, an approved post goes out on its planned day. */
export const POST_HOUR = "10:00";
/** The queue tries a post at most this many times; after that it waits for a person's *Post now*. */
export const QUEUE_TRIES_MAX = 3;
/** Minutes to wait after the first and the second refusal. */
export const RETRY_MINUTES = [15, 60] as const;
/** At most this many posts a day on one channel of a store, the queue's and a person's together (Instagram allows 100). */
export const DAY_POSTS_MAX = 25;

/**
 * When an approved post planned for `day` goes out: that day at `POST_HOUR` in the store's time; one planned for today whose hour has passed
 * goes out now; one planned for a day gone by is not queued (null), as its moment is over.
 */
export function scheduleFor(day: string | null, timeZone: string, now: Date): Date | null {
  if (!day) return null;
  const at = new Date(zonedTime(day, POST_HOUR, timeZone));
  if (at.getTime() >= now.getTime()) return at;
  const today = now.toLocaleDateString("sv-SE", { timeZone });
  return day === today ? now : null;
}

/** When to try again after a refusal on the `tries`th attempt; null once the queue has tried enough. */
export function nextTry(tries: number, now: Date): Date | null {
  if (tries >= QUEUE_TRIES_MAX) return null;
  const minutes = RETRY_MINUTES[Math.min(tries, RETRY_MINUTES.length) - 1] ?? RETRY_MINUTES[RETRY_MINUTES.length - 1];
  return new Date(now.getTime() + minutes * 60_000);
}
