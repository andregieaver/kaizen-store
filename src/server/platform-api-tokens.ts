import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isPlatformApiScope, PLATFORM_API_SCOPES, PLATFORM_TOKEN_PREFIX, platformBearer, type PlatformApiScope } from "@/lib/platform-api";

import { audit, platformCan, type Account } from "./auth";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Kaizena Flow's own API's tokens (C4 step 4, D518): the only writer of `commerce.platform_api_tokens`, the stores' tokens (D355,
 * `api-tokens.ts`) for the platform. A token is made by a platform owner (the settings area, D510) with the scopes chosen, shown once and kept
 * only as its SHA-256; it reads as the owner who made it, whose account is read again on every call, so a maker who is no longer an owner of
 * the platform, a disabled account or a revoked token ends it at once.
 */

/** Most tokens the platform keeps in use. */
export const PLATFORM_TOKENS_MAX = 25;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export type PlatformApiToken = { id: string; name: string; scopes: PlatformApiScope[]; prefix: string; lastUsedAt: string | null; createdAt: string };

/** The tokens in use, newest first. */
export async function listPlatformTokens(): Promise<PlatformApiToken[]> {
  const rows = await typedRows(
    z.object({ id: col.uuid, name: col.text, scopes: z.array(z.string()), prefix: col.text, last_used_at: col.timestampOrNull, created_at: col.timestamp }),
    sql`select id, name, scopes, prefix, last_used_at, created_at from commerce.platform_api_tokens where revoked_at is null order by created_at desc, id`,
  );
  return rows.map((r) => ({ id: r.id, name: r.name, scopes: r.scopes.filter(isPlatformApiScope), prefix: r.prefix, lastUsedAt: r.last_used_at, createdAt: r.created_at }));
}

export type PlatformTokenOutcome = { ok: true; id: string; token: string } | { ok: false; problem: "name" | "scopes" | "limit" | "owner" };

/** Makes a token; answers it, shown once and never again. A platform owner's. */
export async function makePlatformToken(admin: Account, input: { name: string; scopes: string[] }): Promise<PlatformTokenOutcome> {
  if (!platformCan(admin, "settings")) return { ok: false, problem: "owner" };
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return { ok: false, problem: "name" };
  const scopes = PLATFORM_API_SCOPES.filter((scope) => input.scopes.includes(scope));
  if (scopes.length === 0) return { ok: false, problem: "scopes" };
  const token = `${PLATFORM_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('platform_api_tokens'))`);
    const [count] = await tx.execute<{ n: number }>(sql`select count(*)::int as n from commerce.platform_api_tokens where revoked_at is null`);
    if (Number(count?.n ?? 0) >= PLATFORM_TOKENS_MAX) return null;
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.platform_api_tokens (name, scopes, token_hash, prefix, created_by)
      values (${name}, array[${sql.join(scopes.map((s) => sql`${s}`), sql`, `)}]::text[], ${hash(token)}, ${token.slice(0, 8)}, ${admin.id}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (!id) return { ok: false, problem: "limit" };
  await audit(admin.id, null, "platform.api_token_made", { scopes }, { target: { type: "platform_api_token", id } });
  return { ok: true, id, token };
}

/** Revokes a token: every call with it is refused from now on. A platform owner's. */
export async function revokePlatformToken(admin: Account, id: string): Promise<boolean> {
  if (!platformCan(admin, "settings") || !/^[0-9a-f-]{36}$/i.test(id)) return false;
  const rows = await db().execute(sql`update commerce.platform_api_tokens set revoked_at = now() where id = ${id}::uuid and revoked_at is null returning id`);
  if (rows.length === 0) return false;
  await audit(admin.id, null, "platform.api_token_revoked", {}, { target: { type: "platform_api_token", id } });
  return true;
}

export type PlatformApiCaller = { token: { id: string; name: string; scopes: PlatformApiScope[] }; accountId: string };

/**
 * Who calls, from the request's `Authorization` header: the token in use, only while it is not revoked and its maker is still an owner of
 * the platform with an active account. Null for anything else (a 401 that never says which).
 */
export async function platformApiCaller(header: string | null): Promise<PlatformApiCaller | null> {
  const token = platformBearer(header);
  if (!token) return null;
  const row = await typedRow(
    z.object({ id: col.uuid, name: col.text, scopes: z.array(z.string()), created_by: col.uuid, stale: col.bool }),
    sql`
      select t.id, t.name, t.scopes, t.created_by, (t.last_used_at is null or t.last_used_at < now() - interval '1 minute') as stale
      from commerce.platform_api_tokens t join commerce.accounts a on a.id = t.created_by
      where t.token_hash = ${hash(token)} and t.revoked_at is null and a.platform_admin and a.disabled_at is null
    `,
  );
  if (!row) return null;
  // Written at most once a minute, so a busy token does not write on every call.
  if (row.stale) await db().execute(sql`update commerce.platform_api_tokens set last_used_at = now() where id = ${row.id}::uuid`);
  return { token: { id: row.id, name: row.name, scopes: row.scopes.filter(isPlatformApiScope) }, accountId: row.created_by };
}
