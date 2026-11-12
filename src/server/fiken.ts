import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { BOOKING_KEYS, norwegianOrgNumber, type BookingKey } from "@/lib/accounting-docs";
import { todayIn } from "@/lib/analytics-period";
import { accessDue, codeChallenge, fikenAuthorizeUrl, isFikenSlug, openFikenState, randomToken, sealFikenState } from "@/lib/fiken";
import { type FikenFailure } from "@/lib/fiken-errors";
import { defaultFikenSettings, readFikenSettings, type FikenSettings } from "@/lib/fiken-settings";
import { checkFikenSettings, planFikenSetup, type FikenAccount, type FikenSettingsProblem, type FikenSetupPlan } from "@/lib/fiken-setup";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { siteUrl } from "@/lib/site";

import { neededKeys, storeOrgNumber } from "./accounting-documents";
import { audit, type Membership } from "./auth";
import { fikenApi, fikenApp, listAll, revokeGrant, tokenCall, type FikenApi, type FikenDeps, type FikenTokens } from "./fiken-client";
import { log } from "./log";
import { checkPermission, memberCan } from "./permissions";
import { encryptionKey } from "./encryption-key";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Fiken (D460, `docs/fiken.md`): a store's connection, the only writer of `commerce.fiken_connections`. Connect sends the owner to Fiken's
 * consent page for Kaizena Flow's app (OAuth2 with PKCE; Fiken's terms keep personal API tokens out of third-party apps), and the callback
 * keeps the grant encrypted. A grant may open several companies: with one, it is chosen at once; with more, the owner picks one. The
 * company's accounts are read and a plan made of where everything is booked (`planFikenSetup()`); Start sends from that day on; Pause,
 * Disconnect (which revokes the grant at Fiken). The tokens are decrypted only by `fikenAccess()`, for the sync and the page's own actions,
 * refreshed under the row's lock, and never returned to a page. A store keeps its books in one system: Fiken is refused while Tripletex is
 * connected, and the other way round.
 */

export type FikenConnectionState = "choose" | "setup" | "on" | "paused" | "auth_failed";

/** What a page is shown of a connection: never a token. */
export type FikenConnection = {
  company: { slug: string; name: string; organizationNumber: string | null } | null;
  testCompany: boolean;
  state: FikenConnectionState;
  syncFrom: string | null;
  settings: FikenSettings | null;
  lastOkAt: string | null;
  lastErrorKey: string | null;
};

const OWNER = "owner" as const;

const connectionRow = z.object({
  company_slug: col.textOrNull,
  company_name: col.textOrNull,
  company_org_number: col.textOrNull,
  test_company: col.bool,
  state: z.enum(["choose", "setup", "on", "paused", "auth_failed"]),
  sync_from: z.union([col.text, z.date()]).nullable(),
  settings: z.unknown(),
  last_ok_at: col.timestampOrNull,
  last_error_key: col.textOrNull,
});

const dayText = (value: string | Date | null): string | null => (value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));

export async function getFikenConnection(storeId: string): Promise<FikenConnection | null> {
  const row = await typedRow(
    connectionRow,
    sql`select company_slug, company_name, company_org_number, test_company, state, sync_from, settings, last_ok_at, last_error_key
          from commerce.fiken_connections where store_id = ${storeId}::uuid`,
  );
  if (!row) return null;
  return {
    company: row.company_slug && row.company_name ? { slug: row.company_slug, name: row.company_name, organizationNumber: row.company_org_number } : null,
    testCompany: row.test_company,
    state: row.state,
    syncFrom: dayText(row.sync_from),
    settings: readFikenSettings(row.settings),
    lastOkAt: row.last_ok_at,
    lastErrorKey: row.last_error_key,
  };
}

/** Whether *Connect Fiken* can work on this server: Kaizena Flow's app at Fiken is configured and the server can encrypt. */
export const fikenOffered = (deps: FikenDeps = {}): boolean => fikenApp(deps) !== null && encryptionKey() !== null;

