import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { todayIn } from "@/lib/analytics-period";
import { decryptSecret, encryptSecret } from "@/lib/secret-box";
import { norwegianOrgNumber, readPastedToken, tokenHint, type TripletexMode, type TripletexTokenKind } from "@/lib/tripletex";
import { type TripletexFailure } from "@/lib/tripletex-errors";
import { BOOKING_KEYS, defaultSettings, readSettings, type TripletexSettings } from "@/lib/tripletex-settings";
import { checkSettings, planSetup, type Chart, type ChartAccount, type ChartVatType, type SettingsProblem, type SetupPlan } from "@/lib/tripletex-setup";

import { neededKeys, storeOrgNumber } from "./accounting-documents";
import { audit } from "./auth";
import { log } from "./log";
import { encryptionKey } from "./settings";
import { listAll, openSession, whoAmI, type TripletexCredential, type TripletexDeps, type TripletexSession } from "./tripletex-client";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Tripletex (D453): a store's connection, the only writer of `commerce.tripletex_connections`. Connect takes the one token an
 * owner pasted, finds its kind and environment in the token, opens a session, reads the company and its chart, and keeps the
 * token encrypted with a plan of where everything is booked (`planSetup()`); Start sends from that day on; Pause, Disconnect.
 * The token is decrypted only by `tripletexCredential()`, for the sync and the page's own actions, and never returned to a page.
 */

export { neededKeys, storeOrgNumber } from "./accounting-documents";

export type ConnectionState = "setup" | "on" | "paused" | "auth_failed";

/** What a page is shown of a connection: never the token, only its hint. */
export type TripletexConnection = {
  mode: TripletexMode;
  tokenKind: TripletexTokenKind;
  tokenHint: string;
  company: { id: number; name: string; organizationNumber: string | null };
  state: ConnectionState;
  syncFrom: string | null;
  settings: TripletexSettings | null;
  lastOkAt: string | null;
  lastErrorKey: string | null;
};

const connectionRow = z.object({
  mode: z.enum(["test", "live"]),
  token_kind: z.enum(["api_token", "employee_token"]),
  token_hint: col.text,
  company_id: col.minor,
  company_name: col.text,
  company_org_number: col.textOrNull,
  state: z.enum(["setup", "on", "paused", "auth_failed"]),
  sync_from: z.union([col.text, z.date()]).nullable(),
  settings: z.unknown(),
  last_ok_at: col.timestampOrNull,
  last_error_key: col.textOrNull,
});

const dayText = (value: string | Date | null): string | null => (value === null ? null : typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10));

export async function getTripletexConnection(storeId: string): Promise<TripletexConnection | null> {
  const row = await typedRow(
    connectionRow,
    sql`select mode, token_kind, token_hint, company_id, company_name, company_org_number, state, sync_from, settings, last_ok_at, last_error_key
          from commerce.tripletex_connections where store_id = ${storeId}::uuid`,
  );
  if (!row) return null;
  return {
    mode: row.mode,
    tokenKind: row.token_kind,
    tokenHint: row.token_hint,
    company: { id: row.company_id, name: row.company_name, organizationNumber: row.company_org_number },
    state: row.state,
    syncFrom: dayText(row.sync_from),
    settings: readSettings(row.settings),
    lastOkAt: row.last_ok_at,
    lastErrorKey: row.last_error_key,
  };
}

