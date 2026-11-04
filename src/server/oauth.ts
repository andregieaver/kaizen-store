import "server-only";

import { createHash, randomBytes, randomUUID } from "node:crypto";

import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  clientHost,
  isAccessLevel,
  isOAuthScope,
  normaliseScopes,
  parseScopeParam,
  resourceOf,
  resourceUrl,
  safeClientName,
  type AccessLevel,
  type AuthorizeRequest,
  type OAuthResource,
  type OAuthScope,
} from "@/lib/oauth";
import { isApiPower } from "@/lib/admin-api";
import { missingPermissions, normaliseAppScopes } from "@/lib/apps";
import { permissionsOf } from "@/lib/permissions";
import { pkceMatches } from "@/lib/oauth-pkce";
import { siteUrl } from "@/lib/site";

import { syncInstallationEndpoint } from "./app-endpoints";
import { audit, holderOf, passMembership, type Account, type Membership } from "./auth";
import { log } from "./log";
import { clientByClientId, clientSecretMatches, expireGrantApprovals, markClientSeen, type OAuthClient } from "./oauth-clients";
import { memberCan } from "./permissions";
import { col, typedRow, typedRows, type Executor } from "./typed-rows";

/**
 * Kaizena Flow's OAuth 2.1 authorization server (wave 14 unit B, D439, `docs/wave-14-developer-platform.md` B4, B5): the only writer of
 * `commerce.oauth_grants` and `commerce.oauth_tokens`. A person's yes on the consent screen makes (or replaces) their grant to a client and
 * a code; the token endpoint swaps the code, with its PKCE verifier, for an access token bound to the grant's resource and a refresh token
 * rotated at every use. Every code and token is a CSPRNG string kept only as its SHA-256 and looked up by it; a code or refresh token used
 * twice ends its family. A token's power is decided at every call, not here (`oauthAccess()` and the MCP server).
 */

export const ACCESS_PREFIX = "kfa_";
export const REFRESH_PREFIX = "kfr_";
export const CODE_PREFIX = "kfc_";
/** A code lives a minute, an access token an hour, a refresh token 90 days from when it was made (a used one is replaced). */
export const CODE_SECONDS = 60;
export const ACCESS_SECONDS = 60 * 60;
export const REFRESH_DAYS = 90;

/** A token's SHA-256 (hex): all that is kept of it. */
export const tokenHash = (token: string): string => createHash("sha256").update(token).digest("hex");

/** A new secret of a kind: its prefix and 32 bytes from the CSPRNG, base64url. */
const newSecret = (prefix: string): string => `${prefix}${randomBytes(32).toString("base64url")}`;

/** Ids as a Postgres array, each its own parameter. */
const uuidArray = (values: readonly string[]) => (values.length === 0 ? sql`'{}'::uuid[]` : sql`array[${sql.join(values.map((v) => sql`${v}::uuid`), sql`, `)}]`);
const textArray = (values: readonly string[]) => (values.length === 0 ? sql`'{}'::text[]` : sql`array[${sql.join(values.map((v) => sql`${v}`), sql`, `)}]::text[]`);

// The consent (B4) -------------------------------------------------------------------------------------------------------------------

export type Approval = {
  account: Account;
  /** The second step the person's session stands at now: a store that requires it is reached only by a grant made at `aal2`. */
  aal: "aal1" | "aal2";
  client: OAuthClient;
  request: AuthorizeRequest;
  storeIds: string[];
  scopes: OAuthScope[];
  access: AccessLevel;
};

/**
 * The person said yes: their live grant to the client for the resource is made, or replaced with these stores, scopes and level, and a code
 * for the request's redirect URI and PKCE challenge is made. Each store's activity log says so (`oauth.approved`), with the client and scopes.
 */
