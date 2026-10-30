import "server-only";

import { createHash } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";

import { col, typedRow } from "./typed-rows";

/**
 * `Idempotency-Key` on the Admin API's POSTs (PSI DATA-03), as payment APIs do it: a client that repeats a create after a lost answer
 * gets the first answer again instead of a second product or fulfilment. The key is the client's, per token; the same key with another
 * route or body is refused, and while the first request runs a second one is told to try again. Answers are kept 24 hours
 * (`pruneApiIdempotency()`); a failure Kaizena Flow could not answer is not kept, so a retry runs again.
 */

/** How long a key's answer is kept. */
export const IDEMPOTENCY_HOURS = 24;
const KEY = /^[\x21-\x7e]{1,255}$/;

export type IdempotentAnswer = { status: number; body: unknown };

export type Idempotency =
  | { kind: "run"; save: (answer: IdempotentAnswer) => Promise<void>; forget: () => Promise<void> }
  | { kind: "replay"; answer: IdempotentAnswer }
  | { kind: "refused"; code: "invalid" | "conflict"; message: string };

/** The route and the body as one hash: what a key stands for. */
export const requestHash = (route: string, body: string): string => createHash("sha256").update(`${route}\n${body}`).digest("hex");

/**
 * What to do with a POST that carries a key: run it (and keep its answer), give the kept answer, or refuse. A request without a key is
 * never asked here.
 */
export async function claimIdempotencyKey(tokenId: string, key: string, route: string, body: string): Promise<Idempotency> {
  if (!KEY.test(key)) return { kind: "refused", code: "invalid", message: "Idempotency-Key is 1 to 255 printable characters." };
  const hash = requestHash(route, body);
  const claimed = await db().execute(sql`
    insert into commerce.api_idempotency_keys (token_id, key, request_hash) values (${tokenId}::uuid, ${key}, ${hash})
    on conflict do nothing returning key
  `);
  if (claimed.length > 0) {
    const where = sql`token_id = ${tokenId}::uuid and key = ${key}`;
    return {
      kind: "run",
      save: async (answer) => {
        await db().execute(sql`update commerce.api_idempotency_keys set status = ${answer.status}, body = ${JSON.stringify(answer.body ?? null)}::jsonb where ${where}`);
      },
      forget: async () => {
        await db().execute(sql`delete from commerce.api_idempotency_keys where ${where} and status is null`);
      },
    };
  }
  const kept = await typedRow(
    z.object({ request_hash: col.text, status: col.int.nullable(), body: z.unknown() }),
    sql`select request_hash, status, body from commerce.api_idempotency_keys where token_id = ${tokenId}::uuid and key = ${key}`,
  );
  // Pruned between the insert and the read: rare enough to ask the client to send it again.
  if (!kept) return { kind: "refused", code: "conflict", message: "This Idempotency-Key is being used by another request. Try again." };
  if (kept.request_hash !== hash) {
    return { kind: "refused", code: "invalid", message: "This Idempotency-Key was used for another request. Use a new key for a new request." };
  }
  if (kept.status === null) return { kind: "refused", code: "conflict", message: "A request with this Idempotency-Key is still being answered. Try again." };
  return { kind: "replay", answer: { status: kept.status, body: kept.body } };
}

/** Deletes the answers kept longer than `IDEMPOTENCY_HOURS`. Returns how many went. */
export async function pruneApiIdempotency(now: Date = new Date()): Promise<number> {
  const gone = await db().execute(sql`
    delete from commerce.api_idempotency_keys where created_at < ${now.toISOString()}::timestamptz - make_interval(hours => ${IDEMPOTENCY_HOURS}) returning key
  `);
  return gone.length;
}
