import "server-only";

import { createHmac, randomBytes, randomUUID } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { generateRecoveryCodes, normaliseRecoveryCode, RECOVERY_CODES_PER_SET, type RandomBytes } from "@/lib/recovery-codes";
import { parseKey } from "@/lib/secret-box";

type Row = Record<string, unknown>;

/**
 * An account's recovery codes (wave 1, 1f, docs/wave-1-trust.md 2.6, 4.5): made, hashed, checked and spent. The plaintext is shown
 * once and never kept; a code is stored as the HMAC-SHA256 of its normalised form, keyed from `SETTINGS_ENCRYPTION_KEY` (a key
 * derived for this purpose, so the settings key itself never touches a code), and is single use by one
 * `update … where used_at is null returning` that two requests cannot both win. A new set revokes the old.
 */

/** The key the codes are hashed under, derived from the settings key; null where the server has none (codes cannot then be made or checked). */
function hashKey(): Buffer | null {
  const base = parseKey(process.env.SETTINGS_ENCRYPTION_KEY);
  return base ? createHmac("sha256", base).update("kaizen.recovery-codes.v1").digest() : null;
}

/** The hash a normalised code is stored under (hex), or null where there is no key. */
export function recoveryHash(normalised: string): string | null {
  const key = hashKey();
  return key ? createHmac("sha256", key).update(normalised).digest("hex") : null;
}

export const recoveryAvailable = (): boolean => hashKey() !== null;

export type CodeSet = { ok: true; codes: string[]; batch: string } | { ok: false; problem: string };

/**
 * Makes a new set of ten codes for the account and revokes every unused code of an older set, in one transaction. The codes
 * come back as they are shown (`K7QM2-9WXDB`) and are not kept anywhere.
 */
export async function makeRecoveryCodes(accountId: string, random: RandomBytes = randomBytes): Promise<CodeSet> {
  if (!hashKey()) return { ok: false, problem: "Recovery codes cannot be made on this server: SETTINGS_ENCRYPTION_KEY is not set." };
  const shown = generateRecoveryCodes(random, RECOVERY_CODES_PER_SET);
  const batch = randomUUID();
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.account_recovery_codes set revoked_at = now()
      where account_id = ${accountId}::uuid and used_at is null and revoked_at is null
    `);
    for (const code of shown) {
      const hash = recoveryHash(normaliseRecoveryCode(code)!);
      await tx.execute(sql`
        insert into commerce.account_recovery_codes (account_id, batch, code_hash)
        values (${accountId}::uuid, ${batch}::uuid, ${hash})
      `);
    }
  });
  return { ok: true, codes: shown, batch };
}

/** Whether a code typed is one of the account's unused ones, without spending it. */
export async function recoveryCodeValid(accountId: string, typed: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(typed);
  const hash = normalised ? recoveryHash(normalised) : null;
  if (!hash) return false;
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.account_recovery_codes
    where account_id = ${accountId}::uuid and code_hash = ${hash} and used_at is null and revoked_at is null
  `);
  return Boolean(row);
}

/** Spends a code: true for the one request that wins it, false for a wrong, used or revoked code, or a second request racing the first. */
export async function claimRecoveryCode(accountId: string, typed: string): Promise<boolean> {
  const normalised = normaliseRecoveryCode(typed);
  const hash = normalised ? recoveryHash(normalised) : null;
  if (!hash) return false;
  const rows = await db().execute<Row>(sql`
    update commerce.account_recovery_codes set used_at = now()
    where account_id = ${accountId}::uuid and code_hash = ${hash} and used_at is null and revoked_at is null
    returning id
  `);
  return rows.length > 0;
}

/** Revokes every unused code of the account (their factor is gone, so the codes mean nothing); returns how many. */
export async function revokeRecoveryCodes(accountId: string): Promise<number> {
  const rows = await db().execute<Row>(sql`
    update commerce.account_recovery_codes set revoked_at = now()
    where account_id = ${accountId}::uuid and used_at is null and revoked_at is null
    returning id
  `);
  return rows.length;
}

/** How many codes the account can still use. */
export async function recoveryCodesLeft(accountId: string): Promise<number> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from commerce.account_recovery_codes
    where account_id = ${accountId}::uuid and used_at is null and revoked_at is null
  `);
  return Number(row?.n ?? 0);
}