export async function approveAuthorization(input: Approval): Promise<{ code: string; grantId: string }> {
  const scopes = normaliseScopes(input.scopes);
  if (input.storeIds.length === 0 || !isAccessLevel(input.access)) throw new Error("A grant needs a store and a level.");
  // A store whose owner cut this client off for this person stays out until an owner lets it in again (D439 review).
  const cut = new Set(await cutStoreIds(input.account.id, input.client.id));
  const storeIds = input.storeIds.filter((id) => !cut.has(id));
  if (storeIds.length === 0) throw new Error("Every store chosen has cut this client off.");
  const code = newSecret(CODE_PREFIX);
  const grantId = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('oauth_grants'), hashtext(${`${input.account.id}:${input.client.id}`}))`);
    const [kept] = await tx.execute<{ id: string }>(sql`
      update commerce.oauth_grants set store_ids = ${uuidArray(storeIds)}, scopes = ${textArray(scopes)}, access = ${input.access}, aal = ${input.aal}
      where account_id = ${input.account.id}::uuid and client_id = ${input.client.id}::uuid and resource = ${input.request.resource} and revoked_at is null
      returning id
    `);
    const id = kept
      ? String(kept.id)
      : String(
          (
            await tx.execute<{ id: string }>(sql`
              insert into commerce.oauth_grants (account_id, client_id, store_ids, scopes, resource, access, aal)
              values (${input.account.id}::uuid, ${input.client.id}::uuid, ${uuidArray(storeIds)}, ${textArray(scopes)}, ${input.request.resource}, ${input.access}, ${input.aal})
              returning id
            `)
          )[0].id,
        );
    await tx.execute(sql`
      insert into commerce.oauth_tokens (kind, token_hash, grant_id, family, code_challenge, redirect_uri, expires_at)
      values ('code', ${tokenHash(code)}, ${id}::uuid, ${randomUUID()}::uuid, ${input.request.codeChallenge}, ${input.request.redirectUri},
        now() + make_interval(secs => ${CODE_SECONDS}))
    `);
    // A store the replaced grant reached and this one does not: what was asked for there through it waits no more.
    await expireGrantApprovals(tx, sql`oauth_grant_id = ${id}::uuid and not (store_id = any(${uuidArray(storeIds)}))`);
    return id;
  });
  for (const storeId of storeIds) {
    await audit(input.account.id, storeId, "oauth.approved", { client: input.client.name, client_id: input.client.clientId, scopes, access: input.access, stores: storeIds.length }, {
      target: { type: "oauth_grant", id: grantId },
    });
  }
  return { code, grantId };
}

/**
 * A person installs an app on one store (D441): the app's live installation there, whoever made it, ends with every token, and a new one is
 * made as this person's, with the app's scopes (given whole: the consent screen offers only stores where the person may give them all),
 * `access = 'change'` (gated tools still wait for a yes) and a code for the request. The store's log says so (`oauth.app_installed`).
 */
export async function approveInstallation(input: Omit<Approval, "storeIds" | "scopes" | "access"> & { storeId: string; scopes: readonly string[] }): Promise<{ code: string; grantId: string }> {
  const scopes = normaliseAppScopes(input.scopes);
  if (input.client.kind !== "app" || input.request.resource !== "admin") throw new Error("Only an app is installed.");
  const code = newSecret(CODE_PREFIX);
  const grantId = await db().transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('oauth_installations'), hashtext(${`${input.client.id}:${input.storeId}`}))`);
    const ended = await tx.execute<{ id: string }>(sql`
      update commerce.oauth_grants set revoked_at = now()
      where client_id = ${input.client.id}::uuid and store_id = ${input.storeId}::uuid and resource = 'admin' and revoked_at is null
      returning id
    `);
    for (const old of ended) {
      await tx.execute(sql`update commerce.oauth_tokens set revoked_at = coalesce(revoked_at, now()) where grant_id = ${old.id}::uuid`);
      await expireGrantApprovals(tx, sql`oauth_grant_id = ${old.id}::uuid`);
    }
    const [made] = await tx.execute<{ id: string }>(sql`
      insert into commerce.oauth_grants (account_id, client_id, store_ids, store_id, scopes, resource, access, aal)
      values (${input.account.id}::uuid, ${input.client.id}::uuid, array[${input.storeId}::uuid], ${input.storeId}::uuid, ${textArray(scopes)}, 'admin', 'change', ${input.aal})
      returning id
    `);
    // Installing again is not removing (D2): the old installation's endpoint, with its deliveries, becomes the new one's, so ending the
    // old one at the end of this transaction sends neither app.uninstalled nor store.erase_requested.
    if (ended.length > 0) {
      await tx.execute(sql`
        update commerce.webhook_endpoints set app_grant_id = ${made.id}::uuid
        where app_grant_id in (${sql.join(
          ended.map((old) => sql`${old.id}::uuid`),
          sql`, `,
        )})
      `);
    }
    // Installed again within 48 hours of being removed: the store's data is not to be erased after all.
    await tx.execute(sql`
      update commerce.integration_deliveries set status = 'failed', last_error = 'Installed again'
      where status = 'pending' and event = 'store.erase_requested' and endpoint_id in (
        select e.id from commerce.webhook_endpoints e join commerce.oauth_grants g on g.id = e.app_grant_id
        where g.client_id = ${input.client.id}::uuid and g.store_id = ${input.storeId}::uuid
      )
    `);
    await syncInstallationEndpoint(tx, String(made.id));
    await tx.execute(sql`
      insert into commerce.oauth_tokens (kind, token_hash, grant_id, family, code_challenge, redirect_uri, expires_at)
      values ('code', ${tokenHash(code)}, ${made.id}::uuid, ${randomUUID()}::uuid, ${input.request.codeChallenge}, ${input.request.redirectUri},
        now() + make_interval(secs => ${CODE_SECONDS}))
    `);
    return String(made.id);
  });
  await audit(input.account.id, input.storeId, "oauth.app_installed", { app: input.client.name, client_id: input.client.clientId, scopes }, { target: { type: "oauth_grant", id: grantId } });
  return { code, grantId };
}

/** The person said no: written in their account's log, with the client (`oauth.denied`). */
export async function denyAuthorization(account: Account, client: OAuthClient, scopes: readonly string[]): Promise<void> {
  await audit(account.id, null, "oauth.denied", { client: client.name, client_id: client.clientId, scopes }, { area: "account", target: { type: "oauth_client", id: client.id } });
}

// The token endpoint (B5) ------------------------------------------------------------------------------------------------------------

export type TokenAnswer =
  | { ok: true; body: { access_token: string; token_type: "Bearer"; expires_in: number; refresh_token: string; scope: string } }
  | { ok: false; status: 400 | 401 | 429; error: string; description: string; basic?: boolean };

const refuse = (error: string, description: string, status: 400 | 401 = 400, basic = false): TokenAnswer => ({ ok: false, status, error, description, basic });

/**
 * Charges one request to its client's own budget (`oauth_token`, the route's `chargeClient()`) and says whether there was room. Called only
 * once a request has proved itself (D439 review): a confidential client's secret checked, or a public client's code (with its verifier,
 * redirect URI and resource) or refresh token found good. Anyone can send claude.ai's `client_id`, so a request that proves nothing is
 * charged only to its address (`oauth`) and can never use up a client's budget. Callers that count nothing (tests) leave it out.
 */
export type ClientCharge = (clientId: string) => Promise<boolean>;
const uncounted: ClientCharge = async () => true;

const overClient = (): TokenAnswer => ({ ok: false, status: 429, error: "slow_down", description: "Too many requests for this client: try again in a minute." });