export const fikenRedirectUri = (): string => `${siteUrl()}/api/integrations/fiken/callback`;

/** Whether the store keeps its books in Tripletex (a store sends to one system at a time). */
async function tripletexConnected(storeId: string): Promise<boolean> {
  const row = await typedRow(z.object({ one: col.int }), sql`select 1 as one from commerce.tripletex_connections where store_id = ${storeId}::uuid`);
  return row !== null;
}

// ---------------------------------------------------------------------------------------------------------------------
// The grant: kept, refreshed, used
// ---------------------------------------------------------------------------------------------------------------------

/** Why there is no token to use: nothing kept, Fiken refused the refresh (the grant is over), or Fiken could not be asked. */
export type AccessProblem = { problem: "not_connected" | "grant_refused" | "failure"; failure?: FikenFailure };

/**
 * A working access token for the store's grant: the kept one while it lasts, else a refresh under the row's lock, so two runs never spend
 * one refresh token (Fiken may rotate it). A refresh Fiken refuses turns the connection `auth_failed`: nothing more is sent until the owner
 * connects again.
 */
export async function fikenAccess(storeId: string, deps: FikenDeps = {}): Promise<{ ok: true; token: string } | ({ ok: false } & AccessProblem)> {
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "not_connected" };
  const now = (deps.now ?? (() => new Date()))();
  return db().transaction(async (tx) => {
    const [row] = await tx.execute<{ access_token_encrypted: string; access_expires_at: string | Date | null; refresh_token_encrypted: string | null; state: string }>(sql`
      select access_token_encrypted, access_expires_at, refresh_token_encrypted, state from commerce.fiken_connections
       where store_id = ${storeId}::uuid for update
    `);
    if (!row) return { ok: false, problem: "not_connected" } as const;
    let access: string;
    try {
      access = decryptSecret(row.access_token_encrypted, key);
    } catch (error) {
      log("error", "fiken.token_unreadable", { storeId }, error);
      return { ok: false, problem: "not_connected" } as const;
    }
    const expires = row.access_expires_at ? new Date(String(row.access_expires_at)) : null;
    if (!accessDue(expires, now.getTime())) return { ok: true, token: access } as const;
    if (!row.refresh_token_encrypted) {
      // No refresh token and the access token is over: the grant has to be given again.
      if (expires !== null) {
        await tx.execute(sql`update commerce.fiken_connections set state = 'auth_failed', last_error_key = 'http_401', last_error_at = now() where store_id = ${storeId}::uuid and state in ('on', 'setup', 'choose')`);
        return { ok: false, problem: "grant_refused" } as const;
      }
      return { ok: true, token: access } as const;
    }
    const refreshed = await tokenCall({ grant_type: "refresh_token", refresh_token: decryptSecret(row.refresh_token_encrypted, key) }, deps);
    if (!refreshed.ok) {
      if (refreshed.refusal.grant) {
        await tx.execute(sql`
          update commerce.fiken_connections set state = 'auth_failed', last_error_key = 'http_401', last_error_at = now(), failures_in_a_row = failures_in_a_row + 1
           where store_id = ${storeId}::uuid and state <> 'auth_failed'
        `);
        log("warn", "fiken.refresh_refused", { storeId });
        return { ok: false, problem: "grant_refused", failure: refreshed.refusal.failure } as const;
      }
      return { ok: false, problem: "failure", failure: refreshed.refusal.failure } as const;
    }
    await keepTokens(tx, storeId, refreshed.tokens, key);
    return { ok: true, token: refreshed.tokens.access } as const;
  });
}

type Tx = Parameters<Parameters<ReturnType<typeof db>["transaction"]>[0]>[0];

