import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { grantsPins, keptBoards, parseBoards, parseTokens, PINTEREST_API, pinterestAuthorizeUrl, renewDue, usernameFrom, type BoardChoice } from "@/lib/pinterest";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit } from "./auth";
import { encryptionKey } from "./encryption-key";
import type { Connection } from "./social-connect-routes";
import { ConnectError, connectStart, connectStarted } from "./social-connect-state";
import { col, typedRow } from "./typed-rows";

/**
 * A store's Pinterest account (D870 S3.4, pure parts in `src/lib/pinterest.ts`): Kaizena Flow's Pinterest app (`PINTEREST_APP_ID`,
 * `PINTEREST_APP_SECRET`), signing in with `boards:read`, `pins:read`, `pins:write` and `user_accounts:read`. The code is exchanged for tokens,
 * kept encrypted, and the person's boards listed; with one board it is chosen, with several the owner chooses on Social posts. The access token
 * is renewed when it nears its end, each time it is used (`pinterestTarget()`). The only writer of `pinterest_accounts`.
 */

const TIMEOUT_MS = 15_000;

export const PINTEREST_COOKIE = "kaizen_pinterest_connect";
export const PINTEREST_CALLBACK = "/api/integrations/pinterest/callback";
export const PINTEREST_COOKIE_PATH = "/api/integrations/pinterest";

type App = { appId: string; appSecret: string };

function pinterestApp(): App | null {
  const appId = process.env.PINTEREST_APP_ID?.trim();
  const appSecret = process.env.PINTEREST_APP_SECRET?.trim();
  return appId && appSecret && encryptionKey() ? { appId, appSecret } : null;
}

/** Kaizena Flow's Pinterest app is set up here, so owners can connect an account. */
export const pinterestAppOn = () => pinterestApp() !== null;

export class PinterestError extends ConnectError {}

/** Where the owner is sent to connect, and what the callback must see again (kept in `kaizen_pinterest_connect`). */
export function pinterestStart(storeSlug: string, accountId: string): { url: string; cookie: string } | null {
  const app = pinterestApp();
  return app ? connectStart((state) => pinterestAuthorizeUrl(app.appId, `${siteUrl()}${PINTEREST_CALLBACK}`, state), storeSlug, accountId) : null;
}

/** Who started connecting, from the cookie; checked against the state Pinterest sends back. */
export function pinterestStarted(cookie: string | undefined, params: URLSearchParams): { store: string; accountId: string } {
  return connectStarted(cookie, params, (message) => new PinterestError(message));
}

/** One call to Pinterest's API: its JSON, or `PinterestError` with Pinterest's own words (never a person's data). */
export async function pinterestCall(path: string, init: RequestInit = {}): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    response = await fetch(`${PINTEREST_API}${path}`, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" });
  } catch {
    throw new PinterestError("Pinterest did not answer. Try again in a moment.");
  }
  const json = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  if (!response.ok || !json) {
    const said = typeof json?.message === "string" ? json.message.slice(0, 200) : null;
    throw new PinterestError(said ? `Pinterest said: ${said}` : `Pinterest answered ${response.status}.`);
  }
  return json;
}

const bearer = (token: string): RequestInit => ({ headers: { Authorization: `Bearer ${token}` } });

/** The app's own call for tokens: a code exchanged, or a refresh token renewed. */
function tokenCall(app: App, params: Record<string, string>, call: typeof pinterestCall) {
  return call("/oauth/token", {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${app.appId}:${app.appSecret}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params),
  });
}

/**
 * Connects from the callback: the code exchanged for tokens, the account's name and boards read. One board is chosen at once; with several the
 * owner chooses (`choosePinterestBoard()`). A new connection replaces the store's old one. Audited without a token. The boards to choose
 * among, when there are several.
 */
