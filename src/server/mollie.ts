import "server-only";

import { randomBytes } from "node:crypto";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  MOLLIE_API,
  MOLLIE_CALLBACK,
  MOLLIE_IDS,
  MOLLIE_REVOKE,
  MOLLIE_SCOPES,
  MOLLIE_TOKENS,
  mollieAuthorizeUrl,
  type MollieAmount,
} from "@/lib/mollie";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";
import type { PaymentModeName } from "@/lib/stripe-account";

import { audit } from "./auth";
import { encryptionKey } from "./settings";

type Row = Record<string, unknown>;

/**
 * Kaizena Flow's Mollie app and a store's connection to it (wave 4 unit E2, D292, `docs/wave-4-payments.md` 7). The owner approves Kaizena Flow at Mollie
 * (OAuth, `MOLLIE_SCOPES`); Kaizena Flow keeps the refresh token encrypted and makes access tokens from it as they are needed (an hour each). Every call to
 * Mollie for a store goes through `mollieCall()` with the store's token; test payments are the same connection with Mollie's `testmode`. Without the app's
 * keys (`MOLLIE_CLIENT_ID`, `MOLLIE_CLIENT_SECRET`) or `SETTINGS_ENCRYPTION_KEY`, Mollie is not offered. Nothing here is ever sent to the browser.
 */

const TIMEOUT_MS = 10_000;

/** The fetch Mollie is called with: the real one, or a recorded fake in tests (`setMollieFetch()`). */
let fetcher: typeof fetch = (input, init) => fetch(input, init);
export function setMollieFetch(fake: typeof fetch | null): void {
  fetcher = fake ?? ((input, init) => fetch(input, init));
}

type MollieApp = { clientId: string; clientSecret: string; key: Buffer };

function mollieApp(): MollieApp | null {
  const clientId = process.env.MOLLIE_CLIENT_ID?.trim();
  const clientSecret = process.env.MOLLIE_CLIENT_SECRET?.trim();
  const key = encryptionKey();
  if (!clientId || !clientSecret || !key) return null;
  return { clientId, clientSecret, key };
}

/** Kaizena Flow's Mollie app is set up, so owners can connect Mollie. */
export const mollieAppOn = () => mollieApp() !== null;

/** Mollie answered with an error, or could not be reached: `message` is a sentence for staff. */
export class MollieError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
  ) {
    super(message);
  }
}

/** Where the owner is sent to approve Kaizena Flow at Mollie, and what the callback must see again (kept in `kaizen_mollie_connect`). */
export function mollieStart(storeSlug: string, accountId: string): { url: string; cookie: string } | null {
  const app = mollieApp();
  if (!app) return null;
  const state = randomBytes(24).toString("base64url");
  return {
    url: mollieAuthorizeUrl({ clientId: app.clientId, redirectUri: `${siteUrl()}${MOLLIE_CALLBACK}`, state }),
    cookie: [state, storeSlug, accountId].join("."),
  };
}

/** Who started connecting, from the cookie; checked against the state Mollie sends back. */
export function mollieStarted(cookie: string | undefined, params: URLSearchParams): { storeSlug: string; accountId: string } {
  const [state, storeSlug, accountId] = (cookie ?? "").split(".");
  if (!state || !storeSlug || !accountId || state !== params.get("state")) throw new MollieError("The connection could not be checked.");
  return { storeSlug, accountId };
}

type Tokens = { accessToken: string; refreshToken: string | null; expiresIn: number; scope: string };

async function tokenRequest(app: MollieApp, body: Record<string, string>): Promise<Tokens> {
  let response: Response;
  try {
    response = await fetcher(MOLLIE_TOKENS, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(body),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MollieError("Mollie could not be reached.");
  }
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok || typeof json.access_token !== "string") {
    throw new MollieError(typeof json.error_description === "string" ? `Mollie said: ${json.error_description}` : "Mollie did not connect.", response.status);
  }
  return {
    accessToken: json.access_token,
    refreshToken: typeof json.refresh_token === "string" ? json.refresh_token : null,
    expiresIn: typeof json.expires_in === "number" ? json.expires_in : 3600,
    scope: typeof json.scope === "string" ? json.scope : "",
  };
}