/**
 * Who calls the token or revocation endpoint: a confidential client by `client_secret_basic` (its id and secret in the `Authorization`
 * header, the secret compared in constant time), or a public client by `client_id` alone, which PKCE then holds. A confidential client
 * without its secret, a public one sending one, a blocked or unknown client: `invalid_client`.
 */
export async function authenticateClient(form: URLSearchParams, authorization: string | null): Promise<{ ok: true; client: OAuthClient } | { ok: false; basic: boolean }> {
  const basic = authorization?.match(/^Basic\s+([A-Za-z0-9+/=._~-]+)$/i)?.[1];
  if (basic) {
    let id = "";
    let secret = "";
    try {
      const decoded = Buffer.from(basic, "base64").toString("utf8");
      const at = decoded.indexOf(":");
      if (at < 0) return { ok: false, basic: true };
      id = decodeURIComponent(decoded.slice(0, at));
      secret = decodeURIComponent(decoded.slice(at + 1));
    } catch {
      return { ok: false, basic: true };
    }
    const formId = form.get("client_id");
    if (formId !== null && formId !== id) return { ok: false, basic: true };
    const client = await clientByClientId(id);
    if (!client || client.blocked || !client.confidential || !(await clientSecretMatches(client.id, secret))) return { ok: false, basic: true };
    return { ok: true, client };
  }
  if (form.has("client_secret")) return { ok: false, basic: false };
  const id = form.get("client_id");
  if (!id || form.getAll("client_id").length !== 1) return { ok: false, basic: false };
  const client = await clientByClientId(id);
  if (!client || client.blocked || client.confidential) return { ok: false, basic: false };
  return { ok: true, client };
}

const codeRow = z.object({
  id: col.uuid,
  kind: col.text,
  grant_id: col.uuid,
  family: col.uuid,
  code_challenge: col.textOrNull,
  redirect_uri: col.textOrNull,
  live: col.bool,
  used: col.bool,
  client_row: col.uuid,
  account_id: col.uuid,
  scopes: z.array(z.string()),
  resource: col.text,
  grant_live: col.bool,
});

/** Ends a family: every code and token made from one code (theft detection, B5). */
async function endFamily(executor: Executor, family: string): Promise<void> {
  await executor.execute(sql`update commerce.oauth_tokens set revoked_at = coalesce(revoked_at, now()) where family = ${family}::uuid`);
}

/**
 * A new access and refresh token of a grant's family. `accessScopes`: the access token's own scopes, when a refresh asked for fewer than the
 * grant holds (RFC 6749 6); the refresh token always carries the grant's, so a later refresh can ask for them again.
 */
async function issueTokens(executor: Executor, grantId: string, family: string, accessScopes: readonly string[] | null = null) {
  const access = newSecret(ACCESS_PREFIX);
  const refresh = newSecret(REFRESH_PREFIX);
  await executor.execute(sql`
    insert into commerce.oauth_tokens (kind, token_hash, grant_id, family, scopes, expires_at) values
      ('access', ${tokenHash(access)}, ${grantId}::uuid, ${family}::uuid, ${accessScopes ? textArray(accessScopes) : sql`null`}, now() + make_interval(secs => ${ACCESS_SECONDS})),
      ('refresh', ${tokenHash(refresh)}, ${grantId}::uuid, ${family}::uuid, null, now() + make_interval(days => ${REFRESH_DAYS}))
  `);
  return { access, refresh };
}

/**
 * Locks the grant behind a code or token before the code or token itself (D439 review): every writer takes a grant's row first and its
 * tokens after (`endGrant()`, a block, a cut), so two of them never wait on each other. The grant's id, or null for an unknown hash.
 */
async function lockGrantOf(executor: Executor, hash: string, kind: "code" | "refresh"): Promise<string | null> {
  const found = await typedRow(z.object({ grant_id: col.uuid }), sql`select grant_id from commerce.oauth_tokens where token_hash = ${hash} and kind = ${kind}`, executor);
  if (!found) return null;
  await executor.execute(sql`select id from commerce.oauth_grants where id = ${found.grant_id}::uuid for no key update`);
  return found.grant_id;
}

/** The `resource` a token request names, when it names one: it must be the grant's (RFC 8707), never another. */
function resourceProblem(form: URLSearchParams, grantResource: string): TokenAnswer | null {
  const asked = form.getAll("resource");
  if (asked.length === 0) return null;
  if (asked.length > 1) return refuse("invalid_target", "Name one resource.");
  const resource = resourceOf(asked[0], siteUrl());
  return resource === grantResource ? null : refuse("invalid_target", `This grant's tokens are for ${resourceUrl(siteUrl(), grantResource as OAuthResource)} only.`);
}

/** Reads a token request's form, one parameter each (RFC 6749 3.2: none may repeat). */
function single(form: URLSearchParams, key: string): string | null {
  const values = form.getAll(key);
  return values.length === 1 ? values[0] : null;
}

/** The token endpoint (RFC 6749 3.2, OAuth 2.1): `authorization_code` with PKCE, and `refresh_token` with rotation. */
export async function tokenRequest(form: URLSearchParams, authorization: string | null, charge: ClientCharge = uncounted): Promise<TokenAnswer> {
  const who = await authenticateClient(form, authorization);
  if (!who.ok) return refuse("invalid_client", "The client could not be authenticated.", 401, who.basic);
  // A confidential client proved itself with its secret: charged now, once. A public one is charged when its code or refresh token is good.
  if (who.client.confidential && !(await charge(who.client.clientId))) return overClient();
  const chargeGood = who.client.confidential ? uncounted : charge;
  const grantType = single(form, "grant_type");
  const answer =
    grantType === "authorization_code"
      ? await exchangeCode(form, who.client, chargeGood)
      : grantType === "refresh_token"
        ? await refreshTokens(form, who.client, chargeGood)
        : refuse("unsupported_grant_type", "grant_type is authorization_code or refresh_token.");
  if (answer.ok) await markClientSeen(who.client.id);
  return answer;
}