/** The tokens, encrypted, on the row (a refresh token Fiken did not send again stays as it was). */
async function keepTokens(tx: Tx, storeId: string, tokens: FikenTokens, key: Buffer): Promise<void> {
  await tx.execute(sql`
    update commerce.fiken_connections
       set access_token_encrypted = ${encryptSecret(tokens.access, key)}, access_expires_at = ${tokens.expiresAt?.toISOString() ?? null}::timestamptz,
           refresh_token_encrypted = coalesce(${tokens.refresh ? encryptSecret(tokens.refresh, key) : null}, refresh_token_encrypted), updated_at = now()
     where store_id = ${storeId}::uuid
  `);
}

/** The API with the store's grant, or why not. */
export async function fikenApiFor(storeId: string, deps: FikenDeps = {}): Promise<{ ok: true; api: FikenApi } | ({ ok: false } & AccessProblem)> {
  const access = await fikenAccess(storeId, deps);
  return access.ok ? { ok: true, api: fikenApi(access.token, deps) } : access;
}

// ---------------------------------------------------------------------------------------------------------------------
// Companies and their accounts
// ---------------------------------------------------------------------------------------------------------------------

export type FikenCompany = { slug: string; name: string; organizationNumber: string | null; hasApiAccess: boolean; testCompany: boolean };

type CompanyAnswer = { slug?: unknown; name?: unknown; organizationNumber?: unknown; hasApiAccess?: unknown; testCompany?: unknown };

const companyOf = (c: CompanyAnswer): FikenCompany | null =>
  isFikenSlug(c.slug) && typeof c.name === "string" && c.name.trim() !== ""
    ? {
        slug: c.slug,
        name: c.name.trim().slice(0, 255),
        organizationNumber: typeof c.organizationNumber === "string" && c.organizationNumber.trim() !== "" ? c.organizationNumber.trim().slice(0, 20) : null,
        hasApiAccess: c.hasApiAccess !== false,
        testCompany: c.testCompany === true,
      }
    : null;

/** The companies the grant opens (`GET /companies`). */
export async function readCompanies(api: FikenApi): Promise<{ ok: true; companies: FikenCompany[] } | { ok: false; failure: FikenFailure }> {
  const list = await listAll<CompanyAnswer>(api, "/companies", {}, 500);
  if (!list.ok) return list;
  return { ok: true, companies: list.value.map(companyOf).filter((c): c is FikenCompany => c !== null) };
}

/** The company's accounts a sale may use (`GET /companies/{slug}/accounts`, 2000 to 3999), as the setup and the settings check read them. */
export async function readAccounts(api: FikenApi, slug: string): Promise<{ ok: true; accounts: FikenAccount[] } | { ok: false; failure: FikenFailure }> {
  if (!isFikenSlug(slug)) return { ok: false, failure: { class: "rule", status: null, key: "not_connected", requestId: null, retryAfter: null, detail: null } };
  const list = await api.get<{ code?: unknown; name?: unknown }[]>(`/companies/${slug}/accounts`, { fromAccount: 2000, toAccount: 3999 });
  if (!list.ok) return list;
  const accounts = (Array.isArray(list.value) ? list.value : [])
    .filter((a) => typeof a.code === "string" && /^\d{4}$/.test(a.code))
    .map((a) => ({ code: String(a.code), name: String(a.name ?? "").slice(0, 120) }));
  return { ok: true, accounts };
}

// ---------------------------------------------------------------------------------------------------------------------
// Connect: Fiken's consent page and back
// ---------------------------------------------------------------------------------------------------------------------

export type FikenStartProblem = "off" | "forbidden" | "other_system";

/** The press (owner only): a fresh nonce and PKCE verifier sealed with the store and the account for the cookie, and Fiken's page. */
export async function startFikenConnect(member: Membership, deps: FikenDeps & { now?: () => Date } = {}): Promise<{ ok: true; url: string; cookie: string } | { ok: false; problem: FikenStartProblem }> {
  if (!memberCan(member, OWNER)) return { ok: false, problem: "forbidden" };
  const app = fikenApp(deps);
  const key = encryptionKey();
  if (!app || !key) return { ok: false, problem: "off" };
  if (await tripletexConnected(member.store.id)) return { ok: false, problem: "other_system" };
  const value = { state: randomToken(), store: member.store.slug, account: member.account.id, verifier: randomToken() };
  return {
    ok: true,
    cookie: sealFikenState(key, value, (deps.now ?? (() => new Date()))().getTime()),
    url: fikenAuthorizeUrl({ clientId: app.clientId, redirectUri: fikenRedirectUri(), state: value.state, challenge: codeChallenge(value.verifier) }),
  };
}

