import "server-only";

import { createHash, createHmac } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { parseKey } from "@/lib/secret-box";

import { log } from "./log";
import { normaliseEmail } from "@/lib/email-address";

/**
 * The admin's own limit on password sign-in per email (PSI SEC-02), beside Supabase Auth's rate limits and its leaked-password check:
 * `SIGN_IN_TRIES` wrong tries in a `SIGN_IN_WINDOW_MINUTES` window stop password sign-in for that email until the window ends, as the
 * shopper's password sign-in does (`customers.ts`). It counts every address alike, whether or not it has access, so the answer never
 * tells which emails do; a sign-in link still works while it holds. Counters are `commerce.chat_usage` rows with no store (bucket
 * `signin:{key}`, pruned after two days by `pruneChatUsage()`), keyed by a keyed hash of the address, never the address itself.
 * Counting never blocks a sign-in when the database is busy: a failure allows.
 */

export const SIGN_IN_TRIES = 10;
export const SIGN_IN_WINDOW_MINUTES = 15;

/** The bucket of an address: an HMAC with a key made from the settings key for this use alone, else (tests, a build) a plain hash. */
export function signInBucket(email: string, env: string | undefined = process.env.SETTINGS_ENCRYPTION_KEY): string {
  const address = normaliseEmail(email);
  const key = parseKey(env);
  const digest = key
    ? createHmac("sha256", createHmac("sha256", key).update("kaizen:admin-sign-in").digest()).update(address).digest("hex")
    : createHash("sha256").update(`kaizen:admin-sign-in|${address}`).digest("hex");
  return `signin:${digest.slice(0, 32)}`;
}

/** The current window's start: now, rounded down to the window. */
const windowStart = sql`to_timestamp(floor(extract(epoch from now()) / ${SIGN_IN_WINDOW_MINUTES * 60}) * ${SIGN_IN_WINDOW_MINUTES * 60})`;

/** Whether the address has used its wrong tries in this window. */
export async function signInLocked(email: string): Promise<boolean> {
  try {
    const [row] = await db().execute<{ count: number }>(sql`
      select count from commerce.chat_usage where store_id is null and bucket = ${signInBucket(email)} and "window" = ${windowStart}
    `);
    const locked = Number(row?.count ?? 0) >= SIGN_IN_TRIES;
    if (locked) log("warn", "admin_sign_in.locked", { tries: Number(row?.count ?? 0) });
    return locked;
  } catch (error) {
    // Fails closed (PSI SEC-10): a password is never tried without its count. A sign-in link still works.
    log("error", "admin_sign_in.count_failed", {}, error);
    return true;
  }
}

/** Counts a wrong try for the address, and logs it (D389, SEC-11) without the address: a security log line names no one. */
export async function countFailedSignIn(email: string): Promise<void> {
  log("warn", "admin_sign_in.failed", { via: "password" });
  try {
    await db().execute(sql`
      insert into commerce.chat_usage (store_id, bucket, "window", count) values (null, ${signInBucket(email)}, ${windowStart}, 1)
      on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    `);
  } catch (error) {
    log("error", "admin_sign_in.count_failed", {}, error);
  }
}

/** A sign-in that worked starts the address's count again. */
export async function clearSignIns(email: string): Promise<void> {
  try {
    await db().execute(sql`delete from commerce.chat_usage where store_id is null and bucket = ${signInBucket(email)}`);
  } catch (error) {
    log("error", "admin_sign_in.count_failed", {}, error);
  }
}