/** The kept token, decrypted, for a call to Tripletex. Null without a connection or the settings key. Never to a page. */
export async function tripletexCredential(storeId: string): Promise<TripletexCredential | null> {
  const row = await typedRow(
    z.object({ mode: z.enum(["test", "live"]), token_kind: z.enum(["api_token", "employee_token"]), token_encrypted: col.text }),
    sql`select mode, token_kind, token_encrypted from commerce.tripletex_connections where store_id = ${storeId}::uuid`,
  );
  const key = encryptionKey();
  if (!row || !key) return null;
  try {
    return { kind: row.token_kind, mode: row.mode, token: decryptSecret(row.token_encrypted, key) };
  } catch (error) {
    log("error", "tripletex.token_unreadable", { storeId }, error);
    return null;
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// The company's chart, and what the store needs
// ---------------------------------------------------------------------------------------------------------------------

const ACCOUNT_FIELDS =
  "id,number,name,isInactive,ledgerType,vatLocked,vatType(id),legalVatTypes(id),requiresDepartment,requiresProject,requiresFreeDimension1,requiresFreeDimension2,requiresFreeDimension3";

/** The company's accounts and VAT codes, as the setup and the settings check read them. */
export async function readChart(session: TripletexSession): Promise<{ ok: true; chart: Chart } | { ok: false; failure: TripletexFailure }> {
  const accounts = await listAll<ChartAccount>(session, "/ledger/account", { fields: ACCOUNT_FIELDS });
  if (!accounts.ok) return accounts;
  const vatTypes = await listAll<ChartVatType>(session, "/ledger/vatType", { fields: "id,number,name,percentage" });
  if (!vatTypes.ok) return vatTypes;
  const clean = (a: ChartAccount): ChartAccount | null => (Number.isSafeInteger(a.id) && Number.isSafeInteger(a.number) ? { ...a, name: String(a.name ?? "").slice(0, 120) } : null);
  return {
    ok: true,
    chart: {
      accounts: accounts.value.map(clean).filter((a): a is ChartAccount => a !== null),
      vatTypes: vatTypes.value.filter((v) => Number.isSafeInteger(v.id) && typeof v.number === "string").map((v) => ({ ...v, name: String(v.name ?? "").slice(0, 120) })),
    },
  };
}


/** The settings a plan gives: Norway's defaults, with the plan's choices, and every bucket it could place. */
function settingsOfPlan(plan: SetupPlan, sources: TripletexSettings["sources"]): TripletexSettings {
  return { ...defaultSettings([], sources), bookings: plan.bookings, receivableAccount: plan.receivableAccount ?? 1500 };
}

// ---------------------------------------------------------------------------------------------------------------------
// Connect, Start, Pause, Disconnect
// ---------------------------------------------------------------------------------------------------------------------


export type ConnectResult =
  | {
      ok: true;
      company: { id: number; name: string; organizationNumber: string | null };
      /** False when Tripletex's organisation number is not the store's: the page asks the owner to be sure. */
      sameOrganisation: boolean | null;
      plan: SetupPlan;
      /** Buckets of this store's own documents the plan could not place: the questions Homer is asked. */
      questions: SetupPlan["questions"];
    }
  | { ok: false; problem: ConnectProblem; failureKey?: string };

/**
 * Why a connect did not happen, for the page to say in the owner's language: nothing pasted, not a token, no key to keep it, Tripletex
 * refused it, an employee token while Tripletex has not approved Kaizena Flow, the company is another store's, the token may not read
 * the accounts, the store keeps its books in Fiken (D460), or another failure (its `failureKey`).
 */
export type ConnectProblem = "empty" | "not_a_token" | "no_key" | "refused" | "no_consumer_token" | "taken" | "no_read_access" | "other_system" | "failure";

/**
 * Connects the store to the Tripletex company the token opens: tries the token, reads the company and its chart, plans the
 * setup, and keeps the token encrypted. A token for the same company replaces the old one and keeps the settings and the
 * state; a token for another company starts the setup again (what was sent to the first stays recorded). Owners only (the
 * action checks); nothing is sent to Tripletex but reads.
 */
export async function connectTripletex(accountId: string, storeId: string, pasted: string, deps: TripletexDeps = {}): Promise<ConnectResult> {
  const store = { id: storeId, organisationNumber: await storeOrgNumber(storeId) };
  const token = readPastedToken(pasted);
  if (!token.ok) return { ok: false, problem: token.problem };
  const key = encryptionKey();
  if (!key) return { ok: false, problem: "no_key" };
  // A store keeps its books in one system (D460): Fiken is disconnected first.
  const fiken = await typedRow(z.object({ one: col.int }), sql`select 1 as one from commerce.fiken_connections where store_id = ${store.id}::uuid`);
  if (fiken) return { ok: false, problem: "other_system" };

  let credential: TripletexCredential = { kind: token.kind, mode: token.mode, token: token.token };
  let opened = await openSession(credential, deps);
  // A test company's token without the `test-` prefix: try Tripletex's test environment before saying no.
  if (!opened.ok && opened.failure.class === "auth" && credential.mode === "live") {
    const test: TripletexCredential = { ...credential, mode: "test" };
    const second = await openSession(test, deps);
    if (second.ok) {
      credential = test;
      opened = second;
    }
  }
  if (!opened.ok) {
    log("warn", "tripletex.connect_refused", { storeId: store.id, key: opened.failure.key, mode: credential.mode, kind: credential.kind });
    if (opened.failure.key === "no_consumer_token") return { ok: false, problem: "no_consumer_token" };
    return opened.failure.class === "auth" ? { ok: false, problem: "refused" } : { ok: false, problem: "failure", failureKey: opened.failure.key };
  }
  const session = opened.session;
  const me = await whoAmI(session);
  if (!me.ok) return { ok: false, problem: "failure", failureKey: me.failure.key };
  const company = me.value;

  const taken = await typedRow(
    z.object({ store_id: col.uuid }),
    sql`select store_id from commerce.tripletex_connections
         where mode = ${credential.mode} and company_id = ${company.id} and store_id <> ${store.id}::uuid`,
  );
  if (taken) return { ok: false, problem: "taken" };

  const chart = await readChart(session);
  if (!chart.ok) {
    return chart.failure.class === "permission" ? { ok: false, problem: "no_read_access" } : { ok: false, problem: "failure", failureKey: chart.failure.key };
  }
  const needed = await neededKeys(store.id);
  const plan = planSetup(chart.chart, BOOKING_KEYS);
  const questions = plan.questions.filter((q) => q.key === "receivable" || needed.includes(q.key));
  // Both: the sweep finds only what the store has, and a store that starts invoicing later is booked from its first document.
  const sources = { work: true, shop: true };

  const before = await getTripletexConnection(store.id);
  const sameCompany = before !== null && before.company.id === company.id && before.mode === credential.mode;
  const settings = sameCompany && before.settings ? before.settings : settingsOfPlan(plan, sources);
  const state: ConnectionState = sameCompany ? (before.state === "auth_failed" ? (before.syncFrom ? "on" : "setup") : before.state) : "setup";
  const syncFrom = sameCompany ? before.syncFrom : null;

  await db().execute(sql`
    insert into commerce.tripletex_connections (
      store_id, mode, token_kind, token_encrypted, token_hint, company_id, company_name, company_org_number, state, sync_from, settings,
      last_ok_at, last_error_key, last_error_at, failures_in_a_row, updated_by
    ) values (
      ${store.id}::uuid, ${credential.mode}, ${credential.kind}, ${encryptSecret(credential.token, key)}, ${tokenHint(credential.token)},
      ${company.id}, ${company.name}, ${company.organizationNumber}, ${state}, ${syncFrom}::date, ${JSON.stringify(settings)}::jsonb,
      now(), null, null, 0, ${accountId}::uuid
    )
    on conflict (store_id) do update set
      mode = excluded.mode, token_kind = excluded.token_kind, token_encrypted = excluded.token_encrypted, token_hint = excluded.token_hint,
      company_id = excluded.company_id, company_name = excluded.company_name, company_org_number = excluded.company_org_number,
      state = excluded.state, sync_from = excluded.sync_from, settings = excluded.settings,
      last_ok_at = now(), last_error_key = null, last_error_at = null, failures_in_a_row = 0,
      updated_at = now(), updated_by = excluded.updated_by
  `);
  const ours = norwegianOrgNumber(store.organisationNumber);
  const theirs = norwegianOrgNumber(company.organizationNumber);
  const sameOrganisation = ours && theirs ? ours === theirs : null;
  await audit(accountId, store.id, sameCompany ? "integration.tripletex_token_replaced" : "integration.tripletex_connected", {
    mode: credential.mode,
    tokenKind: credential.kind,
    companyId: company.id,
    sameOrganisation,
  });
  return { ok: true, company, sameOrganisation, plan, questions };
}

/** Why Start did not happen: not connected, the token is refused, the settings are unreadable or would be refused, or a day in the future. */
export type StartProblem = "not_connected" | "auth_failed" | "settings" | "problems" | "future_day";

export type StartResult = { ok: true; syncFrom: string } | { ok: false; problem: StartProblem };

/**
 * Start (or go on after a pause): from `syncFrom` (today in the store's time zone by default) every issued document is sent.
 * Refused while the settings would be refused by Tripletex for this store's own documents (`problems`, from the page's check).
 */
export async function startTripletex(
  accountId: string,
  storeId: string,
  options: { syncFrom?: string; problems?: readonly SettingsProblem[]; now?: Date } = {},
): Promise<StartResult> {
  const connection = await getTripletexConnection(storeId);
  if (!connection) return { ok: false, problem: "not_connected" };
  if (connection.state === "auth_failed") return { ok: false, problem: "auth_failed" };
  if (!connection.settings) return { ok: false, problem: "settings" };
  if (options.problems && options.problems.length > 0) return { ok: false, problem: "problems" };
  const zone = await typedRow(z.object({ time_zone: col.text }), sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  const today = todayIn(options.now ?? new Date(), zone?.time_zone ?? "Europe/Oslo");
  const syncFrom = options.syncFrom ?? connection.syncFrom ?? today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(syncFrom) || syncFrom > today) return { ok: false, problem: "future_day" };
  await db().execute(sql`
    update commerce.tripletex_connections set state = 'on', sync_from = ${syncFrom}::date, updated_at = now(), updated_by = ${accountId}::uuid
     where store_id = ${storeId}::uuid
  `);
  await audit(accountId, storeId, connection.state === "paused" ? "integration.tripletex_resumed" : "integration.tripletex_started", {
    syncFrom,
    before: connection.syncFrom,
  });
  return { ok: true, syncFrom };
}

/** Pause: nothing is sent until Start again; what waits keeps waiting. */
export async function pauseTripletex(accountId: string, storeId: string): Promise<boolean> {
  const rows = await db().execute(sql`
    update commerce.tripletex_connections set state = 'paused', updated_at = now(), updated_by = ${accountId}::uuid
     where store_id = ${storeId}::uuid and state = 'on' returning store_id
  `);
  if (rows.length > 0) await audit(accountId, storeId, "integration.tripletex_paused", {});
  return rows.length > 0;
}

/**
 * Saves the settings, checked against the company's chart by the caller (`problems` from `checkTripletexSettings()`), and
 * refused while Tripletex would refuse them for buckets the store's documents use.
 */
export async function saveTripletexSettings(accountId: string, storeId: string, settings: TripletexSettings, problems: readonly SettingsProblem[]): Promise<{ ok: true } | { ok: false; problems: readonly SettingsProblem[] }> {
  const parsed = readSettings(settings);
  if (!parsed) return { ok: false, problems: [] };
  if (problems.length > 0) return { ok: false, problems };
  const before = await getTripletexConnection(storeId);
  if (!before) return { ok: false, problems: [] };
  await db().execute(sql`
    update commerce.tripletex_connections set settings = ${JSON.stringify(parsed)}::jsonb, updated_at = now(), updated_by = ${accountId}::uuid
     where store_id = ${storeId}::uuid
  `);
  const changed = (Object.keys(parsed) as (keyof TripletexSettings)[]).filter((k) => JSON.stringify(parsed[k]) !== JSON.stringify(before.settings?.[k]));
  await audit(accountId, storeId, "integration.tripletex_settings_saved", { changed });
  return { ok: true };
}

/** The settings checked against the company as it is now (a session from the kept token). */
export async function checkTripletexSettings(
  storeId: string,
  settings: TripletexSettings,
  deps: TripletexDeps = {},
): Promise<{ ok: true; problems: SettingsProblem[]; chart: Chart } | { ok: false; failureKey: string }> {
  const credential = await tripletexCredential(storeId);
  if (!credential) return { ok: false, failureKey: "not_connected" };
  const opened = await openSession(credential, deps);
  if (!opened.ok) return { ok: false, failureKey: opened.failure.key };
  const chart = await readChart(opened.session);
  if (!chart.ok) return { ok: false, failureKey: chart.failure.key };
  return { ok: true, problems: checkSettings(settings, chart.chart, await neededKeys(storeId)), chart: chart.chart };
}

/**
 * Disconnect: the token is forgotten, and what had not been sent is marked skipped. What was sent stays recorded (ids and
 * states only), so connecting the same company again never books a document twice. Nothing is deleted in Tripletex.
 */
export async function disconnectTripletex(accountId: string, storeId: string): Promise<boolean> {
  const [gone] = await db().execute<{ mode: string; company_id: string | number }>(sql`
    delete from commerce.tripletex_connections where store_id = ${storeId}::uuid returning mode, company_id
  `);
  if (!gone) return false;
  await db().execute(sql`
    update commerce.tripletex_sync set state = 'skipped', claimed_until = null, next_attempt_at = null, updated_at = now()
     where store_id = ${storeId}::uuid and mode = ${gone.mode} and company_id = ${Number(gone.company_id)} and state in ('pending', 'failed', 'blocked', 'drifted')
  `);
  await audit(accountId, storeId, "integration.tripletex_disconnected", { mode: gone.mode, companyId: Number(gone.company_id) });
  return true;
}

/** How many documents stand where, for the page's card and the checkup. */
export type SyncCounts = { synced: number; waiting: number; failed: number; blocked: number; lastWeek: number };

export async function tripletexCounts(storeId: string): Promise<SyncCounts | null> {
  const connection = await getTripletexConnection(storeId);
  if (!connection) return null;
  const row = await typedRow(
    z.object({ synced: col.minor, waiting: col.minor, failed: col.minor, blocked: col.minor, last_week: col.minor }),
    sql`select count(*) filter (where state = 'synced') as synced,
               count(*) filter (where state in ('pending', 'sending')) as waiting,
               count(*) filter (where state = 'failed') as failed,
               count(*) filter (where state in ('blocked', 'drifted')) as blocked,
               count(*) filter (where state = 'synced' and synced_at > now() - interval '7 days') as last_week
          from commerce.tripletex_sync
         where store_id = ${storeId}::uuid and mode = ${connection.mode} and company_id = ${connection.company.id} and kind <> 'customer'`,
  );
  return row ? { synced: row.synced, waiting: row.waiting, failed: row.failed, blocked: row.blocked, lastWeek: row.last_week } : null;
}

/** A document that waits for a person or keeps failing, for the page's "Needs you". */
export type SyncProblem = {
  kind: "work_invoice" | "work_credit_note" | "shop_invoice" | "shop_credit_note";
  localId: string;
  number: string | null;
  state: "failed" | "blocked" | "drifted";
  errorKey: string | null;
  /** Tripletex's own validation words, clipped (owner-facing only). */
  detail: string | null;
  requestId: string | null;
  at: string;
};

export async function tripletexProblems(storeId: string, limit = 20): Promise<SyncProblem[]> {
  const connection = await getTripletexConnection(storeId);
  if (!connection) return [];
  const rows = await typedRows(
    z.object({
      kind: z.enum(["work_invoice", "work_credit_note", "shop_invoice", "shop_credit_note"]),
      local_id: col.text,
      number: col.textOrNull,
      state: z.enum(["failed", "blocked", "drifted"]),
      error_key: col.textOrNull,
      error_detail: col.textOrNull,
      request_id: col.textOrNull,
      updated_at: col.timestamp,
    }),
    sql`select t.kind, t.local_id, coalesce(wi.document_number, wc.document_number, si.document_number, sc.document_number) as number,
               t.state, t.error_key, t.error_detail, t.request_id, t.updated_at
          from commerce.tripletex_sync t
          left join commerce.work_invoices wi on t.kind = 'work_invoice' and wi.store_id = t.store_id and wi.id::text = t.local_id
          left join commerce.work_credit_notes wc on t.kind = 'work_credit_note' and wc.store_id = t.store_id and wc.id::text = t.local_id
          left join commerce.invoices si on t.kind = 'shop_invoice' and si.store_id = t.store_id and si.id::text = t.local_id
          left join commerce.credit_notes sc on t.kind = 'shop_credit_note' and sc.store_id = t.store_id and sc.id::text = t.local_id
         where t.store_id = ${storeId}::uuid and t.mode = ${connection.mode} and t.company_id = ${connection.company.id}
           and t.kind <> 'customer' and t.state in ('failed', 'blocked', 'drifted')
         order by t.updated_at desc
         limit ${limit}`,
  );
  return rows.map((r) => ({ kind: r.kind, localId: r.local_id, number: r.number, state: r.state, errorKey: r.error_key, detail: r.error_detail, requestId: r.request_id, at: r.updated_at }));
}

/**
 * Another first day to send, once started (Customise): an earlier day sends older documents too, a later one leaves those not yet sent
 * alone. Never a day in the future.
 */
export async function setTripletexSyncFrom(accountId: string, storeId: string, day: string, now: Date = new Date()): Promise<StartResult> {
  const connection = await getTripletexConnection(storeId);
  if (!connection) return { ok: false, problem: "not_connected" };
  const zone = await typedRow(z.object({ time_zone: col.text }), sql`select time_zone from commerce.stores where id = ${storeId}::uuid`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day > todayIn(now, zone?.time_zone ?? "Europe/Oslo")) return { ok: false, problem: "future_day" };
  if (connection.state === "setup") return { ok: true, syncFrom: day };
  await db().execute(sql`
    update commerce.tripletex_connections set sync_from = ${day}::date, updated_at = now(), updated_by = ${accountId}::uuid where store_id = ${storeId}::uuid
  `);
  await audit(accountId, storeId, "integration.tripletex_sync_from_changed", { before: connection.syncFrom, after: day });
  return { ok: true, syncFrom: day };
}

/**
 * What needs a person, for the checkup and the daily alert: a token Tripletex no longer takes, and documents that wait for a person
 * (blocked, or still failing after the retry ladder's first rungs). Null without a connection or while it is set up or paused.
 */
export async function tripletexAttention(storeId: string): Promise<{ tokenRefused: boolean; waiting: number } | null> {
  const row = await typedRow(
    z.object({ state: col.text, waiting: col.minor }),
    sql`select c.state,
               coalesce((select count(*) from commerce.tripletex_sync t
                          where t.store_id = c.store_id and t.mode = c.mode and t.company_id = c.company_id and t.kind <> 'customer'
                            and (t.state in ('blocked', 'drifted') or (t.state = 'failed' and t.attempts >= 5))), 0) as waiting
          from commerce.tripletex_connections c where c.store_id = ${storeId}::uuid`,
  );
  if (!row || (row.state !== "on" && row.state !== "auth_failed")) return null;
  return { tokenRefused: row.state === "auth_failed", waiting: row.waiting };
}

/** Where each of these documents stands in Tripletex, for a document's own page: absent when it was never sent (issued before the start day). */
export type DocumentInTripletex = {
  state: "pending" | "sending" | "synced" | "failed" | "blocked" | "drifted" | "skipped";
  voucher: string | null;
  errorKey: string | null;
  detail: string | null;
  attached: boolean;
};

export async function tripletexDocuments(
  storeId: string,
  documents: readonly { kind: "work_invoice" | "work_credit_note" | "shop_invoice" | "shop_credit_note"; localId: string }[],
): Promise<Map<string, DocumentInTripletex>> {
  const connection = await getTripletexConnection(storeId);
  const out = new Map<string, DocumentInTripletex>();
  if (!connection || documents.length === 0) return out;
  const rows = await typedRows(
    z.object({
      kind: col.text,
      local_id: col.text,
      state: z.enum(["pending", "sending", "synced", "failed", "blocked", "drifted", "skipped"]),
      their_ref: col.textOrNull,
      error_key: col.textOrNull,
      error_detail: col.textOrNull,
      attached: col.bool,
    }),
    sql`select kind, local_id, state, their_ref, error_key, error_detail, attached_at is not null as attached
          from commerce.tripletex_sync
         where store_id = ${storeId}::uuid and mode = ${connection.mode} and company_id = ${connection.company.id}
           and (kind, local_id) in (${sql.join(documents.map((d) => sql`(${d.kind}, ${d.localId})`), sql`, `)})`,
  );
  for (const r of rows) out.set(`${r.kind}:${r.local_id}`, { state: r.state, voucher: r.their_ref, errorKey: r.error_key, detail: r.error_detail, attached: r.attached });
  return out;
}
