import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret, parseKey } from "@/lib/secret-box";

import { audit } from "./auth";

/**
 * A store's product feeds (wave 5 unit H, D302, `docs/wave-5-marketing.md` 13): the only writer of `commerce.feed_settings`. The secret
 * part of the feeds' address is kept as a hash to find the store by, and encrypted so the owner can see it again; it is never logged or
 * audited. `marketing:write`, checked by the actions.
 */

type Row = Record<string, unknown>;

const key = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

export const feedTokenHash = (token: string) => createHash("sha256").update(token).digest("hex");

/** A token as it appears in an address: 32 url-safe characters. */
export const FEED_TOKEN = /^[A-Za-z0-9_-]{32}$/;

export type FeedSettingsView = { on: boolean; token: string | null };

/** The store's feeds as the page shows them: whether they are on and, when the key can open it, the token. */
export async function feedSettingsOf(storeId: string): Promise<FeedSettingsView | null> {
  const [row] = await db().execute<Row>(sql`select token, "on" from commerce.feed_settings where store_id = ${storeId}::uuid`);
  if (!row) return null;
  const secretKey = key();
  let token: string | null = null;
  try {
    token = secretKey ? decryptSecret(String(row.token), secretKey) : null;
  } catch {
    token = null;
  }
  return { on: Boolean(row.on), token };
}

export type FeedSettingsResult = { ok: true } | { ok: false; problem: "no_key" };

/** Switches the feeds on, making their address the first time (or a new one when `renew`, the old one stopping at once). */
export async function switchFeedsOn(storeId: string, accountId: string, { renew = false } = {}): Promise<FeedSettingsResult> {
  const secretKey = key();
  if (!secretKey) return { ok: false, problem: "no_key" };
  const [existing] = await db().execute<Row>(sql`select 1 from commerce.feed_settings where store_id = ${storeId}::uuid`);
  if (existing && !renew) {
    await db().execute(sql`update commerce.feed_settings set "on" = true, updated_at = now() where store_id = ${storeId}::uuid`);
    await audit(accountId, storeId, "marketing.feed_on", {});
    return { ok: true };
  }
  const token = randomBytes(24).toString("base64url");
  await db().execute(sql`
    insert into commerce.feed_settings (store_id, token_hash, token, "on") values (${storeId}::uuid, ${feedTokenHash(token)}, ${encryptSecret(token, secretKey)}, true)
    on conflict (store_id) do update set token_hash = excluded.token_hash, token = excluded.token, "on" = true, updated_at = now()
  `);
  await audit(accountId, storeId, renew ? "marketing.feed_renewed" : "marketing.feed_on", {});
  return { ok: true };
}

export async function switchFeedsOff(storeId: string, accountId: string): Promise<void> {
  const rows = await db().execute<Row>(sql`
    update commerce.feed_settings set "on" = false, updated_at = now() where store_id = ${storeId}::uuid and "on" returning 1
  `);
  if (rows.length > 0) await audit(accountId, storeId, "marketing.feed_off", {});
}

/** The store whose feeds a token opens, while they are on; null for anything else. */
export async function storeOfFeedToken(token: string): Promise<{ storeId: string; slug: string } | null> {
  if (!FEED_TOKEN.test(token)) return null;
  const [row] = await db().execute<Row>(sql`
    select f.store_id, s.slug from commerce.feed_settings f join commerce.stores s on s.id = f.store_id
    where f.token_hash = ${feedTokenHash(token)} and f."on"
  `);
  return row ? { storeId: String(row.store_id), slug: String(row.slug) } : null;
}