export type FikenConnectOutcome = "connected" | "choose" | "declined" | "failed" | "other_system" | "no_company" | "taken";

/**
 * Fiken's return to `/api/integrations/fiken/callback`: the state checked against the cookie, the owner signed in now the one who
 * pressed; then the code exchanged (with the PKCE verifier), the companies the grant opens read, and the grant kept encrypted. One company
 * that is not another store's is chosen at once; several are offered to the owner. The answer is the admin page to go back to, with what
 * became of it.
 */
export async function finishFikenConnect(
  params: URLSearchParams,
  cookie: string | undefined,
  deps: FikenDeps & { owner?: (storeSlug: string) => Promise<Membership | null> } = {},
): Promise<string> {
  const key = encryptionKey();
  const now = (deps.now ?? (() => new Date()))();
  const state = key ? openFikenState(key, cookie, now.getTime()) : null;
  if (!key || !state) return "/admin";
  const back = (outcome: FikenConnectOutcome) => `/admin/${state.store}/integrations/fiken?fiken=${outcome}`;
  if (params.get("state") !== state.state) return back("failed");
  if (params.get("error")) return back("declined");
  const code = params.get("code");
  if (!code || code.length > 2000) return back("failed");
  const member = await (deps.owner ?? ((slug: string) => checkPermission(slug, OWNER)))(state.store);
  if (!member || member.account.id !== state.account) return back("failed");
  if (await tripletexConnected(member.store.id)) return back("other_system");
  const exchanged = await tokenCall({ grant_type: "authorization_code", code, redirect_uri: fikenRedirectUri(), code_verifier: state.verifier }, deps);
  if (!exchanged.ok) {
    log("warn", "fiken.code_refused", { storeId: member.store.id, key: exchanged.refusal.failure.key });
    return back("failed");
  }
  const api = fikenApi(exchanged.tokens.access, deps);
  const companies = await readCompanies(api);
  if (!companies.ok) {
    log("warn", "fiken.companies_unreadable", { storeId: member.store.id, key: companies.failure.key });
    return back("failed");
  }
  const before = await getFikenConnection(member.store.id);
  // The grant is kept whatever comes next: a reconnect keeps its company, one company is chosen at once, several wait for the owner.
  await db().execute(sql`
    insert into commerce.fiken_connections (store_id, access_token_encrypted, access_expires_at, refresh_token_encrypted, state, updated_by)
    values (${member.store.id}::uuid, ${encryptSecret(exchanged.tokens.access, key)}, ${exchanged.tokens.expiresAt?.toISOString() ?? null}::timestamptz,
            ${exchanged.tokens.refresh ? encryptSecret(exchanged.tokens.refresh, key) : null}, 'choose', ${member.account.id}::uuid)
    on conflict (store_id) do update set
      access_token_encrypted = excluded.access_token_encrypted, access_expires_at = excluded.access_expires_at,
      refresh_token_encrypted = excluded.refresh_token_encrypted, updated_at = now(), updated_by = excluded.updated_by
  `);
  const usable = companies.companies;
  const kept = before?.company ? usable.find((c) => c.slug === before.company!.slug) : undefined;
  if (kept && before) {
    // Connected again to the same company (after Fiken stopped taking the grant): its settings and state stay, and what waited goes.
    const state2: FikenConnectionState = before.state === "auth_failed" ? (before.syncFrom ? "on" : "setup") : before.state;
    await db().execute(sql`
      update commerce.fiken_connections set state = ${state2}, last_ok_at = now(), last_error_key = null, last_error_at = null, failures_in_a_row = 0
       where store_id = ${member.store.id}::uuid
    `);
    await audit(member.account.id, member.store.id, "integration.fiken_reconnected", { company: kept.slug });
    return back("connected");
  }
  if (before?.company) {
    // The grant no longer opens the company this store booked into: the owner chooses again (what was sent stays recorded).
    await db().execute(sql`
      update commerce.fiken_connections set state = 'choose', company_slug = null, company_name = null, company_org_number = null, test_company = false,
             sync_from = null, settings = '{}'::jsonb where store_id = ${member.store.id}::uuid
    `);
  }
  if (usable.length === 0) {
    await audit(member.account.id, member.store.id, "integration.fiken_connected", { companies: 0 });
    return back("no_company");
  }
  await audit(member.account.id, member.store.id, "integration.fiken_connected", { companies: usable.length });
  if (usable.length === 1) {
    const chosen = await chooseFikenCompany(member.account.id, member.store.id, usable[0].slug, deps);
    return back(chosen.ok ? "connected" : chosen.problem === "taken" ? "taken" : "choose");
  }
  return back("choose");
}