/**
 * Swaps a code: checked first without being used, then, once it is known good, charged to its client (`charge`) and checked again and used
 * in one transaction (the budget is never counted while a transaction holds a connection). A code over its client's budget stays unused,
 * so the client can try again within its minute.
 */
async function exchangeCode(form: URLSearchParams, client: OAuthClient, charge: ClientCharge): Promise<TokenAnswer> {
  const code = single(form, "code");
  const verifier = single(form, "code_verifier");
  const redirectUri = single(form, "redirect_uri");
  if (!code || !code.startsWith(CODE_PREFIX) || code.length > 200) return refuse("invalid_grant", "The code is not valid.");
  if (!verifier) return refuse("invalid_request", "code_verifier is required (PKCE).");
  if (!redirectUri) return refuse("invalid_request", "redirect_uri is required.");
  const checked = await exchangePass(form, client, code, verifier, redirectUri, false);
  if (checked) return checked;
  if (!(await charge(client.clientId))) return overClient();
  return (await exchangePass(form, client, code, verifier, redirectUri, true)) ?? refuse("invalid_grant", "The code is not valid.");
}

/** One pass over a code: a refusal, or, when `use` is false and it is good, null; when `use` is true and it is good, the tokens. */
async function exchangePass(form: URLSearchParams, client: OAuthClient, code: string, verifier: string, redirectUri: string, use: boolean): Promise<TokenAnswer | null> {
  return db().transaction(async (tx) => {
    if (!(await lockGrantOf(tx, tokenHash(code), "code"))) return refuse("invalid_grant", "The code is not valid.");
    const row = await typedRow(
      codeRow,
      sql`
        select t.id, t.kind, t.grant_id, t.family, t.code_challenge, t.redirect_uri, (t.revoked_at is null and t.expires_at > now()) as live,
          t.used_at is not null as used, g.client_id as client_row, g.account_id, g.scopes, g.resource, g.revoked_at is null as grant_live
        from commerce.oauth_tokens t join commerce.oauth_grants g on g.id = t.grant_id
        where t.token_hash = ${tokenHash(code)} and t.kind = 'code'
        for update of t
      `,
      tx,
    );
    if (!row) return refuse("invalid_grant", "The code is not valid.");
    // Another client holding someone's code gets nothing, and the code stays for its own client (B8: code interception).
    if (row.client_row !== client.id) return refuse("invalid_grant", "The code is not valid.");
    if (row.used) {
      // A code used twice: everything made from it ends (OAuth 2.1 4.1.3).
      await endFamily(tx, row.family);
      log("warn", "oauth.code_reused", { grantId: row.grant_id });
      return refuse("invalid_grant", "The code was already used.");
    }
    if (!row.live || !row.grant_live) return refuse("invalid_grant", "The code has expired.");
    if (redirectUri !== row.redirect_uri) return refuse("invalid_grant", "redirect_uri is not the one the code was given for.");
    if (!pkceMatches(verifier, row.code_challenge)) return refuse("invalid_grant", "The code_verifier does not match the code_challenge.");
    const target = resourceProblem(form, row.resource);
    if (target) return target;
    if (!use) return null;
    await tx.execute(sql`update commerce.oauth_tokens set used_at = now() where id = ${row.id}::uuid`);
    const tokens = await issueTokens(tx, row.grant_id, row.family);
    await tx.execute(sql`update commerce.oauth_grants set last_used_at = now() where id = ${row.grant_id}::uuid`);
    return {
      ok: true as const,
      body: { access_token: tokens.access, token_type: "Bearer" as const, expires_in: ACCESS_SECONDS, refresh_token: tokens.refresh, scope: row.scopes.join(" ") },
    };
  });
}

/**
 * Refreshes: the refresh token checked first without being used, then, once it is known good, charged to its client (`charge`) and checked
 * again and rotated in one transaction, as a code is (`exchangeCode()`).
 */
async function refreshTokens(form: URLSearchParams, client: OAuthClient, charge: ClientCharge): Promise<TokenAnswer> {
  const refresh = single(form, "refresh_token");
  if (!refresh || !refresh.startsWith(REFRESH_PREFIX) || refresh.length > 200) return refuse("invalid_grant", "The refresh token is not valid.");
  const checked = await refreshPass(form, client, refresh, false);
  if (checked) return checked;
  if (!(await charge(client.clientId))) return overClient();
  return (await refreshPass(form, client, refresh, true)) ?? refuse("invalid_grant", "The refresh token is not valid.");
}

