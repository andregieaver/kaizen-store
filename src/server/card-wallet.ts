import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  accessDue,
  AIRWALLEX_HOSTS,
  cardholdersOf,
  cardholdersSchema,
  openWalletState,
  sealWalletState,
  tokenAnswerSchema,
  walletAuthorizeUrl,
  walletNonce,
  type Cardholder,
  type WalletFacts,
  type WalletMode,
} from "@/lib/card-wallet";
import { airwallexEnv } from "@/lib/env";
import { parseAmount } from "@/lib/field-money";
import { mainCurrency } from "@/lib/markets";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { audit, type Membership } from "./auth";
import { encryptionKey } from "./encryption-key";
import { log } from "./log";
import { checkPermission, memberCan } from "./permissions";
import { col, typedRow } from "./typed-rows";

/**
 * The AI's card wallet (D599, step 2 of `docs/agent-spending.md`): the only writer of `commerce.card_wallets` and the only holder of the
 * owner's Airwallex grant. The owner connects their own Airwallex account by approving Kaizena Flow's partner app (OAuth; the access token
 * lives five minutes, the refresh token 90 days and turns over at every refresh, so a refresh happens under the row's lock), chooses whose
 * Airwallex app the cards appear in, sets what they may take in a month, and can pause them. Tokens are encrypted and leave this module only
 * in a request's header. Owner only (checked here and by the actions). Kaizena Flow's own wallet is its house store's.
 */

const OWNER = "owner" as const;

type Answer = { ok: boolean; status: number; json(): Promise<unknown> };
/** `fetch`, or a stand-in in tests. */
export type WalletFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<Answer>;
export type WalletDeps = { fetcher?: WalletFetch; now?: () => Date; app?: ReturnType<typeof airwallexEnv> };
const realFetch: WalletFetch = (url, init) => fetch(url, init);

function walletApp(deps: WalletDeps = {}): ReturnType<typeof airwallexEnv> {
  if (deps.app !== undefined) return deps.app;
  try {
    return airwallexEnv();
  } catch (error) {
    log("error", "card_wallet.app_misconfigured", {}, error);
    return null;
  }
}

/** Whether connecting is offered: Kaizena Flow's partner app is configured and secrets can be kept. */
export const walletOffered = (deps: WalletDeps = {}): boolean => walletApp(deps) !== null && encryptionKey() !== null;
export const walletRedirectUri = (): string => `${siteUrl()}/api/integrations/airwallex/callback`;

/** The wallet as the page shows it: never a token. */
export type CardWallet = WalletFacts & { id: string; mode: WalletMode; accountId: string; cardholderName: string | null };

const walletRow = z.object({
  id: col.uuid,
  mode: z.enum(["sandbox", "live"]),
  account_id: col.text,
  state: z.enum(["choose", "on", "auth_failed"]),
  paused: col.bool,
  currency: col.currency,
  monthly_limit_minor: col.minorOrNull,
  cardholder_id: col.textOrNull,
  cardholder_name: col.textOrNull,
});

export async function getWallet(storeId: string): Promise<CardWallet | null> {
  const row = await typedRow(
    walletRow,
    sql`select id, mode, account_id, state, paused, currency, monthly_limit_minor, cardholder_id, cardholder_name from commerce.card_wallets where store_id = ${storeId}::uuid`,
  );
  return row
    ? {
        id: row.id,
        mode: row.mode,
        accountId: row.account_id,
        state: row.state,
        paused: row.paused,
        currency: row.currency,
        limitMinor: row.monthly_limit_minor,
        cardholderId: row.cardholder_id,
        cardholderName: row.cardholder_name,
      }
    : null;
}

// ---------------------------------------------------------------------------------------------------------------------
// Tokens and calls
// ---------------------------------------------------------------------------------------------------------------------

type Tokens = { access: string; accessExpiresAt: Date | null; refresh: string | null; refreshExpiresAt: Date | null; accountId: string | null };
type TokenRefusal = { grant: boolean; status: number | null };