export type ChooseProblem = "not_connected" | "not_offered" | "taken" | "no_api_access" | "failure";

export type ChooseResult =
  | { ok: true; company: FikenCompany; sameOrganisation: boolean | null; plan: FikenSetupPlan; questions: FikenSetupPlan["questions"] }
  | { ok: false; problem: ChooseProblem; failureKey?: string };

/**
 * The company the store books into, from those the grant opens: not another store's, with Fiken's API module on. Its accounts are read and
 * a plan made; a company chosen again keeps its settings and its state, another starts the setup again (what was sent to the first stays
 * recorded). Nothing is written to Fiken. Owners only (the action checks).
 */
export async function chooseFikenCompany(accountId: string, storeId: string, slug: string, deps: FikenDeps = {}): Promise<ChooseResult> {
  if (!isFikenSlug(slug)) return { ok: false, problem: "not_offered" };
  const opened = await fikenApiFor(storeId, deps);
  if (!opened.ok) return { ok: false, problem: opened.problem === "not_connected" ? "not_connected" : "failure", failureKey: opened.failure?.key };
  const companies = await readCompanies(opened.api);
  if (!companies.ok) return { ok: false, problem: "failure", failureKey: companies.failure.key };
  const company = companies.companies.find((c) => c.slug === slug);
  if (!company) return { ok: false, problem: "not_offered" };
  if (!company.hasApiAccess) return { ok: false, problem: "no_api_access" };
  const taken = await typedRow(z.object({ store_id: col.uuid }), sql`select store_id from commerce.fiken_connections where company_slug = ${slug} and store_id <> ${storeId}::uuid`);
  if (taken) return { ok: false, problem: "taken" };
  const accounts = await readAccounts(opened.api, slug);
  if (!accounts.ok) return { ok: false, problem: accounts.failure.class === "permission" ? "no_api_access" : "failure", failureKey: accounts.failure.key };

  const needed = await neededKeys(storeId);
  const plan = planFikenSetup(accounts.accounts, BOOKING_KEYS);
  const questions = plan.questions.filter((q) => needed.includes(q.key));
  const before = await getFikenConnection(storeId);
  const sameCompany = before?.company?.slug === slug;
  const settings: FikenSettings = sameCompany && before?.settings ? before.settings : { ...defaultFikenSettings([], { work: true, shop: true }), bookings: plan.bookings };
  const state: FikenConnectionState = sameCompany && before && before.state !== "choose" ? (before.state === "auth_failed" ? (before.syncFrom ? "on" : "setup") : before.state) : "setup";
  const syncFrom = sameCompany ? (before?.syncFrom ?? null) : null;
  await db().execute(sql`
    update commerce.fiken_connections
       set company_slug = ${company.slug}, company_name = ${company.name}, company_org_number = ${company.organizationNumber}, test_company = ${company.testCompany},
           state = ${state}, sync_from = ${syncFrom}::date, settings = ${JSON.stringify(settings)}::jsonb,
           last_ok_at = now(), last_error_key = null, last_error_at = null, failures_in_a_row = 0, updated_at = now(), updated_by = ${accountId}::uuid
     where store_id = ${storeId}::uuid
  `);
  const ours = norwegianOrgNumber(await storeOrgNumber(storeId));
  const theirs = norwegianOrgNumber(company.organizationNumber);
  const sameOrganisation = ours && theirs ? ours === theirs : null;
  await audit(accountId, storeId, "integration.fiken_company_chosen", { company: company.slug, testCompany: company.testCompany, sameOrganisation });
  return { ok: true, company, sameOrganisation, plan, questions };
}

