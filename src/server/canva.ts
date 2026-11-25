import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  CANVA_API,
  CANVA_CALLBACK,
  CANVA_KEYS,
  CANVA_REVOKE,
  CANVA_TOKEN,
  CANVA_ID,
  assetName,
  canvaAssetJob,
  canvaAuthorizeUrl,
  canvaDesignAnswer,
  canvaDesignList,
  canvaExportJob,
  canvaMe,
  canvaProfile,
  canvaSaid,
  canvaTokens,
  codeChallenge,
  correlationHash,
  designSize,
  editLink,
  editedFileName,
  importedFileName,
  isCanvaFile,
  newCorrelation,
  openCanvaState,
  randomToken,
  readCanvaKeys,
  readCanvaReturn,
  readDesigns,
  readThumbnailAddress,
  safeBack,
  sealCanvaState,
  thumbnailAddress,
  type CanvaKey,
} from "@/lib/canva";
import { CANVA_BACK, type CanvaField } from "@/lib/canva-paths";
import type { PermissionKey } from "@/lib/permissions";
import { canvaApp } from "@/lib/env";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { shrinkPicture } from "./ai-pictures";
import { audit, getAccount, getMembership, platformCan } from "./auth";
import { encryptionKey } from "./encryption-key";
import { storageRefusal } from "./limits";
import { log } from "./log";
import { downloadStoredFile, uploadsEnabled } from "./media";
import { storePicture } from "./media-library";
import { owned } from "./owned";
import { memberCan } from "./permissions";
import { loadSharp } from "./sharp-load";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Canva (D898, `docs/design-tools.md` C1; pure parts in `src/lib/canva.ts`): a person's own Canva account, connected through Kaizena Flow's
 * public integration (`CANVA_CLIENT_ID`, `CANVA_CLIENT_SECRET`) with OAuth and PKCE, and what the media library does with it: *Edit in
 * Canva* (a library picture up to the person's Canva as a design, Canva's *Return* back, the design exported into the library as a new
 * picture edited from the original) and *Import from Canva*. The only writer of `commerce.design_connections` (erasing an account deletes its
 * row too, `account-erasure.ts`) and `commerce.design_edits`.
 * Every call to Canva goes through `canvaCall()` with an injectable `fetch`, so tests run against a stand-in; tokens are never logged or
 * audited. Who may use it in a library is the route's to ask (`src/server/canva-route.ts`).
 */

export type CanvaDeps = {
  fetch?: typeof fetch;
  now?: () => number;
  app?: ReturnType<typeof canvaApp>;
  key?: Buffer | null;
  /** How a poll waits between asks; tests pass one that does not. */
  wait?: (ms: number) => Promise<void>;
};

const appOf = (deps: CanvaDeps) => (deps.app !== undefined ? deps.app : canvaApp());
const keyOf = (deps: CanvaDeps) => (deps.key !== undefined ? deps.key : encryptionKey());
const nowOf = (deps: CanvaDeps) => (deps.now ?? Date.now)();
const fetchOf = (deps: CanvaDeps) => deps.fetch ?? fetch;
const waitOf = (deps: CanvaDeps) => deps.wait ?? ((ms: number) => new Promise<void>((done) => setTimeout(done, ms)));

const CALL_MS = 15_000;
/** The largest file read from Canva: an exported page as PNG. */
const DOWNLOAD_MAX = 60 * 1024 * 1024;
/** How long an upload or an export is waited for before the person is asked to try again. */
const ASSET_WAIT_MS = 30_000;
const EXPORT_WAIT_MS = 75_000;
/** The designs a list shows at once. */
export const DESIGNS_PAGE = 24;

/** Whether Canva can be offered: Kaizena Flow's integration is set up and secrets can be kept. */
export const canvaOffered = (deps: CanvaDeps = {}): boolean => appOf(deps) !== null && keyOf(deps) !== null;

/** What went wrong, as a key the route says in the person's language. `canva` carries Canva's own words. */
export type CanvaProblem = "off" | "not_connected" | "reconnect" | "gone" | "unreadable" | "unreachable" | "slow" | "license" | "busy" | "storage" | "canva";
export type CanvaOutcome<T> = ({ ok: true } & T) | { ok: false; problem: CanvaProblem; detail?: string };

/** Where an edit started: the media library, or a picture field that waits for it in its own tab (C2). */
export type EditPlace = "library" | "field";

/** A picture from Canva as kept in the library: its row, its address and small copy, and its size, so a picture field can take it. */
export type BroughtPicture = { mediaId: string; url: string; thumbnailUrl: string | null; width: number; height: number };

/** Whose library: a store's (its id and slug), or Kaizena Flow's (both null), and the person working in it. */
export type CanvaOwner = { storeId: string | null; storeSlug: string | null; accountId: string };