async function tokenCall(mode: WalletMode, form: Record<string, string>, deps: WalletDeps): Promise<{ ok: true; tokens: Tokens } | { ok: false; refusal: TokenRefusal }> {
  const app = walletApp(deps);
  if (!app) return { ok: false, refusal: { grant: false, status: null } };
  const now = (deps.now ?? (() => new Date()))().getTime();
  let answer: Answer;
  try {
    answer = await (deps.fetcher ?? realFetch)(AIRWALLEX_HOSTS[mode].token, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ ...form, client_id: app.clientId, client_secret: app.clientSecret }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    log("warn", "card_wallet.token_unreachable", {}, error);
    return { ok: false, refusal: { grant: false, status: null } };
  }
  const body = await answer.json().catch(() => null);
  if (!answer.ok) {
    // A refused grant (400 invalid_grant, 401) means the owner has to connect again; anything else may be tried later.
    return { ok: false, refusal: { grant: answer.status === 400 || answer.status === 401, status: answer.status } };
  }
  const parsed = tokenAnswerSchema.safeParse(body);
  if (!parsed.success) return { ok: false, refusal: { grant: false, status: answer.status } };
  const t = parsed.data;
  return {
    ok: true,
    tokens: {
      access: t.access_token,
      accessExpiresAt: t.expires_in ? new Date(now + t.expires_in * 1000) : null,
      refresh: t.refresh_token ?? null,
      refreshExpiresAt: t.refresh_token_expires_in ? new Date(now + t.refresh_token_expires_in * 1000) : null,
      accountId: t.account_id ?? null,
    },
  };
}

/** Why there is no token: no wallet, Airwallex refused the refresh (connect again), or Airwallex could not be asked. */
export type AccessProblem = "not_connected" | "grant_refused" | "unreachable";

/** A working access token: the kept one while it lasts, else a refresh under the row's lock, so two runs never spend one refresh token. */
async function walletAccess(storeId: string, deps: WalletDeps): Promise<{ ok: true; token: string; mode: WalletMode } | { ok: false; problem: AccessProblem }> {
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "not_connected" };
  const now = (deps.now ?? (() => new Date()))();
  return db().transaction(async (tx) => {
    const row = await typedRow(
      z.object({
        mode: z.enum(["sandbox", "live"]),
        access_token_encrypted: col.text,
        access_expires_at: col.timestampOrNull,
        refresh_token_encrypted: col.textOrNull,
        state: col.text,
      }),
      sql`select mode, access_token_encrypted, access_expires_at, refresh_token_encrypted, state from commerce.card_wallets where store_id = ${storeId}::uuid for update`,
      tx,
    );
    if (!row || row.state === "auth_failed") return { ok: false, problem: row ? "grant_refused" : "not_connected" } as const;
    let access: string;
    try {
      access = decryptSecret(row.access_token_encrypted, key);
    } catch (error) {
      log("error", "card_wallet.token_unreadable", { storeId }, error);
      return { ok: false, problem: "not_connected" } as const;
    }
    const expires = row.access_expires_at ? new Date(row.access_expires_at) : null;
    if (!accessDue(expires, now.getTime())) return { ok: true, token: access, mode: row.mode } as const;
    if (!row.refresh_token_encrypted) {
      await tx.execute(sql`update commerce.card_wallets set state = 'auth_failed', updated_at = now() where store_id = ${storeId}::uuid`);
      return { ok: false, problem: "grant_refused" } as const;
    }
    const refreshed = await tokenCall(row.mode, { grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh_token_encrypted, key) }, deps);
    if (!refreshed.ok) {
      if (refreshed.refusal.grant) {
        await tx.execute(sql`update commerce.card_wallets set state = 'auth_failed', updated_at = now() where store_id = ${storeId}::uuid`);
        log("warn", "card_wallet.refresh_refused", { storeId, status: refreshed.refusal.status });
        return { ok: false, problem: "grant_refused" } as const;
      }
      return { ok: false, problem: "unreachable" } as const;
    }
    const t = refreshed.tokens;
    await tx.execute(sql`
      update commerce.card_wallets
         set access_token_encrypted = ${encryptSecret(t.access, key)}, access_expires_at = ${t.accessExpiresAt?.toISOString() ?? null}::timestamptz,
             refresh_token_encrypted = coalesce(${t.refresh ? encryptSecret(t.refresh, key) : null}, refresh_token_encrypted),
             refresh_expires_at = coalesce(${t.refreshExpiresAt?.toISOString() ?? null}::timestamptz, refresh_expires_at), updated_at = now()
       where store_id = ${storeId}::uuid
    `);
    return { ok: true, token: t.access, mode: row.mode } as const;
  });
}

