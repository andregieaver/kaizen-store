import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * Kaizen Life for the owner assistant (D96): the other way round from
 * `/api/mcp`. An owner connects their Kaizen Life account with Kaizen
 * Life's own OAuth server (the client Kaizen Store has there), and the
 * store's assistant can then ask Kaizen Life's assistant through Kaizen
 * Life's MCP server. Kaizen Life decides what its assistant does for
 * Kaizen Store; nothing here depends on it being there.
 */

const TIMEOUT_MS = 90_000;
const REFRESH_SKEW_MS = 60_000;

type LifeConfig = { issuer: string; clientId: string; clientSecret: string; mcpUrl: string };

/** Kaizen Life's OAuth server and MCP server, and this store's client there, if set up. */
function lifeConfig(): LifeConfig | null {
  const issuer = process.env.KAIZEN_LIFE_ISSUER?.trim().replace(/\/$/, "");
  const clientId = process.env.KAIZEN_LIFE_OAUTH_CLIENT_ID?.trim();
  const clientSecret = process.env.KAIZEN_LIFE_OAUTH_CLIENT_SECRET?.trim();
  const app = (process.env.KAIZEN_LIFE_URL?.trim() || "https://kaizenlifetracker.com").replace(/\/$/, "");
  if (!issuer || !clientId || !clientSecret || !encryptionKey()) return null;
  return { issuer, clientId, clientSecret, mcpUrl: `${app}/api/mcp` };
}

/** Owners can connect Kaizen Life for the assistant. */
export const lifeLinkOn = () => lifeConfig() !== null;

export const LINK_COOKIE = "kaizen_life_link";
export const LINK_CALLBACK = "/admin/account/kaizen-life/callback";

/** Where the owner is sent to connect, and what the callback must see again (kept in `kaizen_life_link`). */
export function linkStart(accountId: string): { url: string; cookie: string } | null {
  const config = lifeConfig();
  if (!config) return null;
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: `${siteUrl()}${LINK_CALLBACK}`,
    scope: "openid email",
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return { url: `${config.issuer}/oauth/authorize?${params}`, cookie: [state, verifier, accountId].join(".") };
}

export class LifeLinkError extends Error {}

/** The callback: the state checked against the cookie, the code exchanged, the tokens kept for the account. */
export async function linkFinish(accountId: string, cookie: string | undefined, params: URLSearchParams): Promise<void> {
  const config = lifeConfig();
  if (!config) throw new LifeLinkError("Kaizen Life is not set up here.");
  const [state, verifier, forAccount] = (cookie ?? "").split(".");
  if (!state || state !== params.get("state") || forAccount !== accountId) throw new LifeLinkError("The connection could not be checked.");
  const code = params.get("code");
  if (!code) throw new LifeLinkError(params.get("error_description") ?? "Kaizen Life did not connect.");
  const tokens = await tokenRequest(config, {
    grant_type: "authorization_code",
    code,
    redirect_uri: `${siteUrl()}${LINK_CALLBACK}`,
    code_verifier: verifier,
  });
  await saveTokens(accountId, tokens, emailOf(tokens.accessToken));
}

type Tokens = { accessToken: string; refreshToken: string | null; expiresAt: Date | null };

async function tokenRequest(config: LifeConfig, body: Record<string, string>): Promise<Tokens> {
  const response = await fetch(`${config.issuer}/oauth/token`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
      Authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.clientId)}:${encodeURIComponent(config.clientSecret)}`).toString("base64")}`,
    },
    body: new URLSearchParams(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== "string") {
    throw new LifeLinkError(`Kaizen Life refused the connection (${response.status}).`);
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresAt: typeof json.expires_in === "number" ? new Date(Date.now() + json.expires_in * 1000) : null,
  };
}

/** The email in an access token from Kaizen Life's server (read for showing, never trusted for access). */
function emailOf(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as Record<string, unknown>;
    return typeof payload.email === "string" ? payload.email.slice(0, 320) : null;
  } catch {
    return null;
  }
}