/** The library a store's or Kaizena Flow's edits come back to. */
export const libraryPath = (storeSlug: string | null): string => (storeSlug ? `/admin/${storeSlug}/media` : "/admin/platform/media");

// ---------------------------------------------------------------------------------------------------------------------
// The connection
// ---------------------------------------------------------------------------------------------------------------------

export type CanvaAccount = { name: string; problem: string | null; connectedAt: string };

/** The person's Canva connection as the admin shows it; null when there is none. */
export async function canvaAccount(accountId: string): Promise<CanvaAccount | null> {
  const row = await typedRow(
    z.object({ display_name: col.text, problem: col.textOrNull, created_at: col.timestamp }),
    sql`select display_name, problem, created_at from commerce.design_connections where account_id = ${accountId}::uuid and provider = 'canva'`,
  );
  return row ? { name: row.display_name, problem: row.problem, connectedAt: row.created_at } : null;
}

/** The person's press on *Connect Canva*: the sealed state for the cookie, and Canva's consent page. `back` is an admin page of ours. */
export function startCanvaConnect(accountId: string, back: unknown, deps: CanvaDeps = {}): { ok: true; url: string; cookie: string } | { ok: false; problem: "off" } {
  const app = appOf(deps);
  const key = keyOf(deps);
  if (!app || !key) return { ok: false, problem: "off" };
  const value = { state: randomToken(), account: accountId, back: safeBack(back), verifier: randomToken() };
  return {
    ok: true,
    cookie: sealCanvaState(key, value, nowOf(deps)),
    url: canvaAuthorizeUrl({ clientId: app.clientId, redirectUri: `${siteUrl()}${CANVA_CALLBACK}`, state: value.state, challenge: codeChallenge(value.verifier) }),
  };
}

type Tokens = { access: string; refresh: string | null; expiresAt: Date; scope: string };
type TokenAnswer = { tokens: Tokens } | { refused: true } | { failed: true };

async function tokenCall(form: Record<string, string>, deps: CanvaDeps): Promise<TokenAnswer> {
  const app = appOf(deps);
  if (!app) return { failed: true };
  try {
    const response = await fetchOf(deps)(CANVA_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}` },
      body: new URLSearchParams(form).toString(),
      redirect: "error",
      signal: AbortSignal.timeout(CALL_MS),
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) {
      const said = canvaSaid(json);
      // A grant Canva no longer takes (revoked, used, expired) asks the person to connect again; anything else may pass.
      if (response.status === 400 || response.status === 401) return said.code === "invalid_grant" || said.code === "unauthorized_user" || response.status === 401 ? { refused: true } : { failed: true };
      return { failed: true };
    }
    const body = canvaTokens.safeParse(json);
    if (!body.success) return { failed: true };
    return {
      tokens: {
        access: body.data.access_token,
        refresh: body.data.refresh_token ?? null,
        expiresAt: new Date(nowOf(deps) + Math.max(60, body.data.expires_in - 60) * 1000),
        scope: body.data.scope ?? "",
      },
    };
  } catch (error) {
    log("warn", "canva.token_failed", {}, error);
    return { failed: true };
  }
}

/** A call with a bare token, before the connection is kept (who the person is at Canva). */
async function withToken(token: string, path: string, deps: CanvaDeps): Promise<unknown> {
  const response = await fetchOf(deps)(`${CANVA_API}${path}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(CALL_MS) });
  return response.ok ? response.json().catch(() => null) : null;
}

/**
 * Canva's return to `/api/integrations/canva/callback`: the state checked against the cookie and the person signed in now the one who
 * pressed; the code spent with the PKCE verifier, who they are at Canva read, and the tokens kept encrypted (a new connection replaces
 * their old one). The answer is the admin page to go back to, with the outcome in `canva=`.
 */