/** A call that did not give what was asked: Airwallex refused it (its error code, never its words), did not answer, or answered otherwise. */
export type CallProblem = { problem: "refused" | "unreachable" | "shape" | AccessProblem; status?: number | null; code?: string | null };

const errorCode = z.object({ code: z.string().max(80) });

/** One call to Airwallex's API on the store's grant, its answer read with `schema`. */
export async function walletCall<S extends z.ZodType>(
  storeId: string,
  method: "GET" | "POST",
  path: string,
  schema: S,
  body: Record<string, unknown> | null = null,
  deps: WalletDeps = {},
): Promise<{ ok: true; value: z.output<S> } | ({ ok: false } & CallProblem)> {
  const access = await walletAccess(storeId, deps);
  if (!access.ok) return { ok: false, problem: access.problem };
  let answer: Answer;
  try {
    answer = await (deps.fetcher ?? realFetch)(`${AIRWALLEX_HOSTS[access.mode].api}${path}`, {
      method,
      headers: { Authorization: `Bearer ${access.token}`, Accept: "application/json", ...(body && { "Content-Type": "application/json" }) },
      ...(body && { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    log("warn", "card_wallet.unreachable", { path: path.split("?")[0].replace(/\/[^/]*\d[^/]*/g, "/#") }, error);
    return { ok: false, problem: "unreachable" };
  }
  const parsedBody = await answer.json().catch(() => null);
  if (!answer.ok) {
    const code = errorCode.safeParse(parsedBody).data?.code ?? null;
    log("warn", "card_wallet.refused", { status: answer.status, code });
    if (answer.status === 401) await db().execute(sql`update commerce.card_wallets set state = 'auth_failed', updated_at = now() where store_id = ${storeId}::uuid`);
    return { ok: false, problem: answer.status === 401 ? "grant_refused" : "refused", status: answer.status, code };
  }
  const parsed = schema.safeParse(parsedBody);
  if (!parsed.success) {
    log("warn", "card_wallet.shape", { path: path.split("?")[0].replace(/\/[^/]*\d[^/]*/g, "/#") });
    return { ok: false, problem: "shape", status: answer.status };
  }
  return { ok: true, value: parsed.data };
}

// ---------------------------------------------------------------------------------------------------------------------
// Connect: Airwallex's consent page and back
// ---------------------------------------------------------------------------------------------------------------------

/** The press (owner only): a fresh nonce sealed with the store and the account for the cookie, and Airwallex's page. */
export async function startWalletConnect(member: Membership, deps: WalletDeps = {}): Promise<{ ok: true; url: string; cookie: string } | { ok: false; problem: "off" | "forbidden" }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const app = walletApp(deps);
  const key = encryptionKey();
  if (!app || !key) return { ok: false, problem: "off" };
  const value = { state: walletNonce(), store: member.store.slug, account: member.account.id };
  return {
    ok: true,
    cookie: sealWalletState(key, value, (deps.now ?? (() => new Date()))().getTime()),
    url: walletAuthorizeUrl({ mode: app.mode, clientId: app.clientId, redirectUri: walletRedirectUri(), state: value.state }),
  };
}

export type WalletConnectOutcome = "connected" | "choose" | "declined" | "failed";

/** Where the wallet is shown: the store's Autopilot settings. */
export const walletPage = (storeSlug: string) => `/admin/${storeSlug}/assistant/autopilot?tab=settings`;

/**
 * Airwallex's return to `/api/integrations/airwallex/callback`: the state checked against the cookie and the owner signed in now the one who
 * pressed; the code exchanged, the grant kept encrypted, and the cardholders read: one ready cardholder is chosen at once, several are offered
 * to the owner. A reconnect keeps the limit, the pause and a cardholder still there. The answer is the admin page to go back to.
 */
export async function finishWalletConnect(
  params: URLSearchParams,
  cookie: string | undefined,
  deps: WalletDeps & { owner?: (storeSlug: string) => Promise<Membership | null> } = {},
): Promise<string> {
  const key = encryptionKey();
  const app = walletApp(deps);
  const now = (deps.now ?? (() => new Date()))();
  const state = key ? openWalletState(key, cookie, now.getTime()) : null;
  if (!key || !app || !state) return "/admin";
  const back = (outcome: WalletConnectOutcome) => `${walletPage(state.store)}&wallet=${outcome}`;
  if (params.get("state") !== state.state) return back("failed");
  if (params.get("error")) return back("declined");
  const code = params.get("code");
  if (!code || code.length > 2000) return back("failed");
  const member = await (deps.owner ?? ((slug: string) => checkPermission(slug, OWNER)))(state.store);
  if (!member || member.account.id !== state.account) return back("failed");
  const exchanged = await tokenCall(app.mode, { grant_type: "authorization_code", code, redirect_uri: walletRedirectUri() }, deps);
  if (!exchanged.ok || !exchanged.tokens.accountId) {
    log("warn", "card_wallet.code_refused", { storeId: member.store.id, status: exchanged.ok ? null : exchanged.refusal.status });
    return back("failed");
  }
  const t = exchanged.tokens;
  const before = await getWallet(member.store.id);
  // Another Airwallex account, or the other mode, starts afresh: its cardholders and currency are not the old one's.
  const same = before !== null && before.accountId === t.accountId && before.mode === app.mode;
  await db().execute(sql`
    insert into commerce.card_wallets (store_id, provider, mode, account_id, access_token_encrypted, access_expires_at, refresh_token_encrypted, refresh_expires_at,
      currency, state, updated_by)
    values (${member.store.id}::uuid, 'airwallex', ${app.mode}, ${t.accountId}, ${encryptSecret(t.access, key)}, ${t.accessExpiresAt?.toISOString() ?? null}::timestamptz,
      ${t.refresh ? encryptSecret(t.refresh, key) : null}, ${t.refreshExpiresAt?.toISOString() ?? null}::timestamptz, ${mainCurrency(member.store)}, 'choose', ${member.account.id}::uuid)
    on conflict (store_id) do update set
      mode = excluded.mode, account_id = excluded.account_id, access_token_encrypted = excluded.access_token_encrypted, access_expires_at = excluded.access_expires_at,
      refresh_token_encrypted = excluded.refresh_token_encrypted, refresh_expires_at = excluded.refresh_expires_at, updated_by = excluded.updated_by, updated_at = now(),
      state = case when ${same} and commerce.card_wallets.cardholder_id is not null then 'on' else 'choose' end,
      cardholder_id = case when ${same} then commerce.card_wallets.cardholder_id end,
      cardholder_name = case when ${same} then commerce.card_wallets.cardholder_name end,
      monthly_limit_minor = case when ${same} then commerce.card_wallets.monthly_limit_minor end,
      currency = case when ${same} then commerce.card_wallets.currency else excluded.currency end
  `);
  await audit(member.account.id, member.store.id, "ai.wallet_connected", { provider: "airwallex", mode: app.mode, reconnected: same });
  const holders = await listCardholders(member.store.id, deps);
  const ready = holders.ok ? holders.cardholders.filter((c) => c.active) : [];
  const kept = same && before?.cardholderId ? ready.find((c) => c.id === before.cardholderId) : undefined;
  if (kept) return back("connected");
  if (ready.length === 1) {
    const chosen = await chooseCardholder(member.store.id, member.account.id, ready[0].id, deps);
    return back(chosen.ok ? "connected" : "choose");
  }
  return back("choose");
}

/** The people in the owner's Airwallex account cards may be made for. */
export async function listCardholders(storeId: string, deps: WalletDeps = {}): Promise<{ ok: true; cardholders: Cardholder[] } | ({ ok: false } & CallProblem)> {
  const answer = await walletCall(storeId, "GET", "/api/v1/issuing/cardholders?page_size=100", cardholdersSchema, null, deps);
  return answer.ok ? { ok: true, cardholders: cardholdersOf(answer.value) } : answer;
}

/** Whose Airwallex app the cards appear in: one of the account's ready cardholders. The wallet is on from then. */
export async function chooseCardholder(storeId: string, actorId: string, cardholderId: string, deps: WalletDeps = {}): Promise<{ ok: true } | { ok: false; problem: "not_connected" | "unknown" | "unreachable" }> {
  const holders = await listCardholders(storeId, deps);
  if (!holders.ok) return { ok: false, problem: holders.problem === "not_connected" || holders.problem === "grant_refused" ? "not_connected" : "unreachable" };
  const chosen = holders.cardholders.find((c) => c.id === cardholderId && c.active);
  if (!chosen) return { ok: false, problem: "unknown" };
  await db().execute(sql`
    update commerce.card_wallets set cardholder_id = ${chosen.id}, cardholder_name = ${chosen.name}, state = 'on', updated_by = ${actorId}::uuid, updated_at = now()
     where store_id = ${storeId}::uuid
  `);
  await audit(actorId, storeId, "ai.wallet_cardholder_chosen", { provider: "airwallex" });
  return { ok: true };
}

/** What the AI's cards may take in a calendar month, typed in the wallet's currency; empty takes the limit away (no card can then be made). */
export async function setWalletLimit(storeId: string, actorId: string, text: string): Promise<{ ok: true } | { ok: false; problem: "not_connected" | "amount" }> {
  const wallet = await getWallet(storeId);
  if (!wallet) return { ok: false, problem: "not_connected" };
  const limit = text.trim() === "" ? null : parseAmount(text.replace(/\s/g, ""), wallet.currency);
  if (text.trim() !== "" && (limit === null || limit > 100_000_000_000)) return { ok: false, problem: "amount" };
  await db().execute(sql`update commerce.card_wallets set monthly_limit_minor = ${limit}, updated_by = ${actorId}::uuid, updated_at = now() where store_id = ${storeId}::uuid`);
  await audit(actorId, storeId, "ai.wallet_limit_set", { limitMinor: limit, currency: wallet.currency });
  return { ok: true };
}

/** The owner's switch: paused, no card is made (the caller closes the open ones, `closeOpenCards()`). */
export async function setWalletPaused(storeId: string, actorId: string, paused: boolean): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.card_wallets set paused = ${paused}, updated_by = ${actorId}::uuid, updated_at = now() where store_id = ${storeId}::uuid returning 1
  `);
  if (rows.length > 0) await audit(actorId, storeId, paused ? "ai.wallet_paused" : "ai.wallet_resumed", {});
  return rows.length > 0;
}

/** Forgets the grant (the caller closes the open cards first). Past purchases stay, without their wallet. */
export async function forgetWallet(storeId: string, actorId: string): Promise<void> {
  const rows = await db().execute(sql`delete from commerce.card_wallets where store_id = ${storeId}::uuid returning 1`);
  if (rows.length > 0) await audit(actorId, storeId, "ai.wallet_disconnected", { provider: "airwallex" });
}

/** Where the owner opens their cards in Airwallex's own app. */
export const airwallexCardsLink = (mode: WalletMode) => `${AIRWALLEX_HOSTS[mode].app}/cards`;