/** A call to Mollie's API with a token. `testmode` is added for a test payment's calls (Mollie's way with an OAuth token). */
async function call<T>(
  token: string,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { body?: Record<string, unknown>; query?: Record<string, string>; idempotencyKey?: string } = {},
): Promise<T> {
  const url = new URL(`${MOLLIE_API}${path}`);
  for (const [key, value] of Object.entries(options.query ?? {})) url.searchParams.set(key, value);
  let response: Response;
  try {
    response = await fetcher(url.toString(), {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    throw new MollieError("Mollie could not be reached.");
  }
  if (response.status === 204) return undefined as T;
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) throw new MollieError(typeof json.detail === "string" ? `Mollie said: ${json.detail}` : "Mollie refused.", response.status);
  return json as T;
}

/**
 * Back from Mollie with the owner's approval: the code is swapped for tokens, the organisation and its first website profile are read, and the connection
 * is kept (the refresh token encrypted). A store that connects again replaces its connection.
 */
export async function connectMollie(storeId: string, accountId: string, params: URLSearchParams): Promise<{ organization: string; profile: string }> {
  const app = mollieApp();
  if (!app) throw new MollieError("Kaizena Flow's Mollie app is not set up here.");
  if (params.get("error")) throw new MollieError(params.get("error_description") ?? "Cancelled at Mollie.");
  const code = params.get("code");
  if (!code) throw new MollieError("Mollie did not connect.");
  const tokens = await tokenRequest(app, { grant_type: "authorization_code", code, redirect_uri: `${siteUrl()}${MOLLIE_CALLBACK}` });
  if (!tokens.refreshToken) throw new MollieError("Mollie gave no lasting access.");
  const organization = await call<{ id: string; name?: string }>(tokens.accessToken, "GET", "/organizations/me");
  const profiles = await call<{ _embedded?: { profiles?: { id: string; name?: string; status?: string }[] } }>(tokens.accessToken, "GET", "/profiles", { query: { limit: "50" } });
  const profile = (profiles._embedded?.profiles ?? []).find((p) => p.status !== "blocked" && MOLLIE_IDS.profile.test(p.id));
  if (!MOLLIE_IDS.organization.test(organization.id)) throw new MollieError("Mollie gave no organisation.");
  if (!profile) throw new MollieError("The Mollie account has no website profile yet. Add one in Mollie, then connect again.");
  await db().execute(sql`
    insert into commerce.mollie_connections (store_id, organization_id, organization_name, profile_id, profile_name, scopes, refresh_token, access_token,
      access_expires_at, connected_at, connected_by, revoked_at)
    values (${storeId}::uuid, ${organization.id}, ${organization.name?.slice(0, 200) ?? null}, ${profile.id}, ${profile.name?.slice(0, 200) ?? null},
      ${tokens.scope || MOLLIE_SCOPES.join(" ")}, ${encryptSecret(tokens.refreshToken, app.key)}, ${encryptSecret(tokens.accessToken, app.key)},
      now() + make_interval(secs => ${Math.max(60, tokens.expiresIn - 60)}), now(), ${accountId}::uuid, null)
    on conflict (store_id) do update set organization_id = excluded.organization_id, organization_name = excluded.organization_name,
      profile_id = excluded.profile_id, profile_name = excluded.profile_name, scopes = excluded.scopes, refresh_token = excluded.refresh_token,
      access_token = excluded.access_token, access_expires_at = excluded.access_expires_at, connected_at = now(), connected_by = excluded.connected_by,
      revoked_at = null
  `);
  await audit(accountId, storeId, "payments.mollie_connected", { organization: organization.id, profile: profile.id });
  return { organization: organization.id, profile: profile.id };
}

/** A store's Mollie connection as staff see it (never a token). */
export type MollieConnection = { organizationId: string; organizationName: string | null; profileId: string; profileName: string | null; connectedAt: string };

export async function mollieConnection(storeId: string): Promise<MollieConnection | null> {
  const [row] = await db().execute<Row>(sql`
    select organization_id, organization_name, profile_id, profile_name, connected_at from commerce.mollie_connections
    where store_id = ${storeId}::uuid and revoked_at is null
  `);
  return row
    ? {
        organizationId: String(row.organization_id),
        organizationName: row.organization_name ? String(row.organization_name) : null,
        profileId: String(row.profile_id),
        profileName: row.profile_name ? String(row.profile_name) : null,
        connectedAt: new Date(String(row.connected_at)).toISOString(),
      }
    : null;
}

/** An access token for the store's Mollie account: the one kept while it lasts, else a new one made from the refresh token. Null: not connected. */
async function accessToken(storeId: string, refused = false): Promise<{ token: string; profileId: string } | null> {
  const app = mollieApp();
  if (!app) return null;
  const [row] = await db().execute<Row>(sql`
    select profile_id, refresh_token, access_token, access_expires_at > now() as fresh from commerce.mollie_connections
    where store_id = ${storeId}::uuid and revoked_at is null
  `);
  if (!row) return null;
  const profileId = String(row.profile_id);
  // A token Mollie just refused (`refused`) is not used again, however fresh its time says it is.
  if (row.fresh && row.access_token && !refused) {
    try {
      return { token: decryptSecret(String(row.access_token), app.key), profileId };
    } catch {
      // Kept with another key: a new one is made below.
    }
  }
  const refresh = decryptSecret(String(row.refresh_token), app.key);
  const tokens = await tokenRequest(app, { grant_type: "refresh_token", refresh_token: refresh });
  await db().execute(sql`
    update commerce.mollie_connections set access_token = ${encryptSecret(tokens.accessToken, app.key)},
      access_expires_at = now() + make_interval(secs => ${Math.max(60, tokens.expiresIn - 60)}),
      refresh_token = ${tokens.refreshToken ? encryptSecret(tokens.refreshToken, app.key) : sql`refresh_token`}
    where store_id = ${storeId}::uuid
  `);
  return { token: tokens.accessToken, profileId };
}

/**
 * A call to Mollie for a store, in a mode: with the store's token, and `testmode` for test payments (a query on reads, a field on writes). Throws
 * `MollieError` when the store is not connected or Mollie refuses.
 */
export async function mollieCall<T>(
  storeId: string,
  mode: PaymentModeName,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options: { body?: Record<string, unknown>; query?: Record<string, string>; idempotencyKey?: string } = {},
): Promise<T> {
  const access = await accessToken(storeId);
  if (!access) throw new MollieError("Mollie is not connected for this store.");
  const test = mode === "test";
  // Mollie takes `testmode` in the body of a write or a cancel, and in the query of a read.
  const write = method !== "GET";
  const send = (token: string) =>
    call<T>(token, method, path, {
      ...options,
      ...(write && test ? { body: { ...(options.body ?? {}), testmode: true } } : {}),
      ...(!write && test ? { query: { ...(options.query ?? {}), testmode: "true" } } : {}),
    });
  try {
    return await send(access.token);
  } catch (error) {
    // Mollie refused the token before its time was up (revoked, or ended early): a new one from the refresh token, and the call once more
    // (PSI DATA-03). A 401 changed nothing at Mollie, so asking again is safe; a second refusal is the store's to reconnect.
    if (!(error instanceof MollieError) || error.status !== 401) throw error;
    const renewed = await accessToken(storeId, true);
    if (!renewed) throw error;
    return send(renewed.token);
  }
}

/** The website profile a store's payments are made on. */
export async function mollieProfile(storeId: string): Promise<string | null> {
  const [row] = await db().execute<Row>(sql`select profile_id from commerce.mollie_connections where store_id = ${storeId}::uuid and revoked_at is null`);
  return row ? String(row.profile_id) : null;
}

/** Mollie's methods active for the store's profile and an amount (Mollie lists those that suit it), or null when Mollie could not be asked. */
export async function activeMollieMethods(storeId: string, mode: PaymentModeName, amount: MollieAmount, locale?: string): Promise<{ id: string; description: string }[] | null> {
  const profileId = await mollieProfile(storeId);
  if (!profileId) return null;
  try {
    const listed = await mollieCall<{ _embedded?: { methods?: { id: string; description?: string; status?: string }[] } }>(storeId, mode, "GET", "/methods", {
      query: { profileId, "amount[value]": amount.value, "amount[currency]": amount.currency, ...(locale ? { locale } : {}) },
    });
    return (listed._embedded?.methods ?? []).filter((m) => typeof m.id === "string").map((m) => ({ id: m.id, description: m.description ?? m.id }));
  } catch {
    return null;
  }
}

/** Every method Mollie has for the profile, active or not, with its status, for the Payments page. */
export async function mollieMethodStates(storeId: string, mode: PaymentModeName, currency: string): Promise<{ id: string; description: string; status: string | null }[] | null> {
  const profileId = await mollieProfile(storeId);
  if (!profileId) return null;
  try {
    const listed = await mollieCall<{ _embedded?: { methods?: { id: string; description?: string; status?: string | null }[] } }>(storeId, mode, "GET", "/methods/all", {
      query: { profileId, "amount[value]": "10.00", "amount[currency]": currency },
    });
    return (listed._embedded?.methods ?? []).map((m) => ({ id: m.id, description: m.description ?? m.id, status: m.status ?? null }));
  } catch {
    return null;
  }
}

/** Asks Mollie to switch a method on for the store's profile (`profiles.write`); false when Mollie needs the merchant to do it. */
export async function activateMollieMethod(storeId: string, accountId: string, method: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (!/^[a-z0-9_]{2,40}$/.test(method)) return { ok: false, problem: "That is not a Mollie method." };
  const profileId = await mollieProfile(storeId);
  if (!profileId) return { ok: false, problem: "Mollie is not connected for this store." };
  try {
    await mollieCall(storeId, "live", "POST", `/profiles/${profileId}/methods/${method}`);
  } catch (error) {
    return { ok: false, problem: error instanceof MollieError ? `${error.message} Switch it on in your Mollie Dashboard.` : "Mollie could not be asked." };
  }
  await audit(accountId, storeId, "payments.mollie_method_activated", { method });
  return { ok: true };
}

/** Ends the store's Mollie connection: the token is revoked at Mollie (best effort) and forgotten here; the checkout goes back to Stripe. */
export async function disconnectMollie(storeId: string, accountId: string): Promise<void> {
  const app = mollieApp();
  const [row] = await db().execute<Row>(sql`select refresh_token from commerce.mollie_connections where store_id = ${storeId}::uuid and revoked_at is null`);
  if (app && row) {
    try {
      await fetcher(MOLLIE_REVOKE, {
        method: "DELETE",
        headers: {
          Authorization: `Basic ${Buffer.from(`${app.clientId}:${app.clientSecret}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ token_type_hint: "refresh_token", token: decryptSecret(String(row.refresh_token), app.key) }),
        redirect: "error",
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch {
      // Revoked here either way: Kaizena Flow forgets the token below.
    }
  }
  await db().transaction(async (tx) => {
    await tx.execute(sql`
      update commerce.mollie_connections set revoked_at = now(), access_token = null, access_expires_at = null, refresh_token = 'revoked'
      where store_id = ${storeId}::uuid and revoked_at is null
    `);
    await tx.execute(sql`delete from commerce.checkout_providers where store_id = ${storeId}::uuid and provider = 'mollie'`);
  });
  await audit(accountId, storeId, "payments.mollie_disconnected", {});
}

/** The provider a store's checkout uses in a mode: Mollie only while it is chosen and connected; Stripe otherwise (D292). */
export async function checkoutProviderOf(storeId: string, mode: PaymentModeName): Promise<"stripe" | "mollie"> {
  const [row] = await db().execute<Row>(sql`
    select 1 from commerce.checkout_providers c
    join commerce.mollie_connections m on m.store_id = c.store_id and m.revoked_at is null
    where c.store_id = ${storeId}::uuid and c.mode = ${mode}::commerce.payment_mode and c.provider = 'mollie'
  `);
  return row && mollieAppOn() ? "mollie" : "stripe";
}

/** The owner's choice of provider per mode; Mollie is refused while it is not connected. */
export async function chooseCheckoutProvider(storeId: string, accountId: string, mode: PaymentModeName, provider: "stripe" | "mollie"): Promise<{ ok: true } | { ok: false; problem: string }> {
  if (provider === "mollie" && !(await mollieConnection(storeId))) return { ok: false, problem: "Connect Mollie first." };
  if (provider === "stripe") {
    await db().execute(sql`delete from commerce.checkout_providers where store_id = ${storeId}::uuid and mode = ${mode}::commerce.payment_mode`);
  } else {
    await db().execute(sql`
      insert into commerce.checkout_providers (store_id, mode, provider, updated_by)
      values (${storeId}::uuid, ${mode}::commerce.payment_mode, 'mollie', ${accountId}::uuid)
      on conflict (store_id, mode) do update set provider = excluded.provider, updated_by = excluded.updated_by, updated_at = now()
    `);
  }
  await audit(accountId, storeId, "payments.checkout_provider", { mode, provider });
  return { ok: true };
}

/** The provider chosen for each mode's checkout (no row: Stripe), for the Payments page. */
export async function chosenCheckoutProviders(storeId: string): Promise<Partial<Record<PaymentModeName, "stripe" | "mollie">>> {
  const rows = await db().execute<Row>(sql`select mode, provider from commerce.checkout_providers where store_id = ${storeId}::uuid`);
  return Object.fromEntries(rows.map((r) => [String(r.mode), r.provider === "mollie" ? "mollie" : "stripe"]));
}