export async function finishCanvaConnect(params: URLSearchParams, cookie: string | undefined, signedIn: string | null, deps: CanvaDeps = {}): Promise<string> {
  const key = keyOf(deps);
  const state = key ? openCanvaState(key, cookie, nowOf(deps)) : null;
  if (!key || !state) return "/admin";
  const back = (outcome: string) => `${state.back}?canva=${outcome}`;
  if (params.get("state") !== state.state) return back("failed");
  if (!signedIn || signedIn !== state.account) return back("failed");
  const code = params.get("code");
  if (!code || code.length > 4000) return back(params.get("error") ? "declined" : "failed");
  const answer = await tokenCall({ grant_type: "authorization_code", code, code_verifier: state.verifier, redirect_uri: `${siteUrl()}${CANVA_CALLBACK}` }, deps);
  if (!("tokens" in answer)) return back("failed");
  const t = answer.tokens;
  const me = canvaMe.safeParse(await withToken(t.access, "/v1/users/me", deps).catch(() => null));
  if (!me.success) return back("failed");
  const profile = canvaProfile.safeParse(await withToken(t.access, "/v1/users/me/profile", deps).catch(() => null));
  const name = (profile.success ? (profile.data.profile.display_name ?? "") : "").replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 120);
  await db().execute(sql`
    insert into commerce.design_connections (account_id, provider, external_user_id, external_team_id, display_name, access_token_encrypted,
      access_expires_at, refresh_token_encrypted, scopes, problem)
    values (${state.account}::uuid, 'canva', ${me.data.team_user.user_id}, ${me.data.team_user.team_id ?? null}, ${name}, ${encryptSecret(t.access, key)},
      ${t.expiresAt.toISOString()}::timestamptz, ${t.refresh ? encryptSecret(t.refresh, key) : null}, ${t.scope.slice(0, 1000)}, null)
    on conflict on constraint design_connections_account_key do update set external_user_id = excluded.external_user_id,
      external_team_id = excluded.external_team_id, display_name = excluded.display_name, access_token_encrypted = excluded.access_token_encrypted,
      access_expires_at = excluded.access_expires_at, refresh_token_encrypted = excluded.refresh_token_encrypted, scopes = excluded.scopes,
      problem = null, created_at = now(), updated_at = now()
  `);
  await audit(state.account, null, "account.canva_connected", {});
  return back("connected");
}

