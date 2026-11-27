import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { encryptSecret } from "@/lib/secret-box";

import { audit } from "./auth";

/**
 * What the accounts whose tokens are renewed share (D870: Pinterest S3.4, TikTok S3.5, LinkedIn S3.6): their tables hold the same token
 * columns, so a renewal's new tokens, a refusal's words and a disconnect are written the same way. Only these tables are named here.
 */

export type TokenTable = "pinterest_accounts" | "tiktok_accounts" | "linkedin_accounts";

const table = (name: TokenTable) => sql`${sql.identifier("commerce")}.${sql.identifier(name)}`;

/** The renewed tokens, kept encrypted with their ends; the last problem cleared. */
export async function keepTokens(
  name: TokenTable,
  storeId: string,
  key: Buffer,
  tokens: { access: string; refresh: string | null; expiresAt: Date; refreshExpiresAt: Date | null },
): Promise<void> {
  await db().execute(sql`
    update ${table(name)} set access_token_encrypted = ${encryptSecret(tokens.access, key)},
      refresh_token_encrypted = ${tokens.refresh ? encryptSecret(tokens.refresh, key) : null}, token_expires_at = ${tokens.expiresAt.toISOString()}::timestamptz,
      refresh_expires_at = ${tokens.refreshExpiresAt?.toISOString() ?? null}::timestamptz, problem = null, updated_at = now()
    where store_id = ${storeId}::uuid`);
}

/** The platform's refusal kept as the connection's problem, in its words. */
export async function keepProblem(name: TokenTable, storeId: string, problem: string): Promise<void> {
  await db().execute(sql`update ${table(name)} set problem = ${problem.slice(0, 300)}, updated_at = now() where store_id = ${storeId}::uuid`);
}

/** Disconnects the store's account: the row and its tokens go, audited. The platform's own list of apps is the person's to tidy. */
export async function dropConnection(name: TokenTable, accountId: string, storeId: string, action: string): Promise<void> {
  const gone = await db().execute(sql`delete from ${table(name)} where store_id = ${storeId}::uuid returning id`);
  if (gone.length > 0) await audit(accountId, storeId, action, {});
}