/** One pass over a refresh token: a refusal, or, when `use` is false and it is good, null; when `use` is true and it is good, the tokens. */
async function refreshPass(form: URLSearchParams, client: OAuthClient, refresh: string, use: boolean): Promise<TokenAnswer | null> {
  const outcome = await db().transaction(async (tx): Promise<{ answer: TokenAnswer | null; reused?: z.output<typeof codeRow> }> => {
    if (!(await lockGrantOf(tx, tokenHash(refresh), "refresh"))) return { answer: refuse("invalid_grant", "The refresh token is not valid.") };
    const row = await typedRow(
      codeRow,
      sql`
        select t.id, t.kind, t.grant_id, t.family, t.code_challenge, t.redirect_uri, (t.revoked_at is null and t.expires_at > now()) as live,
          t.used_at is not null as used, g.client_id as client_row, g.account_id, g.scopes, g.resource, g.revoked_at is null as grant_live
        from commerce.oauth_tokens t join commerce.oauth_grants g on g.id = t.grant_id
        where t.token_hash = ${tokenHash(refresh)} and t.kind = 'refresh'
        for update of t
      `,
      tx,
    );
    if (!row || row.client_row !== client.id) return { answer: refuse("invalid_grant", "The refresh token is not valid.") };
    if (row.used) {
      // An old refresh token used again: someone holds a copy. The whole family ends, the thief's and the client's (B5).
      await endFamily(tx, row.family);
      return { answer: refuse("invalid_grant", "The refresh token was already used."), reused: row };
    }
    if (!row.live || !row.grant_live) return { answer: refuse("invalid_grant", "The refresh token has expired or was revoked.") };
    const target = resourceProblem(form, row.resource);
    if (target) return { answer: target };
    // A refresh may ask for fewer scopes than the grant holds, never more (RFC 6749 6): the new access token holds what it asked for.
    const asked = form.getAll("scope");
    if (asked.length > 1) return { answer: refuse("invalid_request", "Name the scopes once.") };
    let narrowed: OAuthScope[] | null = null;
    if (asked.length === 1) {
      const { scopes, unknown } = parseScopeParam(asked[0]);
      if (unknown.length > 0 || scopes.some((scope) => !row.scopes.includes(scope))) return { answer: refuse("invalid_scope", "A refresh cannot add scopes the grant does not hold.") };
      const wanted = normaliseScopes(scopes);
      narrowed = wanted.length < row.scopes.length ? wanted : null;
    }
    if (!use) return { answer: null };
    await tx.execute(sql`update commerce.oauth_tokens set used_at = now() where id = ${row.id}::uuid`);
    const tokens = await issueTokens(tx, row.grant_id, row.family, narrowed);
    await tx.execute(sql`update commerce.oauth_grants set last_used_at = now() where id = ${row.grant_id}::uuid`);
    return {
      answer: {
        ok: true as const,
        body: { access_token: tokens.access, token_type: "Bearer" as const, expires_in: ACCESS_SECONDS, refresh_token: tokens.refresh, scope: (narrowed ?? row.scopes).join(" ") },
      },
    };
  });
  if (outcome.reused) {
    log("warn", "oauth.refresh_reused", { grantId: outcome.reused.grant_id });
    await audit(outcome.reused.account_id, null, "oauth.refresh_reused", { client: client.name, client_id: client.clientId }, { area: "account", target: { type: "oauth_grant", id: outcome.reused.grant_id } });
  }
  return outcome.answer;
}

/**
 * Revocation (RFC 7009): a client's access or refresh token, by the client that holds it, ends its grant at once, with every token of it.
 * Answers alike whether or not the token was found, so nothing can be learned by trying; another client's token is left alone.
 */
export async function revokeRequest(
  form: URLSearchParams,
  authorization: string | null,
  charge: ClientCharge = uncounted,
): Promise<{ ok: true } | { ok: false; basic: boolean } | { ok: false; slow: true }> {
  const who = await authenticateClient(form, authorization);
  if (!who.ok) return who;
  // Charged to the client only once the request proved itself: a confidential client's secret now, a public client's token when found below.
  if (who.client.confidential && !(await charge(who.client.clientId))) return { ok: false, slow: true };
  const token = single(form, "token");
  if (!token || token.length > 200 || !(token.startsWith(ACCESS_PREFIX) || token.startsWith(REFRESH_PREFIX))) return { ok: true };
  const row = await typedRow(
    z.object({ grant_id: col.uuid, account_id: col.uuid, client_row: col.uuid }),
    sql`
      select t.grant_id, g.account_id, g.client_id as client_row from commerce.oauth_tokens t join commerce.oauth_grants g on g.id = t.grant_id
      where t.token_hash = ${tokenHash(token)} and t.kind in ('access', 'refresh') and g.revoked_at is null
    `,
  );
  if (!row || row.client_row !== who.client.id) return { ok: true };
  if (!who.client.confidential && !(await charge(who.client.clientId))) return { ok: false, slow: true };
  if (await endGrant(row.grant_id)) {
    await audit(row.account_id, null, "oauth.revoked", { client: who.client.name, client_id: who.client.clientId }, { area: "account", target: { type: "oauth_grant", id: row.grant_id } });
  }
  return { ok: true };
}

/**
 * Ends a grant and every code and token of it, and what it asked for that still waits for a yes; whether it was live. The grant's row is
 * taken first and its tokens after, as every writer does (`lockGrantOf()`).
 */
async function endGrant(grantId: string, where: SQL = sql`true`): Promise<boolean> {
  return db().transaction(async (tx) => {
    const rows = await tx.execute(sql`update commerce.oauth_grants set revoked_at = now() where id = ${grantId}::uuid and revoked_at is null and ${where} returning id`);
    if (rows.length === 0) return false;
    await tx.execute(sql`update commerce.oauth_tokens set revoked_at = coalesce(revoked_at, now()) where grant_id = ${grantId}::uuid`);
    await expireGrantApprovals(tx, sql`oauth_grant_id = ${grantId}::uuid`);
    return true;
  });
}

/**
 * Every live grant of a person ends (D439 review): their password was set or changed, or their second step was reset or removed, so
 * what they let apps do before is asked again. Each in their account's log (`oauth.ended`, with why); the number ended.
 */
export async function endAccountGrants(accountId: string, why: "password" | "two_step"): Promise<number> {
  const grants = await typedRows(
    z.object({ id: col.uuid, name: col.text }),
    sql`select g.id, c.name from commerce.oauth_grants g join commerce.oauth_clients c on c.id = g.client_id where g.account_id = ${accountId}::uuid and g.revoked_at is null`,
  );
  let ended = 0;
  for (const grant of grants) {
    if (!(await endGrant(grant.id))) continue;
    ended++;
    await audit(accountId, null, "oauth.ended", { client: safeClientName(grant.name), why }, { area: "account", target: { type: "oauth_grant", id: grant.id } });
  }
  return ended;
}

