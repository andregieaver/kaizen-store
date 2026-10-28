import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { API_SCOPES, bearerToken, isApiScope, TOKEN_PREFIX, type ApiScope } from "@/lib/admin-api";

import { audit, passMembership, type Membership } from "./auth";
import { memberCan } from "./permissions";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * The Admin API's tokens (wave 9 unit B, D355): the only writer of `commerce.api_tokens`. A token is made by an owner for one store with the
 * scopes chosen, shown once and kept only as its SHA-256; it acts as the owner who made it, whose membership is read again on every call
 * (`passMembership()`), so a maker who is no longer an owner, a disabled account or a revoked token ends it at once.
 */

/** Most tokens a store keeps in use. */
export const TOKENS_MAX = 25;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export type ApiToken = { id: string; name: string; scopes: ApiScope[]; prefix: string; createdBy: string | null; lastUsedAt: string | null; createdAt: string };

const tokenRow = z.object({
  id: col.uuid,
  name: col.text,
  scopes: z.array(z.string()),
  prefix: col.text,
  created_by: col.uuid.nullable(),
  last_used_at: col.timestampOrNull,
  created_at: col.timestamp,
});

/** The store's tokens in use, newest first. */
export async function listApiTokens(storeId: string): Promise<ApiToken[]> {
  const rows = await typedRows(
    tokenRow,
    sql`
      select id, name, scopes, prefix, created_by, last_used_at, created_at from commerce.api_tokens
      where store_id = ${storeId}::uuid and revoked_at is null order by created_at desc, id
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    scopes: row.scopes.filter(isApiScope),
    prefix: row.prefix,
    createdBy: row.created_by,
    lastUsedAt: row.last_used_at,
    createdAt: row.created_at,
  }));
}

export type MakeOutcome = { ok: true; id: string; token: string } | { ok: false; problem: "name" | "scopes" | "limit" | "owner" };

/** Makes a token; answers it, shown once and never again. Owners only. */
export async function makeApiToken(member: Membership, input: { name: string; scopes: string[] }): Promise<MakeOutcome> {
  if (!memberCan(member, "owner")) return { ok: false, problem: "owner" };
  const name = input.name.replace(/\s+/g, " ").trim();
  if (name.length < 1 || name.length > 80) return { ok: false, problem: "name" };
  const scopes = API_SCOPES.filter((scope) => input.scopes.includes(scope));
  if (scopes.length === 0) return { ok: false, problem: "scopes" };
  const token = `${TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const id = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('api_tokens'), hashtext(${member.store.id}))`);
    const [count] = await tx.execute<{ n: number }>(sql`
      select count(*)::int as n from commerce.api_tokens where store_id = ${member.store.id}::uuid and revoked_at is null
    `);
    if (Number(count?.n ?? 0) >= TOKENS_MAX) return null;
    const [row] = await tx.execute<{ id: string }>(sql`
      insert into commerce.api_tokens (store_id, name, scopes, token_hash, prefix, created_by)
      values (${member.store.id}::uuid, ${name}, ${`{${scopes.join(",")}}`}::text[], ${hashToken(token)}, ${token.slice(0, 7)}, ${member.account.id}::uuid)
      returning id
    `);
    return String(row.id);
  });
  if (!id) return { ok: false, problem: "limit" };
  await audit(member.account.id, member.store.id, "integration.api_token_made", { scopes }, { target: { type: "api_token", id } });
  return { ok: true, id, token };
}

/** Revokes a token: every call with it is refused from now on. Owners only. */
export async function revokeApiToken(member: Membership, id: string): Promise<boolean> {
  if (!memberCan(member, "owner")) return false;
  const rows = await db().execute(sql`
    update commerce.api_tokens set revoked_at = now() where store_id = ${member.store.id}::uuid and id = ${id}::uuid and revoked_at is null returning id
  `);
  if (rows.length === 0) return false;
  await audit(member.account.id, member.store.id, "integration.api_token_revoked", {}, { target: { type: "api_token", id } });
  return true;
}

export type ApiCaller = { token: { id: string; name: string; scopes: ApiScope[] }; member: Membership };

/**
 * Who calls, from the request's `Authorization` header: the token in use, and its maker's membership as it is now, only while the maker is
 * still the store's owner. Null for anything else (a 401 that never says which).
 */
export async function apiCaller(header: string | null): Promise<ApiCaller | null> {
  const token = bearerToken(header);
  if (!token) return null;
  const row = await typedRow(
    z.object({ id: col.uuid, name: col.text, scopes: z.array(z.string()), created_by: col.uuid.nullable(), slug: col.text, stale: col.bool }),
    sql`
      select t.id, t.name, t.scopes, t.created_by, s.slug, (t.last_used_at is null or t.last_used_at < now() - interval '1 minute') as stale
      from commerce.api_tokens t join commerce.stores s on s.id = t.store_id
      where t.token_hash = ${hashToken(token)} and t.revoked_at is null and not (s.is_template or s.starter)
    `,
  );
  if (!row?.created_by) return null;
  const member = await passMembership(row.slug, row.created_by);
  if (!member || !memberCan(member, "owner")) return null;
  // Written at most once a minute, so a busy token does not write on every call.
  if (row.stale) await db().execute(sql`update commerce.api_tokens set last_used_at = now() where id = ${row.id}::uuid`);
  return { token: { id: row.id, name: row.name, scopes: row.scopes.filter(isApiScope) }, member };
}
