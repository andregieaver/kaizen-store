import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { ACCOUNT_SHAPES, AD_PLATFORMS, type AdPlatform } from "@/lib/ad-payloads";
import { decryptSecret, encryptSecret, parseKey, secretHint } from "@/lib/secret-box";

import { audit } from "./auth";

/**
 * A store's server-side connections to ad platforms (wave 5 unit I2, D303, `docs/wave-5-marketing.md` 12.3): the only writer of
 * `commerce.ad_connections`. Tokens are encrypted with `SETTINGS_ENCRYPTION_KEY` and leave this module only to the platform's own sender;
 * a page sees the hint. Owner-only, checked by the actions; audited without the token.
 */

type Row = Record<string, unknown>;

const key = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

/** A connection as the settings page shows it: never the token. */
export type AdConnectionView = {
  platform: AdPlatform;
  accountId: string;
  tokenHint: string;
  dataLevel: "standard" | "enhanced";
  testCode: string | null;
  on: boolean;
};

export async function listAdConnections(storeId: string): Promise<AdConnectionView[]> {
  const rows = await db().execute<Row>(sql`
    select platform, account_id, token_hint, data_level, test_code, "on" from commerce.ad_connections where store_id = ${storeId}::uuid order by platform
  `);
  return rows.map((r) => ({
    platform: String(r.platform) as AdPlatform,
    accountId: String(r.account_id),
    tokenHint: String(r.token_hint),
    dataLevel: r.data_level === "enhanced" ? "enhanced" : "standard",
    testCode: r.test_code ? String(r.test_code) : null,
    on: Boolean(r.on),
  }));
}

export type AdConnectionInput = {
  platform: string;
  accountId: string;
  /** Empty keeps the token saved before. */
  token: string;
  dataLevel: string;
  testCode: string;
  on: boolean;
};

/** A refusal is a code the page words (`ads.problems`). */
export type AdConnectionProblem = "platform" | "account" | "token" | "no_key" | "need_token";
export type AdConnectionResult = { ok: true } | { ok: false; problem: AdConnectionProblem };

/** Saves one platform's connection; a token is required the first time, and kept when left empty later. */
export async function saveAdConnection(storeId: string, accountId: string, input: AdConnectionInput): Promise<AdConnectionResult> {
  const platform = AD_PLATFORMS.find((p) => p === input.platform);
  if (!platform) return { ok: false, problem: "platform" };
  const id = input.accountId.trim().toUpperCase().replace(/^(\d+)$/, "$1");
  if (!ACCOUNT_SHAPES[platform].test(id)) return { ok: false, problem: "account" };
  const token = input.token.trim();
  if (token.length > 0 && (token.length < 8 || token.length > 1000)) return { ok: false, problem: "token" };
  const level = input.dataLevel === "enhanced" ? "enhanced" : "standard";
  const testCode = input.testCode.trim().slice(0, 40) || null;
  const secretKey = key();
  if (token && !secretKey) return { ok: false, problem: "no_key" };
  const [existing] = await db().execute<Row>(sql`
    select 1 from commerce.ad_connections where store_id = ${storeId}::uuid and platform = ${platform}
  `);
  if (!existing && !token) return { ok: false, problem: "need_token" };
  if (existing) {
    await db().execute(sql`
      update commerce.ad_connections set account_id = ${id}, data_level = ${level}, test_code = ${testCode}, "on" = ${input.on},
        ${token ? sql`token = ${encryptSecret(token, secretKey!)}, token_hint = ${secretHint(token)},` : sql``} updated_at = now()
      where store_id = ${storeId}::uuid and platform = ${platform}
    `);
  } else {
    await db().execute(sql`
      insert into commerce.ad_connections (store_id, platform, account_id, token, token_hint, data_level, test_code, "on")
      values (${storeId}::uuid, ${platform}, ${id}, ${encryptSecret(token, secretKey!)}, ${secretHint(token)}, ${level}, ${testCode}, ${input.on})
    `);
  }
  await audit(accountId, storeId, "marketing.ad_connection_saved", { platform, dataLevel: level, on: input.on, tokenChanged: Boolean(token) });
  return { ok: true };
}

export async function removeAdConnection(storeId: string, accountId: string, platform: string): Promise<void> {
  const rows = await db().execute<Row>(sql`
    delete from commerce.ad_connections where store_id = ${storeId}::uuid and platform = ${platform} returning platform
  `);
  if (rows[0]) await audit(accountId, storeId, "marketing.ad_connection_removed", { platform });
}

/** The store's connections that are on, with their tokens, for the senders only. */
export async function liveConnections(storeId: string): Promise<{ platform: AdPlatform; accountId: string; token: string; testCode: string | null; dataLevel: string }[]> {
  const secretKey = key();
  if (!secretKey) return [];
  const rows = await db().execute<Row>(sql`
    select platform, account_id, token, test_code, data_level from commerce.ad_connections where store_id = ${storeId}::uuid and "on"
  `);
  const out = [];
  for (const r of rows) {
    try {
      out.push({
        platform: String(r.platform) as AdPlatform,
        accountId: String(r.account_id),
        token: decryptSecret(String(r.token), secretKey),
        testCode: r.test_code ? String(r.test_code) : null,
        dataLevel: String(r.data_level),
      });
    } catch {
      // A token the key cannot open (the key changed): the connection sends nothing until the owner pastes it again.
    }
  }
  return out;
}