// A call with an access token (B6) ---------------------------------------------------------------------------------------------------

/** What an access token is, while it is live: its grant, its client and person, and the scopes and stores the grant holds. */
export type OAuthAccess = {
  grantId: string;
  accountId: string;
  client: { id: string; clientId: string; name: string; verified: boolean; kind: "metadata_document" | "registered" | "preregistered" | "app" };
  /** The grant's own resource: `admin` for an app's installation (D441), whose `storeIds` is its one store. */
  resource: "mcp" | "admin";
  storeIds: string[];
  scopes: string[];
  access: AccessLevel;
  aal: "aal1" | "aal2";
};

const accessRow = z.object({
  grant_id: col.uuid,
  resource: z.enum(["mcp", "admin"]),
  kind: z.enum(["metadata_document", "registered", "preregistered", "app"]),
  account_id: col.uuid,
  client_row: col.uuid,
  client_id: col.text,
  name: col.text,
  verified: col.bool,
  store_ids: z.array(col.uuid),
  scopes: z.array(z.string()),
  token_scopes: z.array(z.string()).nullable(),
  access: z.enum(["read", "propose", "change"]),
  aal: z.enum(["aal1", "aal2"]),
  stale: col.bool,
});

/**
 * The grant behind an access token presented at a resource, or null: one of ours (`kfa_`), found by its hash, not expired or revoked, its
 * grant live and for this very resource (its audience), its client not blocked. Nothing about the token is believed beyond its hash.
 */
export async function oauthAccess(token: string, resource: OAuthResource): Promise<OAuthAccess | null> {
  if (!token.startsWith(ACCESS_PREFIX) || token.length > 200) return null;
  const row = await typedRow(
    accessRow,
    sql`
      select g.id as grant_id, g.resource, c.kind, g.account_id, c.id as client_row, c.client_id, c.name, c.verified,
        array(select s from unnest(g.store_ids) s where not exists (
          select 1 from commerce.oauth_store_cutoffs x where x.store_id = s and x.account_id = g.account_id and x.client_id = g.client_id
        )) as store_ids,
        g.scopes, t.scopes as token_scopes, g.access, g.aal,
        (g.last_used_at is null or g.last_used_at < now() - interval '1 minute') as stale
      from commerce.oauth_tokens t
      join commerce.oauth_grants g on g.id = t.grant_id
      join commerce.oauth_clients c on c.id = g.client_id
      where t.token_hash = ${tokenHash(token)} and t.kind = 'access' and t.revoked_at is null and t.expires_at > now()
        and g.revoked_at is null and c.blocked_at is null
        -- Bound to its resource; an app's installation is taken by the MCP too (D441).
        and (g.resource = ${resource} or (${resource} = 'mcp' and g.resource = 'admin' and c.kind = 'app'))
    `,
  );
  if (!row) return null;
  // Written at most once a minute, so a busy client does not write on every call.
  if (row.stale) {
    await db().execute(sql`update commerce.oauth_grants set last_used_at = now() where id = ${row.grant_id}::uuid`);
    await markClientSeen(row.client_row);
  }
  return {
    grantId: row.grant_id,
    accountId: row.account_id,
    client: { id: row.client_row, clientId: row.client_id, name: safeClientName(row.name), verified: row.verified, kind: row.kind },
    resource: row.resource,
    // A store an owner cut off is never reached, whatever the grant says (D439 review).
    storeIds: row.store_ids,
    // A token a narrowed refresh made holds its own scopes, never more than its grant's now.
    // An app's installation also holds the Admin API's powers it was given (D441).
    scopes: row.scopes.filter((scope) => (isOAuthScope(scope) || (row.resource === "admin" && isApiPower(scope))) && (!row.token_scopes || row.token_scopes.includes(scope))),
    access: row.access,
    aal: row.aal,
  };
}

// The screens (B7) -------------------------------------------------------------------------------------------------------------------

export type GrantView = {
  id: string;
  /** `admin`: an app's installation on one store (D441); `mcp`: an AI assistant's connection. */
  resource: "mcp" | "admin";
  client: { id: string; name: string; host: string; verified: boolean; logoUrl: string | null };
  stores: { id: string; slug: string; name: string }[];
  scopes: string[];
  access: AccessLevel;
  createdAt: string;
  lastUsedAt: string | null;
  person: { id: string; name: string | null; email: string };
};

const grantRow = z.object({
  id: col.uuid,
  resource: z.enum(["mcp", "admin"]),
  client_row: col.uuid,
  client_name: col.text,
  client_id: col.text,
  client_uri: col.textOrNull,
  redirect_uris: z.array(z.string()),
  verified: col.bool,
  logo_url: col.textOrNull,
  stores: z.array(z.object({ id: col.uuid, slug: col.text, name: col.text })),
  scopes: z.array(z.string()),
  access: z.enum(["read", "propose", "change"]),
  created_at: col.timestamp,
  last_used_at: col.timestampOrNull,
  account_id: col.uuid,
  person_name: col.textOrNull,
  email: col.text,
});