async function saveTokens(accountId: string, tokens: Tokens, email: string | null) {
  const key = encryptionKey()!;
  const refresh = tokens.refreshToken ? encryptSecret(tokens.refreshToken, key) : null;
  await db().execute(sql`
    insert into commerce.kaizen_life_links (account_id, access_token, refresh_token, expires_at, life_email)
    values (${accountId}::uuid, ${encryptSecret(tokens.accessToken, key)}, ${refresh}, ${tokens.expiresAt?.toISOString() ?? null}, ${email})
    on conflict (account_id) do update set
      access_token = excluded.access_token,
      refresh_token = coalesce(excluded.refresh_token, commerce.kaizen_life_links.refresh_token),
      expires_at = excluded.expires_at,
      life_email = coalesce(excluded.life_email, commerce.kaizen_life_links.life_email),
      updated_at = now()
  `);
}

export type LifeLink = { email: string | null; since: string };

/** The account's connection, if any. */
export async function lifeLink(accountId: string): Promise<LifeLink | null> {
  const [row] = await db().execute<Row>(sql`
    select life_email, created_at from commerce.kaizen_life_links where account_id = ${accountId}::uuid
  `);
  return row ? { email: row.life_email ? String(row.life_email) : null, since: new Date(String(row.created_at)).toISOString() } : null;
}

/** Forgets the connection: the assistant no longer asks Kaizen Life. */
export async function unlinkLife(accountId: string): Promise<boolean> {
  const rows = await db().execute<Row>(sql`delete from commerce.kaizen_life_links where account_id = ${accountId}::uuid returning account_id`);
  return rows.length > 0;
}

/** A usable access token for the account, refreshed when it is about to run out; null when not connected. */
async function lifeToken(config: LifeConfig, accountId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`
    select access_token, refresh_token, expires_at from commerce.kaizen_life_links where account_id = ${accountId}::uuid
  `);
  if (!row) return null;
  const key = encryptionKey()!;
  const expiresAt = row.expires_at ? new Date(String(row.expires_at)).getTime() : null;
  if (expiresAt === null || expiresAt > Date.now() + REFRESH_SKEW_MS) return decryptSecret(String(row.access_token), key);
  if (!row.refresh_token) throw new LifeLinkError("The connection to Kaizen Life has run out: connect it again under Your account.");
  const tokens = await tokenRequest(config, { grant_type: "refresh_token", refresh_token: decryptSecret(String(row.refresh_token), key) }).catch(() => {
    throw new LifeLinkError("Kaizen Life no longer accepts the connection: connect it again under Your account.");
  });
  await saveTokens(accountId, tokens, null);
  return tokens.accessToken;
}

/**
 * Asks Kaizen Life's assistant, for the owner (its `ask_life_assistant`
 * tool). What comes back is Kaizen Life's answer, in words; the store's
 * assistant passes it on as said.
 */
export async function askLife(accountId: string, question: string, storeName: string): Promise<string> {
  const config = lifeConfig();
  if (!config) throw new LifeLinkError("Kaizen Life is not set up here.");
  const token = await lifeToken(config, accountId);
  if (!token) throw new LifeLinkError("Kaizen Life is not connected: the owner connects it under Your account.");
  const response = await fetch(config.mcpUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "ask_life_assistant", arguments: { question: question.slice(0, 4000), from: storeName } },
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (response.status === 401) throw new LifeLinkError("Kaizen Life no longer accepts the connection: connect it again under Your account.");
  if (!response.ok) throw new LifeLinkError(`Kaizen Life did not answer (${response.status}).`);
  const rpc = readRpc(await response.text());
  if (rpc.error) throw new LifeLinkError(`Kaizen Life said: ${String(rpc.error.message ?? "an error")}`);
  const text = (rpc.result?.content ?? []).flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : [])).join("\n");
  if (rpc.result?.isError) throw new LifeLinkError(`Kaizen Life said: ${text.slice(0, 500) || "an error"}`);
  return text.slice(0, 8000);
}

type Rpc = { result?: { content?: { type?: string; text?: unknown }[]; isError?: boolean }; error?: { message?: unknown } };

/** One JSON-RPC answer, sent as JSON or as an event stream. */
export function readRpc(body: string): Rpc {
  const trimmed = body.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed) as Rpc;
  for (const line of trimmed.split("\n").reverse()) {
    const data = line.trim().startsWith("data:") ? line.trim().slice(5).trim() : "";
    if (!data) continue;
    try {
      return JSON.parse(data) as Rpc;
    } catch {
      // A keep-alive or a partial frame: look further up.
    }
  }
  throw new LifeLinkError("Kaizen Life's answer could not be read.");
}