/** The companies the kept grant opens, for the page's choice (empty when Fiken cannot be asked). */
export async function fikenCompanies(storeId: string, deps: FikenDeps = {}): Promise<FikenCompany[]> {
  const opened = await fikenApiFor(storeId, deps);
  if (!opened.ok) return [];
  const companies = await readCompanies(opened.api);
  return companies.ok ? companies.companies : [];
}

// ---------------------------------------------------------------------------------------------------------------------
// Start, Pause, settings, Disconnect
// ---------------------------------------------------------------------------------------------------------------------

export type FikenStartResult = { ok: true; syncFrom: string } | { ok: false; problem: "not_connected" | "auth_failed" | "settings" | "problems" | "future_day" };

/**
 * Start (or go on after a pause): from `syncFrom` (today in the store's time zone by default) every issued document is sent. Refused while
 * the settings would be refused by Fiken for this store's own documents (`problems`, from the page's check).
 */
export async function startFiken(
  accountId: string,
  storeId: string,
  options: { syncFrom?: string; problems?: readonly FikenSettingsProblem[]; now?: Date } = {},
): Promise<FikenStartResult> {
  const connection = await getFikenConnection(storeId);
  if (!connection || !connection.company) return { ok: false, problem: "not_connected" };
  if (connection.state === "auth_failed") return { ok: false, problem: "auth_failed" };
  if (!connection.settings) return { ok: false, problem: "settings" };
  if (options.problems && options.problems.length > 0) return { ok: false, problem: "problems" };
  const zone = await typedRow(z.object({ time_zone: col.text }), sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  const today = todayIn(options.now ?? new Date(), zone?.time_zone ?? "Europe/Oslo");
  const syncFrom = options.syncFrom ?? connection.syncFrom ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom) || syncFrom > today) return { ok: false, problem: "future_day" };
  await db().execute(sql`
    update commerce.fiken_connections set state = 'on', sync_from = ${syncFrom}::date, updated_at = now(), updated_by = ${accountId}::uuid where store_id = ${storeId}::uuid
  `);
  await audit(accountId, storeId, connection.state === "paused" ? "integration.fiken_resumed" : "integration.fiken_started", { syncFrom, before: connection.syncFrom });
  return { ok: true, syncFrom };
}