/** Disconnects the person's Canva: the refresh token revoked at Canva (which ends the consent there too) and the row deleted. */
export async function disconnectCanva(accountId: string, deps: CanvaDeps = {}): Promise<void> {
  const key = keyOf(deps);
  const app = appOf(deps);
  const row = await typedRow(
    z.object({ refresh: col.textOrNull }),
    sql`delete from commerce.design_connections where account_id = ${accountId}::uuid and provider = 'canva' returning refresh_token_encrypted as refresh`,
  );
  if (!row) return;
  if (row.refresh && key && app) {
    try {
      await fetchOf(deps)(CANVA_REVOKE, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}` },
        body: new URLSearchParams({ token: decryptSecret(row.refresh, key) }).toString(),
        redirect: "error",
        signal: AbortSignal.timeout(CALL_MS),
      });
    } catch (error) {
      // The row is gone either way: Canva's own list of apps is the person's to tidy if the revoke did not arrive.
      log("warn", "canva.revoke_failed", {}, error);
    }
  }
  await audit(accountId, null, "account.canva_disconnected", {});
}

type Access = { token: string; userId: string; teamId: string | null } | { problem: "not_connected" | "reconnect" | "unreachable" };

/**
 * A working access token for the person's connection, refreshed when it has run out: inside a transaction that locks the row, because
 * Canva's refresh tokens work once and a second refresh with the same one would end the connection. A refresh Canva refuses keeps the row
 * with its `problem` (the admin then asks the person to connect again).
 */
async function canvaAccess(accountId: string, deps: CanvaDeps): Promise<Access> {
  const key = keyOf(deps);
  if (!key || !appOf(deps)) return { problem: "not_connected" };
  return db().transaction(async (tx) => {
    const row = await typedRow(
      z.object({ access: col.text, expires: col.timestamp, refresh: col.textOrNull, user_id: col.text, team_id: col.textOrNull, problem: col.textOrNull }),
      sql`select access_token_encrypted as access, access_expires_at as expires, refresh_token_encrypted as refresh, external_user_id as user_id,
            external_team_id as team_id, problem
          from commerce.design_connections where account_id = ${accountId}::uuid and provider = 'canva' for update`,
      tx,
    );
    if (!row) return { problem: "not_connected" as const };
    const who = { userId: row.user_id, teamId: row.team_id };
    if (Date.parse(row.expires) > nowOf(deps)) return { token: decryptSecret(row.access, key), ...who };
    if (!row.refresh || row.problem) return { problem: "reconnect" as const };
    const answer = await tokenCall({ grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh, key) }, deps);
    if ("refused" in answer) {
      await tx.execute(sql`
        update commerce.design_connections set refresh_token_encrypted = null, problem = 'Canva no longer takes the connection: connect again.', updated_at = now()
        where account_id = ${accountId}::uuid and provider = 'canva'
      `);
      log("warn", "canva.refresh_refused", { accountId });
      return { problem: "reconnect" as const };
    }
    if ("failed" in answer) return { problem: "unreachable" as const };
    const t = answer.tokens;
    await tx.execute(sql`
      update commerce.design_connections set access_token_encrypted = ${encryptSecret(t.access, key)}, access_expires_at = ${t.expiresAt.toISOString()}::timestamptz,
        refresh_token_encrypted = ${t.refresh ? encryptSecret(t.refresh, key) : row.refresh}, updated_at = now()
      where account_id = ${accountId}::uuid and provider = 'canva'
    `);
    return { token: t.access, ...who };
  });
}

type Call = { ok: true; status: number; body: unknown } | { ok: false; status: number; code: string | null; message: string | null };

/** One call to Canva's REST API with the person's token; a 401 marks the token used up so the next call refreshes it. */
async function canvaCall(
  accountId: string,
  method: "GET" | "POST",
  path: string,
  send: { json?: unknown; bytes?: Uint8Array; headers?: Record<string, string> },
  deps: CanvaDeps,
): Promise<Call | { ok: false; status: 0; problem: "not_connected" | "reconnect" | "unreachable" }> {
  const access = await canvaAccess(accountId, deps);
  if ("problem" in access) return { ok: false, status: 0, problem: access.problem };
  try {
    const response = await fetchOf(deps)(`${CANVA_API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${access.token}`,
        Accept: "application/json",
        ...(send.json !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(send.bytes ? { "Content-Type": "application/octet-stream" } : {}),
        ...send.headers,
      },
      body: send.json !== undefined ? JSON.stringify(send.json) : send.bytes ? new Uint8Array(send.bytes) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(CALL_MS),
    });
    const json = await response.json().catch(() => null);
    if (response.status === 401) {
      await db().execute(sql`update commerce.design_connections set access_expires_at = now() where account_id = ${accountId}::uuid and provider = 'canva'`);
    }
    if (!response.ok) return { ok: false, status: response.status, ...canvaSaid(json) };
    await db().execute(sql`update commerce.design_connections set last_used_at = now() where account_id = ${accountId}::uuid and provider = 'canva'`);
    return { ok: true, status: response.status, body: json };
  } catch (error) {
    log("warn", "canva.call_failed", { path: path.split("?")[0] }, error);
    return { ok: false, status: 0, problem: "unreachable" };
  }
}

/** A refused call as the person's problem. */
function problemOf(call: Exclude<Awaited<ReturnType<typeof canvaCall>>, { ok: true }>): { ok: false; problem: CanvaProblem; detail?: string } {
  if ("problem" in call) return { ok: false, problem: call.problem };
  if (call.status === 401) return { ok: false, problem: "reconnect" };
  if (call.status === 429) return { ok: false, problem: "busy" };
  if (call.status === 403 && call.code === "missing_scope") return { ok: false, problem: "reconnect" };
  if (call.status === 404 || call.code === "design_not_found" || call.code === "not_found") return { ok: false, problem: "gone" };
  if (call.code === "license_required") return { ok: false, problem: "license" };
  return { ok: false, problem: "canva", ...(call.message ? { detail: call.message } : {}) };
}

// ---------------------------------------------------------------------------------------------------------------------
// Edit in Canva
// ---------------------------------------------------------------------------------------------------------------------

/** Polls one of Canva's jobs until it is done or the time is up. */
async function pollJob<T extends { job: { status: string } }>(
  accountId: string,
  path: string,
  schema: z.ZodType<T>,
  within: number,
  deps: CanvaDeps,
): Promise<{ ok: true; job: T["job"] } | { ok: false; problem: CanvaProblem; detail?: string }> {
  const until = nowOf(deps) + within;
  for (let step = 0; ; step++) {
    const call = await canvaCall(accountId, "GET", path, {}, deps);
    if (!call.ok) return problemOf(call);
    const read = schema.safeParse(call.body);
    if (!read.success) return { ok: false, problem: "canva" };
    if (read.data.job.status !== "in_progress") return { ok: true, job: read.data.job };
    if (nowOf(deps) >= until) return { ok: false, problem: "slow" };
    await waitOf(deps)(Math.min(3000, 800 + step * 400));
  }
}

/**
 * *Edit in Canva* on a library picture: its own file (read by its row, never an address) goes up to the person's Canva as a PNG asset, a
 * design of its size is made with it, and an edit row keeps the design and a one-time correlation. The answer is the design's edit link
 * carrying that correlation, for the browser to go to.
 */
export async function startCanvaEdit(
  owner: CanvaOwner,
  target: string | { mediaId?: string; url?: string },
  deps: CanvaDeps = {},
  place: EditPlace = "library",
): Promise<CanvaOutcome<{ url: string; editId: string }>> {
  if (!canvaOffered(deps)) return { ok: false, problem: "off" };
  const { mediaId, url } = typeof target === "string" ? { mediaId: target, url: undefined } : target;
  if (mediaId ? !z.uuid().safeParse(mediaId).success : !url || url.length > 1000 || !/^https?:\/\//.test(url)) return { ok: false, problem: "gone" };
  // A picture field holds only its picture's address: the picture must be one the site's own library holds (by its file or its small copy).
  const picture = await typedRow(
    z.object({ id: col.uuid, bucket: col.text, path: col.text, file_name: col.text, width: z.number().int().nullable(), height: z.number().int().nullable() }),
    sql`select id, bucket, path, file_name, width, height from commerce.media
        where ${mediaId ? sql`id = ${mediaId}::uuid` : sql`(url = ${url ?? ""} or thumbnail_url = ${url ?? ""} or medium_url = ${url ?? ""})`} and kind = 'image' and ${owned(owner.storeId)}
        limit 1`,
  );
  if (!picture) return { ok: false, problem: "gone" };
  const bytes = await downloadStoredFile(picture.bucket, picture.path);
  if (!bytes) return { ok: false, problem: "unreadable" };
  let png: Uint8Array;
  let size: { width: number; height: number };
  try {
    const sharp = await loadSharp();
    const read = sharp(bytes, { failOn: "error" }).rotate();
    const meta = await read.metadata();
    png = new Uint8Array(await read.png().toBuffer());
    size = designSize(picture.width ?? meta.width ?? null, picture.height ?? meta.height ?? null);
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  const name = assetName(picture.file_name);
  const upload = await canvaCall(owner.accountId, "POST", "/v1/asset-uploads", { bytes: png, headers: { "Asset-Upload-Metadata": JSON.stringify({ name_base64: Buffer.from(name).toString("base64") }) } }, deps);
  if (!upload.ok) return problemOf(upload);
  const started = canvaAssetJob.safeParse(upload.body);
  if (!started.success) return { ok: false, problem: "canva" };
  let job = started.data.job;
  if (job.status === "in_progress") {
    const done = await pollJob(owner.accountId, `/v1/asset-uploads/${encodeURIComponent(job.id)}`, canvaAssetJob, ASSET_WAIT_MS, deps);
    if (!done.ok) return done;
    job = done.job;
  }
  if (job.status !== "success" || !job.asset) return { ok: false, problem: "canva", ...(job.error?.message ? { detail: job.error.message.slice(0, 200) } : {}) };
  const made = await canvaCall(
    owner.accountId,
    "POST",
    "/v1/designs",
    { json: { type: "type_and_asset", design_type: { type: "custom", width: size.width, height: size.height }, asset_id: job.asset.id, title: name } },
    deps,
  );
  if (!made.ok) return problemOf(made);
  const design = canvaDesignAnswer.safeParse(made.body);
  if (!design.success || !design.data.design.urls) return { ok: false, problem: "canva" };
  const { correlation, hash } = newCorrelation();
  const url = editLink(design.data.design.urls.edit_url, correlation);
  if (!url) return { ok: false, problem: "canva" };
  const row = await typedRow(
    z.object({ id: col.uuid }),
    sql`insert into commerce.design_edits (store_id, account_id, provider, design_id, source_media_id, correlation_hash, place)
        values (${owner.storeId}::uuid, ${owner.accountId}::uuid, 'canva', ${design.data.design.id}, ${picture.id}::uuid, ${hash}, ${place}) returning id`,
  );
  if (!row) return { ok: false, problem: "canva" };
  return { ok: true, url, editId: row.id };
}

let keysRead: { keys: CanvaKey[]; at: number } | null = null;

/** Canva's signing keys, kept for an hour; read again at once when a token names a key not among them. */
async function canvaKeys(deps: CanvaDeps, fresh = false): Promise<CanvaKey[]> {
  if (!fresh && keysRead && nowOf(deps) - keysRead.at < 3_600_000 && !deps.fetch) return keysRead.keys;
  try {
    const response = await fetchOf(deps)(CANVA_KEYS, { headers: { Accept: "application/json" }, redirect: "error", signal: AbortSignal.timeout(CALL_MS) });
    const keys = response.ok ? readCanvaKeys(await response.json().catch(() => null)) : [];
    if (keys.length > 0) keysRead = { keys, at: nowOf(deps) };
    return keys;
  } catch (error) {
    log("warn", "canva.keys_failed", {}, error);
    return keysRead?.keys ?? [];
  }
}

/**
 * Canva's *Return* to `/api/integrations/canva/return?correlation_jwt=…`: the JWT checked against Canva's keys (our client id, type `rti`,
 * not over), the edit it names found by its correlation and design, and Canva's user in it the one whose connection made the edit. The edit
 * is marked returned; the answer is its library page with `canva=` naming it, where the library brings the design back. Anything that does
 * not check out goes to the library (or the admin) without it.
 */
export async function canvaReturned(params: URLSearchParams, deps: CanvaDeps = {}): Promise<string> {
  const app = appOf(deps);
  const token = params.get("correlation_jwt") ?? "";
  if (!app || !token) return "/admin";
  let read = readCanvaReturn(token, await canvaKeys(deps), { clientId: app.clientId, now: nowOf(deps) });
  if (!read.ok && read.refusal === "unknown_key") read = readCanvaReturn(token, await canvaKeys(deps, true), { clientId: app.clientId, now: nowOf(deps) });
  if (!read.ok) {
    log("warn", "canva.return_refused", { refusal: read.refusal });
    return "/admin";
  }
  const { designId, correlation, userId, teamId } = read.value;
  const edit = await typedRow(
    z.object({ id: col.uuid, account_id: col.uuid, slug: col.textOrNull, store_id: col.textOrNull, user_id: col.textOrNull, team_id: col.textOrNull, place: col.text }),
    sql`select e.id, e.account_id, s.slug, e.store_id, c.external_user_id as user_id, c.external_team_id as team_id, e.place
        from commerce.design_edits e
        left join commerce.stores s on s.id = e.store_id
        left join commerce.design_connections c on c.account_id = e.account_id and c.provider = 'canva'
        where e.correlation_hash = ${correlationHash(correlation)} and e.design_id = ${designId} and e.provider = 'canva'`,
  );
  if (!edit || (edit.store_id && !edit.slug)) return "/admin";
  const library = libraryPath(edit.slug);
  if (edit.user_id !== userId || (teamId !== null && edit.team_id !== null && edit.team_id !== teamId)) return library;
  await db().execute(sql`
    update commerce.design_edits set status = case when status = 'open' then 'returned' else status end, returned_at = now(), updated_at = now()
    where id = ${edit.id}::uuid and ${owned(edit.store_id)}
  `);
  return edit.place === "field" ? `${CANVA_BACK}?edit=${edit.id}` : `${library}?canva=${edit.id}`;
}

/** Where a person's edit stands, for a picture field waiting on it in another tab: `open` until Canva's *Return*, then `returned`. */
export async function canvaEditStatus(owner: CanvaOwner, editId: string): Promise<CanvaOutcome<{ status: "open" | "returned" | "brought" }>> {
  if (!z.uuid().safeParse(editId).success) return { ok: false, problem: "gone" };
  const row = await typedRow(
    z.object({ status: z.enum(["open", "returned", "brought"]) }),
    sql`select status from commerce.design_edits where id = ${editId}::uuid and account_id = ${owner.accountId}::uuid and provider = 'canva' and ${owned(owner.storeId)}`,
  );
  return row ? { ok: true, status: row.status } : { ok: false, problem: "gone" };
}

/** Exports a design's first page as PNG and reads the file from Canva's export host. */
async function exportFirstPage(accountId: string, designId: string, deps: CanvaDeps): Promise<{ ok: true; bytes: Uint8Array } | { ok: false; problem: CanvaProblem; detail?: string }> {
  const started = await canvaCall(accountId, "POST", "/v1/exports", { json: { design_id: designId, format: { type: "png", pages: [1] } } }, deps);
  if (!started.ok) return problemOf(started);
  const first = canvaExportJob.safeParse(started.body);
  if (!first.success) return { ok: false, problem: "canva" };
  let job = first.data.job;
  if (job.status === "in_progress") {
    const done = await pollJob(accountId, `/v1/exports/${encodeURIComponent(job.id)}`, canvaExportJob, EXPORT_WAIT_MS, deps);
    if (!done.ok) return done;
    job = done.job;
  }
  if (job.status !== "success") {
    if (job.error?.code === "license_required") return { ok: false, problem: "license" };
    return { ok: false, problem: "canva", ...(job.error?.message ? { detail: job.error.message.slice(0, 200) } : {}) };
  }
  const link = job.urls?.[0];
  if (!link || !isCanvaFile(link)) return { ok: false, problem: "canva" };
  try {
    const response = await fetchOf(deps)(link, { redirect: "error", signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return { ok: false, problem: "unreachable" };
    if (Number(response.headers.get("content-length") ?? 0) > DOWNLOAD_MAX) return { ok: false, problem: "unreadable" };
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (bytes.length === 0 || bytes.length > DOWNLOAD_MAX) return { ok: false, problem: "unreadable" };
    return { ok: true, bytes };
  } catch (error) {
    log("warn", "canva.download_failed", {}, error);
    return { ok: false, problem: "unreachable" };
  }
}

/** A file from Canva kept in the library as uploads are: shrunk on the server, counted against the store's storage. */
async function keepInLibrary(
  owner: CanvaOwner,
  bytes: Uint8Array,
  fileName: string,
  editedFrom: string | null,
): Promise<({ ok: true } & BroughtPicture) | { ok: false; problem: CanvaProblem; detail?: string }> {
  let shrunk: Awaited<ReturnType<typeof shrinkPicture>>;
  try {
    shrunk = await shrinkPicture(bytes);
  } catch {
    return { ok: false, problem: "unreadable" };
  }
  const total = shrunk.image.length + shrunk.thumbnail.length + (shrunk.medium?.length ?? 0);
  const full = await storageRefusal(owner.storeId, total);
  if (full) return { ok: false, problem: "storage", detail: full };
  const stored = await storePicture(
    { storeId: owner.storeId, accountId: owner.accountId },
    new File([new Uint8Array(shrunk.image)], fileName, { type: "image/webp" }),
    new File([new Uint8Array(shrunk.thumbnail)], fileName.replace(/\.webp$/, "-480.webp"), { type: "image/webp" }),
    {
      fileName,
      compressed: true,
      madeBy: "canva",
      editedFrom,
      medium: shrunk.medium ? new File([new Uint8Array(shrunk.medium)], fileName.replace(/\.webp$/, "-800.webp"), { type: "image/webp" }) : null,
    },
  );
  if (!stored.ok || !stored.id) return { ok: false, problem: "storage", ...(!stored.ok ? { detail: stored.problem } : {}) };
  return { ok: true, mediaId: stored.id, url: stored.url, thumbnailUrl: stored.thumbnailUrl ?? null, width: shrunk.width, height: shrunk.height };
}

/**
 * Brings an edit back from Canva into the library (after *Return*, or again later): the person's own edit in this library, its design's
 * first page exported and kept as a new picture edited from the original, which stays as it was. The edit row names the latest copy.
 */
export async function bringBackFromCanva(owner: CanvaOwner, editId: string, deps: CanvaDeps = {}): Promise<CanvaOutcome<BroughtPicture>> {
  if (!canvaOffered(deps)) return { ok: false, problem: "off" };
  if (!z.uuid().safeParse(editId).success) return { ok: false, problem: "gone" };
  const edit = await typedRow(
    z.object({ id: col.uuid, design_id: col.text, source: col.textOrNull, file_name: col.textOrNull }),
    sql`select e.id, e.design_id, e.source_media_id as source, m.file_name
        from commerce.design_edits e left join commerce.media m on m.id = e.source_media_id
        where e.id = ${editId}::uuid and e.account_id = ${owner.accountId}::uuid and e.provider = 'canva' and ${owned(owner.storeId, sql`e.store_id`)}`,
  );
  if (!edit) return { ok: false, problem: "gone" };
  const exported = await exportFirstPage(owner.accountId, edit.design_id, deps);
  if (!exported.ok) {
    await db().execute(sql`update commerce.design_edits set problem = ${exported.problem}, updated_at = now() where id = ${edit.id}::uuid and ${owned(owner.storeId)}`);
    return exported;
  }
  const kept = await keepInLibrary(owner, exported.bytes, editedFileName(edit.file_name ?? "picture"), edit.source);
  if (!kept.ok) return kept;
  await db().execute(sql`
    update commerce.design_edits set status = 'brought', result_media_id = ${kept.mediaId}::uuid, brought_at = now(), problem = null, updated_at = now()
    where id = ${edit.id}::uuid and ${owned(owner.storeId)}
  `);
  await audit(owner.accountId, owner.storeId, owner.storeId ? "store.media_canva_edited" : "platform.media_canva_edited", { mediaId: kept.mediaId, from: edit.source });
  return kept;
}

/** The person's latest edit of each picture in this library, so a picture can be brought back from Canva again: by the picture's id. */
export async function canvaEditsOf(owner: CanvaOwner): Promise<Record<string, string>> {
  const rows = await typedRows(
    z.object({ source: col.uuid, id: col.uuid }),
    sql`select distinct on (source_media_id) source_media_id as source, id from commerce.design_edits
        where account_id = ${owner.accountId}::uuid and provider = 'canva' and source_media_id is not null and ${owned(owner.storeId)}
        order by source_media_id, created_at desc limit 500`,
  );
  return Object.fromEntries(rows.map((row) => [row.source, row.id]));
}

// ---------------------------------------------------------------------------------------------------------------------
// Import from Canva
// ---------------------------------------------------------------------------------------------------------------------

/** A design as the import list shows it: its thumbnail through our own signed address, never Canva's link. */
export type CanvaDesignItem = { id: string; title: string; thumbnail: string | null; width: number | null; height: number | null; pages: number | null };

/** The person's designs, latest first (or the best matches for a search), a page at a time. */
export async function listCanvaDesigns(
  owner: CanvaOwner,
  input: { query?: unknown; continuation?: unknown },
  deps: CanvaDeps = {},
): Promise<CanvaOutcome<{ designs: CanvaDesignItem[]; continuation: string | null }>> {
  if (!canvaOffered(deps)) return { ok: false, problem: "off" };
  const key = keyOf(deps);
  const query = typeof input.query === "string" ? input.query.replace(/[\p{Cc}\p{Cf}]/gu, "").trim().slice(0, 255) : "";
  const params = new URLSearchParams({ limit: String(DESIGNS_PAGE), sort_by: query ? "relevance" : "modified_descending" });
  if (query) params.set("query", query);
  if (typeof input.continuation === "string" && /^[A-Za-z0-9_=+/.-]{1,2000}$/.test(input.continuation)) params.set("continuation", input.continuation);
  const call = await canvaCall(owner.accountId, "GET", `/v1/designs?${params}`, {}, deps);
  if (!call.ok) return problemOf(call);
  const list = canvaDesignList.safeParse(call.body);
  if (!list.success || !key) return { ok: false, problem: "canva" };
  const designs = readDesigns(list.data.items).map((design) => ({
    id: design.id,
    title: (design.title ?? "").replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 200),
    thumbnail: design.thumbnail ? thumbnailAddress(key, design.thumbnail.url, nowOf(deps)) : null,
    width: design.thumbnail?.width ?? null,
    height: design.thumbnail?.height ?? null,
    pages: design.page_count ?? null,
  }));
  return { ok: true, designs, continuation: list.data.continuation ?? null };
}

/** *Import from Canva*: one of the person's designs, its first page exported and kept in the library as a new picture. */
export async function importCanvaDesign(owner: CanvaOwner, designId: unknown, deps: CanvaDeps = {}): Promise<CanvaOutcome<BroughtPicture>> {
  if (!canvaOffered(deps)) return { ok: false, problem: "off" };
  if (typeof designId !== "string" || !CANVA_ID.test(designId)) return { ok: false, problem: "gone" };
  const read = await canvaCall(owner.accountId, "GET", `/v1/designs/${encodeURIComponent(designId)}`, {}, deps);
  if (!read.ok) return problemOf(read);
  const design = canvaDesignAnswer.safeParse(read.body);
  if (!design.success) return { ok: false, problem: "canva" };
  const exported = await exportFirstPage(owner.accountId, designId, deps);
  if (!exported.ok) return exported;
  const kept = await keepInLibrary(owner, exported.bytes, importedFileName(design.data.design.title), null);
  if (!kept.ok) return kept;
  await audit(owner.accountId, owner.storeId, owner.storeId ? "store.media_canva_imported" : "platform.media_canva_imported", { mediaId: kept.mediaId });
  return kept;
}

/** One of Canva's thumbnails through our signed address (`/api/integrations/canva/thumbnail`): only Canva's file hosts, only links handed out here. */
export async function canvaThumbnail(params: URLSearchParams, deps: CanvaDeps = {}): Promise<{ bytes: Uint8Array; type: string } | null> {
  const key = keyOf(deps);
  const link = key ? readThumbnailAddress(key, params, nowOf(deps)) : null;
  if (!link) return null;
  try {
    const response = await fetchOf(deps)(link, { redirect: "error", signal: AbortSignal.timeout(10_000) });
    const type = response.headers.get("content-type") ?? "";
    if (!response.ok || !/^image\/(png|jpeg|webp|gif)$/.test(type.split(";")[0].trim())) return null;
    const bytes = new Uint8Array(await response.arrayBuffer());
    return bytes.length > 0 && bytes.length <= 5 * 1024 * 1024 ? { bytes, type: type.split(";")[0].trim() } : null;
  } catch {
    return null;
  }
}

/**
 * What a media library hands its Canva parts (D898): the person's connection, their latest edit of each picture here, and from the address
 * (`canva=`) an edit Canva's *Return* just came back from (one of theirs) or how a connect ended. Null where Canva is not offered.
 */
export async function canvaForLibrary(
  owner: CanvaOwner,
  given: unknown,
): Promise<{ account: { name: string; problem: boolean } | null; edits: Record<string, string>; returned: string | null; outcome: "connected" | "declined" | "failed" | null } | null> {
  if (!canvaOffered()) return null;
  const value = Array.isArray(given) ? given[0] : given;
  const [account, edits] = await Promise.all([canvaAccount(owner.accountId), canvaEditsOf(owner)]);
  const returned = typeof value === "string" && z.uuid().safeParse(value).success ? value : null;
  const outcome = value === "connected" || value === "declined" || value === "failed" ? value : null;
  return { account: account ? { name: account.name, problem: account.problem !== null } : null, edits, returned, outcome };
}

/**
 * *Edit in Canva* for an editor's picture fields (C2): offered where Canva is set up, pictures can be kept and the signed-in person may use
 * the route (`key` in a store, the website area on Kaizena Flow's own); null elsewhere, and the field draws nothing.
 */
export async function canvaForField(endpoint: string, storeSlug: string | null, key: PermissionKey): Promise<CanvaField | null> {
  if (!canvaOffered() || !uploadsEnabled()) return null;
  const person = storeSlug ? ((m) => (m && memberCan(m, key) ? m.account : null))(await getMembership(storeSlug)) : await getAccount();
  if (!person || (!storeSlug && !platformCan(person, "website"))) return null;
  const account = await canvaAccount(person.id);
  return { endpoint, connected: account !== null && account.problem === null };
}