export async function connectPinterest(accountId: string, storeId: string, params: URLSearchParams, call: typeof pinterestCall = pinterestCall): Promise<{ choose: BoardChoice[] }> {
  const app = pinterestApp();
  const key = encryptionKey();
  if (!app || !key) throw new PinterestError("Kaizena Flow's Pinterest app is not set up here.");
  if (params.get("error")) throw new PinterestError(params.get("error_description") ?? "Cancelled", "cancelled");
  const code = params.get("code");
  if (!code) throw new PinterestError("Pinterest did not connect.");
  const now = new Date();
  const tokens = parseTokens(await tokenCall(app, { grant_type: "authorization_code", code, redirect_uri: `${siteUrl()}${PINTEREST_CALLBACK}` }, call), now);
  if (!tokens) throw new PinterestError("Pinterest gave no token.");
  const [user, boards] = await Promise.all([call("/user_account", bearer(tokens.access)).then(usernameFrom), call("/boards?page_size=100", bearer(tokens.access)).then(parseBoards)]);
  if (boards.length === 0) throw new PinterestError("The Pinterest account has no board to pin to. Make a board on Pinterest, then connect again.");
  const only = boards.length === 1 ? boards[0] : null;
  const publish = grantsPins(tokens.scopes);
  await db().execute(sql`
    insert into commerce.pinterest_accounts (store_id, username, access_token_encrypted, refresh_token_encrypted, token_expires_at, refresh_expires_at, board_id, board_name, choices, publish, connected_by)
    values (${storeId}::uuid, ${user}, ${encryptSecret(tokens.access, key)}, ${encryptSecret(tokens.refresh, key)}, ${tokens.expiresAt.toISOString()}::timestamptz,
      ${tokens.refreshExpiresAt.toISOString()}::timestamptz, ${only?.id ?? null}, ${only?.name ?? ""}, ${JSON.stringify(only ? [] : boards)}::jsonb, ${publish}, ${accountId}::uuid)
    on conflict on constraint pinterest_accounts_store_key do update set username = excluded.username, access_token_encrypted = excluded.access_token_encrypted,
      refresh_token_encrypted = excluded.refresh_token_encrypted, token_expires_at = excluded.token_expires_at, refresh_expires_at = excluded.refresh_expires_at,
      board_id = excluded.board_id, board_name = excluded.board_name, choices = excluded.choices, publish = excluded.publish, problem = null,
      connected_by = excluded.connected_by, updated_at = now()
  `);
  await audit(accountId, storeId, "store.pinterest_connected", { boards: boards.length, publish });
  return { choose: only ? [] : boards };
}

/** The owner's choice among their boards. False when it is not one of the choices. */
export async function choosePinterestBoard(accountId: string, storeId: string, boardId: string): Promise<boolean> {
  const row = await typedRow(z.object({ choices: z.unknown() }), sql`select choices from commerce.pinterest_accounts where store_id = ${storeId}::uuid`);
  const board = row ? keptBoards(row.choices).find((b) => b.id === boardId) : null;
  if (!board) return false;
  await db().execute(sql`
    update commerce.pinterest_accounts set board_id = ${board.id}, board_name = ${board.name}, choices = '[]'::jsonb, problem = null, updated_at = now()
    where store_id = ${storeId}::uuid`);
  await audit(accountId, storeId, "store.pinterest_board_chosen", {});
  return true;
}

/** Disconnects the store's Pinterest account: the row and its tokens go. Pinterest's own list of apps is the owner's to tidy. */
export async function disconnectPinterest(accountId: string, storeId: string): Promise<void> {
  const gone = await db().execute(sql`delete from commerce.pinterest_accounts where store_id = ${storeId}::uuid returning id`);
  if (gone.length > 0) await audit(accountId, storeId, "store.pinterest_disconnected", {});
}

const TARGET = z.object({
  board_id: col.textOrNull,
  access: col.text,
  refresh: col.text,
  expires: col.timestamp,
  refresh_expires: col.timestamp,
  publish: col.bool,
});

/**
 * The board a store's Pins go to with a live token, renewing the token first when it nears its end (the new tokens kept, encrypted); or why
 * it cannot be pinned to, in words.
 */