async function grantViews(where: SQL): Promise<GrantView[]> {
  const rows = await typedRows(
    grantRow,
    sql`
      select g.id, g.resource, c.id as client_row, c.name as client_name, c.client_id, c.client_uri, c.redirect_uris, c.verified, c.logo_url,
        coalesce((select jsonb_agg(jsonb_build_object('id', s.id, 'slug', s.slug, 'name', s.name) order by s.name)
          from commerce.stores s where s.id = any(g.store_ids)), '[]'::jsonb) as stores,
        g.scopes, g.access, g.created_at, g.last_used_at, g.account_id, a.name as person_name, a.email
      from commerce.oauth_grants g
      join commerce.oauth_clients c on c.id = g.client_id
      join commerce.accounts a on a.id = g.account_id
      where g.revoked_at is null and c.blocked_at is null and ${where}
      order by coalesce(g.last_used_at, g.created_at) desc, g.id
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    resource: row.resource,
    client: {
      id: row.client_row,
      name: safeClientName(row.client_name),
      host: clientHost({ clientId: row.client_id, clientUri: row.client_uri, redirectUris: row.redirect_uris }),
      verified: row.verified,
      logoUrl: row.logo_url,
    },
    stores: row.stores,
    scopes: row.scopes,
    access: row.access,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    person: { id: row.account_id, name: row.person_name, email: row.email },
  }));
}

/** Account → Connected apps and assistants: the person's own live grants. */
export const grantsOfAccount = (accountId: string): Promise<GrantView[]> => grantViews(sql`g.account_id = ${accountId}::uuid`);

/** Store → Apps and API: every live grant that reaches the store, whoever made it. */
export const grantsReachingStore = (storeId: string): Promise<GrantView[]> => grantViews(sql`${storeId}::uuid = any(g.store_ids)`);

/** *Disconnect* on the person's own screen: their grant ends at once, with every token. */
export async function disconnectGrant(account: Account, grantId: string): Promise<boolean> {
  if (!z.uuid().safeParse(grantId).success) return false;
  const [grant] = await grantViews(sql`g.id = ${grantId}::uuid and g.account_id = ${account.id}::uuid`);
  if (!grant || !(await endGrant(grantId, sql`account_id = ${account.id}::uuid`))) return false;
  await audit(account.id, null, "oauth.disconnected", { client: grant.client.name, stores: grant.stores.length }, { area: "account", target: { type: "oauth_grant", id: grantId } });
  return true;
}

/**
 * The store's owner cuts a grant off from their store, whoever made it: the store leaves the grant at once, what it asked for there stops
 * waiting, and a grant left with no store ends. The cut stays (`oauth_store_cutoffs`): the person approving the client again does not
 * bring the store back until an owner lets it in again (`liftStoreCutoff()`). Owners only.
 */
export async function cutGrantFromStore(member: Membership, grantId: string): Promise<boolean> {
  if (!memberCan(member, "owner") || !z.uuid().safeParse(grantId).success) return false;
  const [grant] = await grantViews(sql`g.id = ${grantId}::uuid and ${member.store.id}::uuid = any(g.store_ids)`);
  if (!grant) return false;
  const left = await db().transaction(async (tx) => {
    const [row] = await tx.execute<{ n: number }>(sql`
      update commerce.oauth_grants set store_ids = array_remove(store_ids, ${member.store.id}::uuid)
      where id = ${grantId}::uuid and revoked_at is null and resource = 'mcp' and ${member.store.id}::uuid = any(store_ids)
      returning cardinality(store_ids) as n
    `);
    if (!row) return null;
    await tx.execute(sql`
      insert into commerce.oauth_store_cutoffs (store_id, account_id, client_id, cut_by)
      values (${member.store.id}::uuid, ${grant.person.id}::uuid, ${grant.client.id}::uuid, ${member.account.id}::uuid)
      on conflict (store_id, account_id, client_id) do nothing
    `);
    await expireGrantApprovals(tx, sql`oauth_grant_id = ${grantId}::uuid and store_id = ${member.store.id}::uuid`);
    return Number(row.n);
  });
  if (left === null) return false;
  if (left === 0) await endGrant(grantId);
  await audit(member.account.id, member.store.id, "oauth.store_cut", { client: grant.client.name, made_by: grant.person.id }, { target: { type: "oauth_grant", id: grantId } });
  return true;
}

/**
 * An owner removes an app from their store (D441): its installation there ends at once with every token, whoever installed it, and the
 * store's log says so (`oauth.app_removed`). Installing it again is a new consent. Owners only.
 */
export async function removeInstallation(member: Membership, grantId: string): Promise<boolean> {
  if (!memberCan(member, "owner") || !z.uuid().safeParse(grantId).success) return false;
  const [grant] = await grantViews(sql`g.id = ${grantId}::uuid and g.resource = 'admin' and g.store_id = ${member.store.id}::uuid`);
  if (!grant || !(await endGrant(grantId, sql`resource = 'admin' and store_id = ${member.store.id}::uuid`))) return false;
  await audit(member.account.id, member.store.id, "oauth.app_removed", { app: grant.client.name, installed_by: grant.person.id }, { target: { type: "oauth_grant", id: grantId } });
  return true;
}

/**
 * What each live installation on a store is now asked for beyond what it holds (D441 D2): its app asked for more since it was installed
 * (an installation keeps its own scopes until the store approves the new list). By installation (grant) id; installations asked for nothing
 * more are left out.
 */
export async function installationAsks(store: { id: string; slug: string }): Promise<Map<string, { more: string[]; installerCan: boolean }>> {
  const rows = await typedRows(
    z.object({ id: col.uuid, account_id: col.uuid, held: z.array(z.string()), asked: z.array(z.string()) }),
    sql`
      select g.id, g.account_id, g.scopes as held, a.scopes as asked
      from commerce.oauth_grants g join commerce.apps a on a.client_id = g.client_id
      where g.store_id = ${store.id}::uuid and g.resource = 'admin' and g.revoked_at is null
    `,
  );
  const asks = new Map<string, { more: string[]; installerCan: boolean }>();
  for (const row of rows) {
    const scopes = normaliseAppScopes(row.asked);
    const more = scopes.filter((scope) => !row.held.includes(scope));
    if (more.length === 0) continue;
    // The installation works as the person who installed it: only they, holding all of it now, can be given more.
    const installer = await passMembership(store.slug, row.account_id);
    asks.set(row.id, { more, installerCan: Boolean(installer) && missingPermissions(scopes, permissionsOf(holderOf(installer!))).length === 0 });
  }
  return asks;
}

export type ScopesApproval = { ok: true; added: string[] } | { ok: false; reason: "gone" | "installer" };

/**
 * An owner gives an installation what its app asks for now (D441 D2): its scopes become the app's (its tokens reach them at once) and its
 * endpoint's topics follow. Only while the person who installed it may give them all, since the installation works as them; otherwise
 * `installer`, and the app is to be installed again by someone who may. Owners only; the store's log says what was added
 * (`oauth.app_scopes_approved`).
 */
export async function approveInstallationScopes(member: Membership, grantId: string): Promise<ScopesApproval> {
  if (!memberCan(member, "owner") || !z.uuid().safeParse(grantId).success) return { ok: false, reason: "gone" };
  const row = await typedRow(
    z.object({ id: col.uuid, account_id: col.uuid, held: z.array(z.string()), asked: z.array(z.string()), name: col.text, client_id: col.text }),
    sql`
      select g.id, g.account_id, g.scopes as held, a.scopes as asked, c.name, c.client_id
      from commerce.oauth_grants g
      join commerce.apps a on a.client_id = g.client_id
      join commerce.oauth_clients c on c.id = g.client_id
      where g.id = ${grantId}::uuid and g.store_id = ${member.store.id}::uuid and g.resource = 'admin' and g.revoked_at is null
        and c.blocked_at is null
    `,
  );
  if (!row) return { ok: false, reason: "gone" };
  const scopes = normaliseAppScopes(row.asked);
  const installer = await passMembership(member.store.slug, row.account_id);
  if (!installer || missingPermissions(scopes, permissionsOf(holderOf(installer))).length > 0) return { ok: false, reason: "installer" };
  const added = scopes.filter((scope) => !row.held.includes(scope));
  await db().transaction(async (tx) => {
    await tx.execute(sql`update commerce.oauth_grants set scopes = ${textArray(scopes)} where id = ${row.id}::uuid and revoked_at is null`);
    await syncInstallationEndpoint(tx, row.id);
  });
  await audit(member.account.id, member.store.id, "oauth.app_scopes_approved", { app: row.name, client_id: row.client_id, added }, {
    target: { type: "oauth_grant", id: row.id },
  });
  return { ok: true, added };
}

/** The stores an owner cut a client off from for a person (`oauth_store_cutoffs`): never offered to them for it, never reached by it. */
export async function cutStoreIds(accountId: string, clientRowId: string): Promise<string[]> {
  const rows = await typedRows(
    z.object({ store_id: col.uuid }),
    sql`select store_id from commerce.oauth_store_cutoffs where account_id = ${accountId}::uuid and client_id = ${clientRowId}::uuid`,
  );
  return rows.map((row) => row.store_id);
}

export type StoreCutoff = { id: string; client: { name: string; host: string }; person: { id: string; name: string | null; email: string }; createdAt: string };

/** Store → Apps and API: the clients an owner cut off from the store, and for whom, newest first, to let in again. */
export async function storeCutoffs(storeId: string): Promise<StoreCutoff[]> {
  const rows = await typedRows(
    z.object({
      id: col.uuid,
      name: col.text,
      client_id: col.text,
      redirect_uris: z.array(z.string()),
      account_id: col.uuid,
      person_name: col.textOrNull,
      email: col.text,
      created_at: col.timestamp,
    }),
    sql`
      select x.id, c.name, c.client_id, c.redirect_uris, x.account_id, a.name as person_name, a.email, x.created_at
      from commerce.oauth_store_cutoffs x
      join commerce.oauth_clients c on c.id = x.client_id
      join commerce.accounts a on a.id = x.account_id
      where x.store_id = ${storeId}::uuid
      order by x.created_at desc, x.id
    `,
  );
  return rows.map((row) => ({
    id: row.id,
    client: { name: safeClientName(row.name), host: clientHost({ clientId: row.client_id, redirectUris: row.redirect_uris }) },
    person: { id: row.account_id, name: row.person_name, email: row.email },
    createdAt: row.created_at,
  }));
}

/** An owner lets a client cut off from their store in again for that person: the person can then connect it to the store again. */
export async function liftStoreCutoff(member: Membership, cutoffId: string): Promise<boolean> {
  if (!memberCan(member, "owner") || !z.uuid().safeParse(cutoffId).success) return false;
  const rows = await db().execute<{ account_id: string }>(sql`
    delete from commerce.oauth_store_cutoffs where id = ${cutoffId}::uuid and store_id = ${member.store.id}::uuid returning account_id
  `);
  if (rows.length === 0) return false;
  await audit(member.account.id, member.store.id, "oauth.store_cut_lifted", { person: String(rows[0].account_id) }, { target: { type: "oauth_cutoff", id: cutoffId } });
  return true;
}

/**
 * Codes and tokens past their end for a day are deleted, grants ended more than 90 days ago with them, and clients that registered
 * themselves and were never used in 30 days (the dispatcher).
 */
export async function pruneOAuthTokens(): Promise<number> {
  const tokens = await db().execute(sql`
    delete from commerce.oauth_tokens where id in (
      select id from commerce.oauth_tokens where expires_at < now() - interval '1 day' or revoked_at < now() - interval '1 day' limit 5000
    ) returning id
  `);
  await db().execute(sql`delete from commerce.oauth_grants where revoked_at < now() - interval '90 days'`);
  // A client that registered itself and was never used in 30 days goes (D439 review): registrations do not pile up.
  await db().execute(sql`
    delete from commerce.oauth_clients c
    where c.kind = 'registered' and c.last_seen_at is null and c.created_at < now() - interval '30 days' and c.verified = false
      and not exists (select 1 from commerce.oauth_grants g where g.client_id = c.id)
  `);
  return tokens.length;
}
