import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  AD_CURRENCIES,
  adChangeEffect,
  adChangeWords,
  budgetsOf,
  daysLeftInMonth,
  META_ACTIVE,
  META_API,
  metaAccountNumber,
  metaAccountSchema,
  metaAdSetsSchema,
  metaCampaignsSchema,
  metaErrorSchema,
  metaInsightsSchema,
  projectedMonthMinor,
  spendMinor,
  type AdBudget,
  type AdBudgetChange,
  type AdChangeFacts,
} from "@/lib/ad-budgets";
import { parseAmount } from "@/lib/field-money";
import { decryptSecret, encryptSecret, parseKey, secretHint } from "@/lib/secret-box";

import { audit } from "./auth";
import { log } from "./log";
import { col, typedRow } from "./typed-rows";

/**
 * A store's ad account, connected for its budgets (D585, step 1 of `docs/agent-spending.md`): the only writer of `commerce.ad_accounts` and
 * the only caller of Meta's Marketing API. Meta bills the owner as before; this reads what the account spends and changes a budget, never
 * pays. The token leaves this module only in the request's header; a page sees its hint. Connecting, the limit and disconnecting are the
 * owner's (checked by the actions); a budget is changed by the AI manager's tool on a yes, or by the autopilot within the owner's limits.
 * Kaizena Flow's own ads are its house store's account. Meta's own words are never passed on (they are outside text): a refusal is a code
 * here, with Meta's error number.
 */

const key = () => parseKey(process.env.SETTINGS_ENCRYPTION_KEY);