/** Pause: nothing is sent until Start again; what waits keeps waiting. */
export async function pauseFiken(accountId: string, storeId: string): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.fiken_connections set state = 'paused', updated_at = now(), updated_by = ${accountId}::uuid where store_id = ${storeId}::uuid and state = 'on' returning store_id
  `);
  if (rows.length > 0) await audit(accountId, storeId, "integration.fiken_paused", {});
  return rows.length > 0;
}

/** The settings checked against the company's accounts as they are now (with the kept grant). */
export async function checkFikenSettingsNow(
  storeId: string,
  settings: FikenSettings,
  deps: FikenDeps = {},
): Promise<{ ok: true; problems: FikenSettingsProblem[]; accounts: FikenAccount[] } | { ok: false; failureKey: string }> {
  const connection = await getFikenConnection(storeId);
  if (!connection?.company) return { ok: false, failureKey: "not_connected" };
  const opened = await fikenApiFor(storeId, deps);
  if (!opened.ok) return { ok: false, failureKey: opened.failure?.key ?? (opened.problem === "grant_refused" ? "http_401" : "not_connected") };
  const accounts = await readAccounts(opened.api, connection.company.slug);
  if (!accounts.ok) return { ok: false, failureKey: accounts.failure.key };
  return { ok: true, problems: checkFikenSettings(settings, accounts.accounts, await neededKeys(storeId)), accounts: accounts.accounts };
}

/** Saves the settings, checked by the caller (`problems`), and refused while Fiken would refuse them for buckets the store's documents use. */
export async function saveFikenSettings(
  accountId: string,
  storeId: string,
  settings: FikenSettings,
  problems: readonly FikenSettingsProblem[],
): Promise<{ ok: true } | { ok: false; problems: readonly FikenSettingsProblem[] }> {
  const parsed = readFikenSettings(settings);
  if (!parsed) return { ok: false, problems: [] };
  if (problems.length > 0) return { ok: false, problems };
  const before = await getFikenConnection(storeId);
  if (!before) return { ok: false, problems: [] };
  await db().execute(sql`
    update commerce.fiken_connections set settings = ${JSON.stringify(parsed)}::jsonb, updated_at = now(), updated_by = ${accountId}::uuid where store_id = ${storeId}::uuid
  `);
  const changed = (Object.keys(parsed) as (keyof FikenSettings)[]).filter((k) => JSON.stringify(parsed[k]) !== JSON.stringify(before.settings?.[k]));
  await audit(accountId, storeId, "integration.fiken_settings_saved", { changed });
  return { ok: true };
}

/** Another first day to send, once started (Customise). Never a day in the future. */
export async function setFikenSyncFrom(accountId: string, storeId: string, day: string, now: Date = new Date()): Promise<FikenStartResult> {
  const connection = await getFikenConnection(storeId);
  if (!connection) return { ok: false, problem: "not_connected" };
  const zone = await typedRow(z.object({ time_zone: col.text }), sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > todayIn(now, zone?.time_zone ?? "Europe/Oslo")) return { ok: false, problem: "future_day" };
  if (connection.state === "setup" || connection.state === "choose") return { ok: true, syncFrom: day };
  await db().execute(sql`update commerce.fiken_connections set sync_from = ${day}::date, updated_at = now(), updated_by = ${accountId}::uuid where store_id = ${storeId}::uuid`);
  await audit(accountId, storeId, "integration.fiken_sync_from_changed", { before: connection.syncFrom, after: day });
  return { ok: true, syncFrom: day };
}

/**
 * Disconnect: the grant is revoked at Fiken (best effort) and forgotten, and what had not been sent is marked skipped. What was sent stays
 * recorded (ids and states only), so connecting the same company again never books a document twice. Nothing is deleted in Fiken.
 */
export async function disconnectFiken(accountId: string, storeId: string, deps: FikenDeps = {}): Promise<boolean> {
  const key = encryptionKey();
  const kept = await typedRow(z.object({ access_token_encrypted: col.text }), sql`select access_token_encrypted from commerce.fiken_connections where store_id = ${storeId}::uuid`);
  if (kept && key) {
    try {
      await revokeGrant(decryptSecret(kept.access_token_encrypted, key), deps);
    } catch (error) {
      log("warn", "fiken.revoke_failed", { storeId }, error);
    }
  }
  const [gone] = await db().execute<{ company_slug: string | null }>(sql`delete from commerce.fiken_connections where store_id = ${storeId}::uuid returning company_slug`);
  if (!gone) return false;
  if (gone.company_slug) {
    await db().execute(sql`
      update commerce.fiken_sync set state = 'skipped', claimed_until = null, next_attempt_at = null, updated_at = now()
       where store_id = ${storeId}::uuid and company_slug = ${gone.company_slug} and state in ('pending', 'failed', 'blocked', 'drifted')
    `);
  }
  await audit(accountId, storeId, "integration.fiken_disconnected", { company: gone.company_slug });
  return true;
}

// ---------------------------------------------------------------------------------------------------------------------
// How it goes
// ---------------------------------------------------------------------------------------------------------------------

export type FikenCounts = { synced: number; waiting: number; failed: number; blocked: number; lastWeek: number };

export async function fikenCounts(storeId: string): Promise<FikenCounts | null> {
  const connection = await getFikenConnection(storeId);
  if (!connection?.company) return null;
  const row = await typedRow(
    z.object({ synced: col.minor, waiting: col.minor, failed: col.minor, blocked: col.minor, last_week: col.minor }),
    sql`select count(*) filter (where state = 'synced') as synced,
               count(*) filter (where state in ('pending', 'sending')) as waiting,
               count(*) filter (where state = 'failed') as failed,
               count(*) filter (where state in ('blocked', 'drifted')) as blocked,
               count(*) filter (where state = 'synced' and synced_at > now() - interval '7 days') as last_week
          from commerce.fiken_sync
         where store_id = ${storeId}::uuid and company_slug = ${connection.company.slug} and kind <> 'customer'`,
  );
  return row ? { synced: row.synced, waiting: row.waiting, failed: row.failed, blocked: row.blocked, lastWeek: row.last_week } : null;
}

export type FikenProblem = {
  kind: "work_invoice" | "work_credit_note" | "shop_invoice" | "shop_credit_note";
  localId: string;
  number: string | null;
  state: "failed" | "blocked" | "drifted";
  errorKey: string | null;
  /** Fiken's own words, clipped (owner-facing only). */
  detail: string | null;
  at: string;
};

/** Documents that wait for a person or keep failing, for the page's "Needs you". */
export async function fikenProblems(storeId: string, limit = 20): Promise<FikenProblem[]> {
  const connection = await getFikenConnection(storeId);
  if (!connection?.company) return [];
  const rows = await typedRows(
    z.object({
      kind: z.enum(["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note"]),
      local_id: col.text,
      number: col.textOrNull,
      state: z.enum(["failed", "blocked", "drifted"]),
      error_key: col.textOrNull,
      error_detail: col.textOrNull,
      updated_at: col.timestamp,
    }),
    sql`select f.kind, f.local_id, f.external_key as number, f.state, f.error_key, f.error_detail, f.updated_at
          from commerce.fiken_sync f
         where f.store_id = ${storeId}::uuid and f.company_slug = ${connection.company.slug} and f.kind <> 'customer' and f.state in ('failed', 'blocked', 'drifted')
         order by f.updated_at desc
         limit ${limit}`,
  );
  return rows.map((r) => ({ kind: r.kind, localId: r.local_id, number: r.number, state: r.state, errorKey: r.error_key, detail: r.error_detail, at: r.updated_at }));
}

/**
 * What needs a person, for the checkup and the daily alert: a grant Fiken no longer takes, and documents that wait for a person (blocked,
 * or still failing after the retry ladder's first rungs). Null without a connection or while it is set up or paused.
 */
export async function fikenAttention(storeId: string): Promise<{ tokenRefused: boolean; waiting: number } | null> {
  const row = await typedRow(
    z.object({ state: col.text, waiting: col.minor }),
    sql`select c.state,
               coalesce((select count(*) from commerce.fiken_sync f
                          where f.store_id = c.store_id and f.company_slug = c.company_slug and f.kind <> 'customer'
                            and (f.state in ('blocked', 'drifted') or (f.state = 'failed' and f.attempts >= 5))), 0) as waiting
          from commerce.fiken_connections c where c.store_id = ${storeId}::uuid`,
  );
  if (!row || (row.state !== "on" && row.state !== "auth_failed")) return null;
  return { tokenRefused: row.state === "auth_failed", waiting: row.waiting };
}

/** The buckets a store needs, for the page (re-read from the documents of the last year). */
export const fikenNeededKeys = (storeId: string): Promise<BookingKey[]> => neededKeys(storeId);
