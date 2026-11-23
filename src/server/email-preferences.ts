import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { TOKEN_PATTERN } from "@/lib/marketing-consent";
import type { Topic } from "@/lib/marketing-topics";

import { readerTopics, recordChoices } from "./marketing-topics";
import { col, typedRow } from "./typed-rows";

/**
 * A reader's own choices about a store's marketing email (email plan M4.2, D882, `docs/email-topics.md`), reached by the token every
 * marketing email carries, without signing in: the topics they get (each change kept as a record, `recordChoices()`), how often, and a
 * month's rest. Each is held at send by `suppressed()`; unsubscribing from everything stays `unsubscribeByToken()`.
 */

export const FREQUENCIES = ["all", "weekly", "monthly"] as const;
export type Frequency = (typeof FREQUENCIES)[number];

/** A month's rest, in days. */
export const REST_DAYS = 30;

export type Preferences = {
  subscriberId: string;
  status: string;
  frequency: Frequency;
  /** While resting, until when; else null. */
  restUntil: string | null;
  topics: (Topic & { in: boolean })[];
};

const SUBSCRIBER = z.object({ id: col.uuid, status: col.text, frequency: z.enum(FREQUENCIES), rest_until: col.timestampOrNull });

async function subscriberOf(storeId: string, token: string) {
  if (!TOKEN_PATTERN.test(token)) return null;
  return typedRow(
    SUBSCRIBER,
    sql`select id, status, frequency, case when rest_until > now() then rest_until end as rest_until
          from commerce.marketing_subscribers where store_id = ${storeId}::uuid and token = ${token}`,
  );
}

/** The reader's choices by their link's token, in this store; null for a token that is not one of its subscribers. */
export async function preferencesByToken(storeId: string, token: string): Promise<Preferences | null> {
  const row = await subscriberOf(storeId, token);
  if (!row) return null;
  return { subscriberId: row.id, status: row.status, frequency: row.frequency, restUntil: row.rest_until, topics: await readerTopics(storeId, row.id) };
}

/**
 * Saves the reader's topics and how often: a topic is in when its id is among `topicIds`, the others out (only the store's live topics,
 * each change kept with the words the page showed). Only a subscribed reader can save.
 */
export async function savePreferences(storeId: string, token: string, input: { topicIds: readonly string[]; frequency: string; words: string }): Promise<boolean> {
  const row = await subscriberOf(storeId, token);
  if (!row || row.status !== "subscribed") return false;
  const frequency = (FREQUENCIES as readonly string[]).includes(input.frequency) ? (input.frequency as Frequency) : row.frequency;
  const chosen = new Set(input.topicIds);
  const topics = await readerTopics(storeId, row.id);
  await recordChoices(storeId, row.id, topics.map((t) => ({ topicId: t.id, optedIn: chosen.has(t.id) })), "preferences", input.words);
  if (frequency !== row.frequency) {
    await typedRow(z.object({ id: col.uuid }), sql`update commerce.marketing_subscribers set frequency = ${frequency} where store_id = ${storeId}::uuid and id = ${row.id}::uuid returning id`);
  }
  return true;
}

/** A month's rest (`rest`), or starting again now; only a subscribed reader. */
export async function setRest(storeId: string, token: string, rest: boolean): Promise<boolean> {
  const row = await subscriberOf(storeId, token);
  if (!row || row.status !== "subscribed") return false;
  const done = await typedRow(
    z.object({ id: col.uuid }),
    sql`update commerce.marketing_subscribers set rest_until = ${rest ? sql`now() + make_interval(days => ${REST_DAYS})` : sql`null`}
         where store_id = ${storeId}::uuid and id = ${row.id}::uuid returning id`,
  );
  return Boolean(done);
}