type Answer = { ok: boolean; status: number; json(): Promise<unknown> };
/** `fetch`, or a stand-in in tests. */
export type MetaFetch = (url: string, init: { method: "GET" | "POST"; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<Answer>;
const realFetch: MetaFetch = (url, init) => fetch(url, init);

/** A connected account as the Ads page shows it: never the token. */
export type AdAccountView = { platform: "meta"; account: string; name: string; currency: string; timeZone: string; tokenHint: string; limitMinor: number | null };

export async function adAccountOf(storeId: string): Promise<AdAccountView | null> {
  const row = await typedRow(
    z.object({ account_id: col.text, name: col.text, currency: col.currency, time_zone: col.text, token_hint: col.text, monthly_limit_minor: col.minorOrNull }),
    sql`select account_id, name, currency, time_zone, token_hint, monthly_limit_minor from commerce.ad_accounts where store_id = ${storeId}::uuid and platform = 'meta'`,
  );
  return row
    ? { platform: "meta", account: row.account_id, name: row.name, currency: row.currency, timeZone: row.time_zone, tokenHint: row.token_hint, limitMinor: row.monthly_limit_minor }
    : null;
}

async function tokenOf(storeId: string): Promise<{ view: AdAccountView; token: string } | null> {
  const secretKey = key();
  const view = await adAccountOf(storeId);
  if (!view || !secretKey) return null;
  const row = await typedRow(z.object({ token: col.text }), sql`select token from commerce.ad_accounts where store_id = ${storeId}::uuid and platform = 'meta'`);
  if (!row) return null;
  try {
    return { view, token: decryptSecret(row.token, secretKey) };
  } catch {
    // A token the key cannot open (the key changed): nothing is read until the owner pastes it again.
    return null;
  }
}

/** A call that did not give what was asked: Meta refused it (with its error number), did not answer, or answered in another shape. */
export type MetaProblem = { problem: "refused" | "unreachable" | "shape"; code: number | null };

async function meta<S extends z.ZodType>(fetcher: MetaFetch, token: string, path: string, schema: S, form?: Record<string, string>): Promise<z.output<S> | MetaProblem> {
  const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
  let answer: Answer;
  try {
    answer = await fetcher(`${META_API}/${path}`, {
      method: form ? "POST" : "GET",
      headers: form ? { ...headers, "Content-Type": "application/x-www-form-urlencoded" } : headers,
      ...(form && { body: new URLSearchParams(form).toString() }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (error) {
    log("warn", "ad_accounts.unreachable", { path: path.split("?")[0].replace(/\d+/g, "#") }, error);
    return { problem: "unreachable", code: null };
  }
  const body = await answer.json().catch(() => null);
  if (!answer.ok) {
    const code = metaErrorSchema.safeParse(body).data?.error.code ?? null;
    log("warn", "ad_accounts.refused", { status: answer.status, code });
    return { problem: "refused", code };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    log("warn", "ad_accounts.shape", { path: path.split("?")[0].replace(/\d+/g, "#") });
    return { problem: "shape", code: null };
  }
  return parsed.data;
}

const isProblem = (v: unknown): v is MetaProblem => typeof v === "object" && v !== null && "problem" in v;

export type ConnectInput = { account: string; token: string };
/** A refusal is a code the page words (`ads.budgets.problems`). */
export type ConnectProblem = "account" | "token" | "need_token" | "no_key" | "currency" | MetaProblem["problem"];

/**
 * Connects (or reconnects) the store's Meta ad account: the token must read the account, whose name, currency and time zone are kept as Meta
 * gives them. A token is required the first time, and kept when left empty later. An account in a currency Meta counts otherwise is refused.
 */
export async function connectAdAccount(storeId: string, actorId: string, input: ConnectInput, fetcher: MetaFetch = realFetch): Promise<{ ok: true } | { ok: false; problem: ConnectProblem; code?: number | null }> {
  const account = metaAccountNumber(input.account);
  if (!account) return { ok: false, problem: "account" };
  const typed = input.token.trim();
  if (typed && (typed.length < 20 || typed.length > 1000 || /\s/.test(typed))) return { ok: false, problem: "token" };
  const secretKey = key();
  if (!secretKey) return { ok: false, problem: "no_key" };
  const saved = typed ? null : await tokenOf(storeId);
  const token = typed || saved?.token;
  if (!token) return { ok: false, problem: "need_token" };
  const read = await meta(fetcher, token, `act_${account}?fields=name,currency,timezone_name,account_status`, metaAccountSchema);
  if (isProblem(read)) return { ok: false, problem: read.problem, code: read.code };
  if (!AD_CURRENCIES.includes(read.currency)) return { ok: false, problem: "currency" };
  const sealed = encryptSecret(token, secretKey);
  await db().execute(sql`
    insert into commerce.ad_accounts (store_id, platform, account_id, name, currency, time_zone, token, token_hint)
    values (${storeId}::uuid, 'meta', ${account}, ${read.name.slice(0, 200)}, ${read.currency}, ${read.timezone_name}, ${sealed}, ${secretHint(token)})
    on conflict (store_id, platform) do update set account_id = excluded.account_id, name = excluded.name, time_zone = excluded.time_zone,
      token = excluded.token, token_hint = excluded.token_hint,
      -- A limit is in the account's currency: another currency, or another account, starts without one.
      monthly_limit_minor = case when commerce.ad_accounts.currency = excluded.currency and commerce.ad_accounts.account_id = excluded.account_id
        then commerce.ad_accounts.monthly_limit_minor end,
      currency = excluded.currency, updated_at = now()
  `);
  await audit(actorId, storeId, "marketing.ad_account_connected", { platform: "meta", account, currency: read.currency, tokenChanged: Boolean(typed) });
  return { ok: true };
}

/** Sets what the autopilot may let the account spend in a month, typed in the account's currency; empty: it never raises a budget itself. */
export async function setAdMonthlyLimit(storeId: string, actorId: string, text: string): Promise<{ ok: true } | { ok: false; problem: "not_connected" | "amount" }> {
  const view = await adAccountOf(storeId);
  if (!view) return { ok: false, problem: "not_connected" };
  const limit = text.trim() === "" ? null : parseAmount(text.replace(/\s/g, ""), view.currency);
  if (text.trim() !== "" && (limit === null || limit > 100_000_000_000)) return { ok: false, problem: "amount" };
  await db().execute(sql`update commerce.ad_accounts set monthly_limit_minor = ${limit}, updated_at = now() where store_id = ${storeId}::uuid and platform = 'meta'`);
  await audit(actorId, storeId, "marketing.ad_limit_set", { platform: "meta", limitMinor: limit, currency: view.currency });
  return { ok: true };
}

export async function disconnectAdAccount(storeId: string, actorId: string): Promise<void> {
  const rows = await db().execute(sql`delete from commerce.ad_accounts where store_id = ${storeId}::uuid and platform = 'meta' returning 1`);
  if (rows.length > 0) await audit(actorId, storeId, "marketing.ad_account_disconnected", { platform: "meta" });
}

/** The account now, as Meta says: whether it runs ads, what it spent this month, its budgets and the month's projection at them. */
export type AdOverview = AdChangeFacts & { account: AdAccountView; active: boolean; projectedMinor: number | null };

/** Reads the account's month from Meta (four calls at once); a problem when it is not connected, cannot be opened or Meta says no. */
export async function adOverview(storeId: string, fetcher: MetaFetch = realFetch, now = new Date()): Promise<AdOverview | { problem: "not_connected" } | MetaProblem> {
  const opened = await tokenOf(storeId);
  if (!opened) return (await adAccountOf(storeId)) ? { problem: "refused", code: null } : { problem: "not_connected" };
  const { view, token } = opened;
  const act = `act_${view.account}`;
  const states = encodeURIComponent(JSON.stringify(["ACTIVE", "PAUSED"]));
  const [account, campaigns, adSets, total, perCampaign] = await Promise.all([
    meta(fetcher, token, `${act}?fields=name,currency,timezone_name,account_status`, metaAccountSchema),
    meta(fetcher, token, `${act}/campaigns?fields=id,name,status,daily_budget,lifetime_budget&effective_status=${states}&limit=200`, metaCampaignsSchema),
    meta(fetcher, token, `${act}/adsets?fields=id,name,status,campaign_id,daily_budget,lifetime_budget&effective_status=${states}&limit=200`, metaAdSetsSchema),
    meta(fetcher, token, `${act}/insights?fields=spend&date_preset=this_month`, metaInsightsSchema),
    meta(fetcher, token, `${act}/insights?level=campaign&fields=campaign_id,spend&date_preset=this_month&limit=200`, metaInsightsSchema),
  ]);
  for (const read of [account, campaigns, adSets, total, perCampaign]) if (isProblem(read)) return read;
  const a = account as z.output<typeof metaAccountSchema>;
  // The currency is fixed when the account is made; one that changed under us is read as refused rather than in the wrong unit.
  if (a.currency !== view.currency) return { problem: "shape", code: null };
  const spent = spendMinor((total as z.output<typeof metaInsightsSchema>).data[0]?.spend, view.currency);
  if (spent === null) return { problem: "shape", code: null };
  const budgets = budgetsOf(
    (campaigns as z.output<typeof metaCampaignsSchema>).data,
    (adSets as z.output<typeof metaAdSetsSchema>).data,
    (perCampaign as z.output<typeof metaInsightsSchema>).data,
    view.currency,
  );
  const daysLeft = daysLeftInMonth(now, view.timeZone);
  return {
    account: view,
    active: a.account_status === META_ACTIVE,
    budgets,
    spentMinor: spent,
    daysLeft,
    currency: view.currency,
    limitMinor: view.limitMinor,
    projectedMinor: projectedMonthMinor(spent, budgets, daysLeft),
  };
}

export const isOverview = (v: Awaited<ReturnType<typeof adOverview>>): v is AdOverview => "budgets" in v;

export type ChangeProblem = "not_connected" | "unknown" | "lifetime" | "nothing" | "amount" | MetaProblem["problem"];
export type ChangeResult = { ok: true; before: AdBudget; after: AdBudget; words: string; overview: AdOverview } | { ok: false; problem: ChangeProblem; code?: number | null };

/** The smallest and largest daily budget this sets, in minor units (Meta has its own minimum per currency, and says so). */
export const DAILY_MIN_MINOR = 100;
export const DAILY_MAX_MINOR = 100_000_000;

/**
 * Checks a change against the account as Meta has it now (the budget is the account's, a daily one, and the change changes something),
 * without making it: the overview and the change's effect. The autopilot's rule and the approval read this.
 */
export async function previewAdChange(storeId: string, change: AdBudgetChange, fetcher: MetaFetch = realFetch, now = new Date()) {
  const overview = await adOverview(storeId, fetcher, now);
  if (!isOverview(overview)) return { ok: false as const, problem: overview.problem, code: "code" in overview ? overview.code : null };
  if (change.dailyMinor !== undefined && (!Number.isSafeInteger(change.dailyMinor) || change.dailyMinor < DAILY_MIN_MINOR || change.dailyMinor > DAILY_MAX_MINOR)) {
    return { ok: false as const, problem: "amount" as const };
  }
  const effect = adChangeEffect(overview, change);
  if (!effect) return { ok: false as const, problem: "unknown" as const };
  if (change.dailyMinor !== undefined && effect.before.lifetime) return { ok: false as const, problem: "lifetime" as const };
  if (effect.after.dailyMinor === effect.before.dailyMinor && effect.after.on === effect.before.on) return { ok: false as const, problem: "nothing" as const };
  return { ok: true as const, overview, effect, words: adChangeWords(effect.before, effect.after, overview.currency) };
}

/**
 * Changes one budget in Meta: its daily amount, its switch, or both, after `previewAdChange()` found it the account's. Audited with the
 * figures (ids and amounts, no person). The caller has decided it may (the owner's yes, or the autopilot's rule).
 */
export async function changeAdBudget(storeId: string, actorId: string, change: AdBudgetChange, fetcher: MetaFetch = realFetch, now = new Date()): Promise<ChangeResult> {
  const preview = await previewAdChange(storeId, change, fetcher, now);
  if (!preview.ok) return preview;
  const { before, after } = preview.effect;
  const opened = await tokenOf(storeId);
  if (!opened) return { ok: false, problem: "not_connected" };
  const form: Record<string, string> = {};
  if (after.dailyMinor !== before.dailyMinor && after.dailyMinor !== null) form.daily_budget = String(after.dailyMinor);
  if (after.on !== before.on) form.status = after.on ? "ACTIVE" : "PAUSED";
  const done = await meta(fetcher, opened.token, encodeURIComponent(before.id), z.object({ success: z.literal(true) }), form);
  if (isProblem(done)) return { ok: false, problem: done.problem, code: done.code };
  await audit(
    actorId,
    storeId,
    "marketing.ad_budget_changed",
    { platform: "meta", budget: before.id, kind: before.kind, currency: preview.overview.currency },
    { target: { type: before.kind === "campaign" ? "ad_campaign" : "ad_set", id: before.id }, changes: { dailyMinor: { from: before.dailyMinor, to: after.dailyMinor }, on: { from: before.on, to: after.on } } },
  );
  return { ok: true, before, after, words: preview.words, overview: preview.overview };
}