export async function pinterestTarget(storeId: string, now = new Date(), call: typeof pinterestCall = pinterestCall): Promise<{ boardId: string; token: string } | { problem: string }> {
  const key = encryptionKey();
  if (!key) return { problem: "Publishing is not set up here." };
  const row = await typedRow(
    TARGET,
    sql`select board_id, access_token_encrypted as access, refresh_token_encrypted as refresh, token_expires_at as expires, refresh_expires_at as refresh_expires, publish
      from commerce.pinterest_accounts where store_id = ${storeId}::uuid`,
  );
  if (!row?.board_id) return { problem: "Connect the store's Pinterest account and choose its board first." };
  if (!row.publish) return { problem: "Connect Pinterest again and allow making Pins, so Kaizena Flow may pin for you." };
  if (!renewDue(new Date(row.expires), now)) return { boardId: row.board_id, token: decryptSecret(row.access, key) };
  if (new Date(row.refresh_expires).getTime() <= now.getTime()) return { problem: "The Pinterest connection has run out. Connect it again." };
  const app = pinterestApp();
  if (!app) return { problem: "Kaizena Flow's Pinterest app is not set up here." };
  const kept = { refresh: decryptSecret(row.refresh, key), refreshExpiresAt: new Date(row.refresh_expires) };
  let tokens;
  try {
    tokens = parseTokens(await tokenCall(app, { grant_type: "refresh_token", refresh_token: kept.refresh }, call), now, kept);
  } catch (error) {
    if (!(error instanceof PinterestError)) throw error;
    await db().execute(sql`update commerce.pinterest_accounts set problem = ${error.message.slice(0, 300)}, updated_at = now() where store_id = ${storeId}::uuid`);
    return { problem: error.message };
  }
  if (!tokens) return { problem: "Pinterest did not renew the connection. Connect it again." };
  await db().execute(sql`
    update commerce.pinterest_accounts set access_token_encrypted = ${encryptSecret(tokens.access, key)}, refresh_token_encrypted = ${encryptSecret(tokens.refresh, key)},
      token_expires_at = ${tokens.expiresAt.toISOString()}::timestamptz, refresh_expires_at = ${tokens.refreshExpiresAt.toISOString()}::timestamptz, problem = null, updated_at = now()
    where store_id = ${storeId}::uuid`);
  return { boardId: row.board_id, token: tokens.access };
}

export type PinterestView =
  | { state: "none" }
  | { state: "choose"; choices: BoardChoice[] }
  | { state: "ready"; username: string; board: string; publish: boolean; problem: string | null };

/** What the owner sees of their Pinterest connection: none, boards to choose among, or the board Pins go to. */
export async function pinterestView(storeId: string): Promise<PinterestView> {
  const row = await typedRow(
    z.object({ username: col.text, board_id: col.textOrNull, board: col.text, choices: z.unknown(), publish: col.bool, problem: col.textOrNull }),
    sql`select username, board_id, board_name as board, choices, publish, problem from commerce.pinterest_accounts where store_id = ${storeId}::uuid`,
  );
  if (!row) return { state: "none" };
  if (!row.board_id) return { state: "choose", choices: keptBoards(row.choices) };
  return { state: "ready", username: row.username, board: row.board, publish: row.publish, problem: row.problem };
}

/** The Pinterest account's connection for its routes on Social posts (`src/server/social-connect-routes.ts`). */
export const PINTEREST_CONNECTION: Connection = {
  key: "pinterest",
  cookie: PINTEREST_COOKIE,
  cookiePath: PINTEREST_COOKIE_PATH,
  isPlatformError: (error) => error instanceof PinterestError,
  start: pinterestStart,
  started: pinterestStarted,
  connect: (accountId, storeId, params) => connectPinterest(accountId, storeId, params),
  choose: choosePinterestBoard,
  chooseField: "board",
  disconnect: disconnectPinterest,
  failedStatus: (error) =>
    error instanceof PinterestError && error.reason === "cancelled" ? "cancelled" : error instanceof PinterestError && error.message.includes("no board") ? "noboard" : "failed",
};
