import "server-only";

import { sql } from "drizzle-orm";
import { cacheLife, cacheTag } from "next/cache";

import { db, readDb } from "@/db/client";
import { renderEmail } from "@/lib/email-layout";
import { referralCreditAppliedEmail, referredStoreOpenedEmail } from "@/lib/referral-emails";
import {
  makeReferralCode,
  normalizeReferralCode,
  REFERRAL_DEFAULTS,
  referralEnds,
  referralSettingsInput,
  sumPerCurrency,
  type AdminReferral,
  type AdminReferralTotals,
  type AdminReferrer,
  type ReferralBalance,
  type ReferralEntry,
  type ReferralEntryKind,
  type ReferralSettings,
  type ReferredStore,
  type ReferrerOverview,
} from "@/lib/referrals";
import { siteUrl } from "@/lib/site";

import { audit, type Account } from "./auth";
import { sendEmail, type SendOutcome } from "./email";

type Row = Record<string, unknown>;

/**
 * Kaizen's referral program (D131, `docs/referrals.md`): store owners refer other store owners and earn credit on their
 * own Kaizen invoices. The rules are in SQL (`commerce.referral_*`: the ledger, commission on fees, refunds taking it back,
 * the referral made at approval); this module reads and drives them for the owner's page, the platform's pages, the
 * sign-up form and the link. Stripe's invoices are in `referral-billing.ts`.
 */

/** Tag of the cached read of whether the program is on (`referralProgramOn()`); changed with the settings. */
export const REFERRALS_TAG = "referrals";

export type ReferralResult = { ok: true; message?: string } | { ok: false; problems: string[] };

const problems = (...messages: string[]): ReferralResult => ({ ok: false, problems: messages });
const iso = (value: unknown) => new Date(String(value)).toISOString();

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

function toSettings(row: Row | undefined): ReferralSettings {
  return row
    ? {
        enabled: Boolean(row.enabled),
        commissionBps: Number(row.commission_bps),
        months: Number(row.months),
        pendingDays: Number(row.pending_days),
        cookieDays: Number(row.cookie_days),
      }
    : { ...REFERRAL_DEFAULTS };
}

/** The program's settings now; the defaults, with the program off, until Kaizen has saved some. */
export async function getReferralSettings(): Promise<ReferralSettings> {
  const [row] = await db().execute<Row>(sql`select * from commerce.referral_program()`);
  return toSettings(row);
}

/**
 * What the public pages need of the program: whether it is on (the sign-up form keeps a code, and the cookie banner lists
 * the referral cookie, only while it is) and how many days the cookie lasts. Cached until the settings change
 * (`REFERRALS_TAG`).
 */
export async function referralPublicSettings(): Promise<{ enabled: boolean; cookieDays: number }> {
  "use cache";
  cacheLife("hours");
  cacheTag(REFERRALS_TAG);
  const [row] = await readDb().execute<Row>(sql`select enabled, cookie_days from commerce.referral_program()`);
  return { enabled: Boolean(row?.enabled), cookieDays: Number(row?.cookie_days ?? REFERRAL_DEFAULTS.cookieDays) };
}

/** Whether the program is on, as the cookie banner and cookie page ask. */
export async function referralProgramOn(): Promise<boolean> {
  return (await referralPublicSettings()).enabled;
}

/**
 * Saves the program's settings (platform admins only; the page and action check, and so does this). A referral already
 * made keeps the rate and months it was made with; turning the program off stops new referrals and new commission, and
 * keeps every balance, which can still be put on invoices. The caller refreshes `REFERRALS_TAG`.
 */
export async function saveReferralSettings(actor: Account, raw: unknown): Promise<ReferralResult> {
  if (!actor.platformAdmin) return problems("Only platform admins can change the referral program.");
  const parsed = referralSettingsInput.safeParse(raw);
  if (!parsed.success) return problems(...new Set(parsed.error.issues.map((issue) => issue.message)));
  const s = parsed.data;
  const before = await getReferralSettings();
  await db().execute(sql`
    insert into commerce.referral_settings (id, enabled, commission_bps, months, pending_days, cookie_days, updated_by)
    values (true, ${s.enabled}, ${s.commissionBps}, ${s.months}, ${s.pendingDays}, ${s.cookieDays}, ${actor.id}::uuid)
    on conflict (id) do update set
      enabled = excluded.enabled, commission_bps = excluded.commission_bps, months = excluded.months,
      pending_days = excluded.pending_days, cookie_days = excluded.cookie_days,
      updated_by = excluded.updated_by, updated_at = now()
  `);
  await audit(actor.id, null, "platform.referral_settings", { before, after: s });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Referrers: a code for every store owner
// ---------------------------------------------------------------------------

/** Whether the account owns a store (is an owner of one that is not closed). Only owners refer. */
export async function ownsAStore(accountId: string): Promise<boolean> {
  const [row] = await db().execute<Row>(sql`
    select exists (
      select 1 from commerce.store_members m join commerce.stores s on s.id = m.store_id and s.status <> 'closed' and not (s.is_template or s.starter)
       where m.account_id = ${accountId}::uuid and m.role = 'owner' and m.disabled_at is null
    ) as owns
  `);
  return Boolean(row?.owns);
}

export type Referrer = { accountId: string; code: string; blockedAt: string | null };

async function readReferrer(accountId: string): Promise<Referrer | null> {
  const [row] = await db().execute<Row>(sql`
    select account_id, code, blocked_at from commerce.referrers where account_id = ${accountId}::uuid
  `);
  return row ? { accountId: String(row.account_id), code: String(row.code), blockedAt: row.blocked_at ? iso(row.blocked_at) : null } : null;
}

/**
 * The account's referral code, made the first time it is asked for (no approval): a code that is not taken yet, tried
 * again when two accounts draw the same. Null for an account that owns no store. `random` is for tests.
 */
export async function getOrCreateReferrer(accountId: string, random: () => number = Math.random): Promise<Referrer | null> {
  const existing = await readReferrer(accountId);
  if (existing) return existing;
  if (!(await ownsAStore(accountId))) return null;
  for (let attempt = 0; attempt < 8; attempt++) {
    // A taken code, or a second request at the same moment, inserts nothing: the row is read back either way.
    await db().execute(sql`
      insert into commerce.referrers (account_id, code) values (${accountId}::uuid, ${makeReferralCode(random)})
      on conflict do nothing
    `);
    const made = await readReferrer(accountId);
    if (made) return made;
  }
  throw new Error("Could not make a referral code.");
}

/** A code that belongs to a referrer who is not blocked, as the sign-up form takes it; null for anything else, silently. */
export async function usableReferralCode(text: string | null | undefined): Promise<string | null> {
  const code = normalizeReferralCode(text);
  if (!code) return null;
  const [row] = await db().execute<Row>(sql`select 1 as found from commerce.referrers where code = ${code} and blocked_at is null`);
  return row ? code : null;
}

/**
 * A visit to a referral link, counted by day with nothing about the visitor. True when the code is a real one
 * (the caller leads everyone to the sign-up form either way; the answer is for tests and the counter).
 */
export async function recordReferralVisit(text: string | null | undefined): Promise<boolean> {
  const code = normalizeReferralCode(text);
  if (!code) return false;
  const [row] = await db().execute<Row>(sql`select commerce.referral_visit(${code}) as counted`);
  return Boolean(row?.counted);
}

// ---------------------------------------------------------------------------
// The owner's page
// ---------------------------------------------------------------------------

const ENTRY_LABELS: Record<string, string> = { plan_invoice: "plan", sale_fee: "sales fee" };

function entryNote(row: Row): string {
  const kind = row.kind as ReferralEntryKind;
  const store = row.store_name ? String(row.store_name) : null;
  const what = ENTRY_LABELS[String(row.source_kind)] ?? "fee";
  switch (kind) {
    case "earn":
      return store ? `${store}: ${what}` : `A referred store: ${what}`;
    case "reverse":
      return store ? `${store}: ${what} refunded` : `A referred store: ${what} refunded`;
    case "apply":
      return "Taken off a Kaizen invoice";
    case "restore":
      return "Returned: the invoice was not paid with credit";
    default:
      return row.note ? String(row.note) : "Adjusted by Kaizen";
  }
}

/** The referrer's balance per currency, usable and pending. */
export async function referralBalances(accountId: string): Promise<ReferralBalance[]> {
  const rows = await db().execute<Row>(sql`select * from commerce.referral_balance(${accountId}::uuid) order by currency`);
  return rows.map((r) => ({
    currency: String(r.currency).trim(),
    availableMinor: Number(r.available_minor),
    pendingMinor: Number(r.pending_minor),
    pendingAt: r.pending_at ? iso(r.pending_at) : null,
  }));
}

/**
 * What the owner's Referrals page draws. The code is made here when the program is on and the account owns a store;
 * nothing about a referred store's people, customers or orders is read: its name, when it started and ends, and the
 * commission it earned. `limit` is the history's length.
 */
export async function referrerOverview(account: Pick<Account, "id">, limit = 50): Promise<ReferrerOverview> {
  const settings = await getReferralSettings();
  const referrer = settings.enabled ? await getOrCreateReferrer(account.id) : await readReferrer(account.id);
  const code = referrer?.code ?? null;
  const [balances, visits, requests, stores, entries] = await Promise.all([
    referralBalances(account.id),
    code
      ? db().execute<Row>(sql`select coalesce(sum(visits), 0)::int as n from commerce.referral_visits where store_id is null and code = ${code}`)
      : Promise.resolve([]),
    code
      ? db().execute<Row>(sql`select count(*)::int as n from commerce.access_requests where lower(referral_code) = ${code}`)
      : Promise.resolve([]),
    db().execute<Row>(sql`
      select r.id, s.name, r.status, r.created_at, r.months,
        coalesce(jsonb_agg(jsonb_build_object('currency', e.currency, 'minor', e.minor)) filter (where e.currency is not null), '[]') as earned
      from commerce.referrals r
      join commerce.stores s on s.id = r.store_id
      left join lateral (
        select e.currency, sum(e.amount_minor)::bigint as minor from commerce.referral_entries e
         where e.referral_id = r.id and e.kind in ('earn', 'reverse') group by e.currency
      ) e on true
      where r.referrer_account_id = ${account.id}::uuid
      group by r.id, s.name
      order by r.created_at desc
    `),
    db().execute<Row>(sql`
      select e.id, e.kind, e.currency, e.amount_minor, e.created_at, e.note, e.source_kind, s.name as store_name
      from commerce.referral_entries e
      left join commerce.referrals r on r.id = e.referral_id
      left join commerce.stores s on s.id = r.store_id
      where e.account_id = ${account.id}::uuid
      order by e.created_at desc, e.id limit ${limit}
    `),
  ]);
  return {
    enabled: settings.enabled,
    code,
    blocked: Boolean(referrer?.blockedAt),
    settings,
    visits: Number(visits[0]?.n ?? 0),
    signedUp: Number(requests[0]?.n ?? 0),
    stores: stores.map(
      (r): ReferredStore => ({
        storeName: String(r.name),
        status: r.status === "void" ? "void" : "active",
        since: iso(r.created_at),
        earned: sumPerCurrency(
          (r.earned as { currency: string; minor: number | string }[]).map((x) => ({ currency: String(x.currency).trim(), minor: Number(x.minor) })),
        ),
        until: referralEnds(new Date(String(r.created_at)), Number(r.months)).toISOString(),
      }),
    ),
    balances,
    entries: entries.map(
      (e): ReferralEntry => ({
        id: String(e.id),
        kind: e.kind as ReferralEntryKind,
        currency: String(e.currency).trim(),
        amountMinor: Number(e.amount_minor),
        createdAt: iso(e.created_at),
        note: entryNote(e),
      }),
    ),
  };
}

// ---------------------------------------------------------------------------
// The platform's pages
// ---------------------------------------------------------------------------

const perCurrency = (value: unknown) =>
  sumPerCurrency(((value as { currency: string; minor: number | string }[] | null) ?? []).map((x) => ({ currency: String(x.currency).trim(), minor: Number(x.minor) })));

/** Every referrer with what they brought in and their balances; blocked ones too. */
export async function listReferrers(): Promise<AdminReferrer[]> {
  const rows = await db().execute<Row>(sql`
    select r.account_id, r.code, r.blocked_at, r.blocked_reason, a.email, a.name,
      (select coalesce(sum(v.visits), 0)::int from commerce.referral_visits v where v.store_id is null and v.code = r.code) as visits,
      (select count(*)::int from commerce.access_requests q where lower(q.referral_code) = r.code) as requests,
      (select count(*)::int from commerce.referrals x where x.referrer_account_id = r.account_id) as stores,
      coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency, 'minor', t.minor))
        from (select e.currency, sum(e.amount_minor)::bigint as minor from commerce.referral_entries e
               where e.account_id = r.account_id and e.kind = 'earn' group by e.currency) t), '[]') as earned
    from commerce.referrers r join commerce.accounts a on a.id = r.account_id
    order by r.created_at desc
  `);
  const balances = await Promise.all(rows.map((r) => referralBalances(String(r.account_id))));
  return rows.map(
    (r, i): AdminReferrer => ({
      accountId: String(r.account_id),
      email: String(r.email),
      name: r.name ? String(r.name) : null,
      code: String(r.code),
      blockedAt: r.blocked_at ? iso(r.blocked_at) : null,
      blockedReason: String(r.blocked_reason ?? ""),
      visits: Number(r.visits),
      requests: Number(r.requests),
      stores: Number(r.stores),
      earned: perCurrency(r.earned),
      balances: balances[i],
    }),
  );
}

/**
 * Referred stores with who referred them and the commission earned so far (net of what was taken back). The fee behind
 * it is not kept (only the commission is): the page may show it as about `commission / rate`.
 */
export async function listReferrals(): Promise<AdminReferral[]> {
  const rows = await db().execute<Row>(sql`
    select r.id, r.status, r.void_reason, r.commission_bps, r.months, r.created_at, s.name, s.slug, a.email,
      coalesce((select jsonb_agg(jsonb_build_object('currency', t.currency, 'minor', t.minor))
        from (select e.currency, sum(e.amount_minor)::bigint as minor from commerce.referral_entries e
               where e.referral_id = r.id and e.kind in ('earn', 'reverse') group by e.currency) t), '[]') as earned
    from commerce.referrals r
    join commerce.stores s on s.id = r.store_id
    join commerce.accounts a on a.id = r.referrer_account_id
    order by r.created_at desc
  `);
  return rows.map(
    (r): AdminReferral => ({
      id: String(r.id),
      storeName: String(r.name),
      storeSlug: String(r.slug),
      referrerEmail: String(r.email),
      status: r.status === "void" ? "void" : "active",
      voidReason: String(r.void_reason ?? ""),
      commissionBps: Number(r.commission_bps),
      months: Number(r.months),
      since: iso(r.created_at),
      until: referralEnds(new Date(String(r.created_at)), Number(r.months)).toISOString(),
      earned: perCurrency(r.earned),
    }),
  );
}

/** Totals per currency (never added across currencies): commission earned, credit put on invoices, credit still owed. */
export async function referralTotals(): Promise<AdminReferralTotals> {
  const [[counts], sums, owed] = await Promise.all([
    db().execute<Row>(sql`
      select (select count(*)::int from commerce.referrers) as referrers, (select count(*)::int from commerce.referrals) as stores
    `),
    db().execute<Row>(sql`
      select e.currency,
        coalesce(sum(e.amount_minor) filter (where e.kind in ('earn', 'reverse')), 0)::bigint as earned,
        coalesce(-sum(e.amount_minor) filter (where e.kind in ('apply', 'restore')), 0)::bigint as applied
      from commerce.referral_entries e group by e.currency
    `),
    db().execute<Row>(sql`
      select c.currency, (select coalesce(sum(e.amount_minor), 0) from commerce.referral_entries e where e.currency = c.currency)::bigint as owed
      from (select distinct currency from commerce.referral_entries) c
    `),
  ]);
  return {
    referrers: Number(counts.referrers),
    referredStores: Number(counts.stores),
    earned: sumPerCurrency(sums.map((r) => ({ currency: String(r.currency).trim(), minor: Number(r.earned) }))),
    applied: sumPerCurrency(sums.map((r) => ({ currency: String(r.currency).trim(), minor: Number(r.applied) }))),
    outstanding: sumPerCurrency(owed.map((r) => ({ currency: String(r.currency).trim(), minor: Number(r.owed) }))),
  };
}

const reasonOf = (text: unknown) => String(text ?? "").trim().slice(0, 300);

/** Blocks a referrer: they earn nothing more and their credit is not put on invoices, until unblocked. Balances are kept. */
export async function setReferrerBlocked(actor: Account, accountId: string, blocked: boolean, reason?: string): Promise<ReferralResult> {
  if (!actor.platformAdmin) return problems("Only platform admins can block a referrer.");
  const why = reasonOf(reason);
  if (blocked && why.length < 3) return problems("Say why, so the next person knows.");
  const [row] = await db().execute<Row>(sql`
    update commerce.referrers
       set blocked_at = ${blocked ? sql`now()` : null}, blocked_reason = ${blocked ? why : ""}
     where account_id = ${accountId}::uuid and (blocked_at is not null) is distinct from ${blocked}
    returning code
  `);
  if (!row) return problems(blocked ? "That account is not a referrer, or is blocked already." : "That account is not blocked.");
  await audit(actor.id, null, blocked ? "platform.referrer_blocked" : "platform.referrer_unblocked", { account: accountId, reason: why });
  return { ok: true };
}

/** Voids a referral (it earns nothing more, what it earned stays) or puts it back, with a reason. */
export async function setReferralVoid(actor: Account, referralId: string, isVoid: boolean, reason?: string): Promise<ReferralResult> {
  if (!actor.platformAdmin) return problems("Only platform admins can void a referral.");
  const why = reasonOf(reason);
  if (isVoid && why.length < 3) return problems("Say why, so the next person knows.");
  const [row] = await db().execute<Row>(sql`
    update commerce.referrals
       set status = ${isVoid ? "void" : "active"}, void_reason = ${isVoid ? why : ""}
     where id = ${referralId}::uuid and status = ${isVoid ? "active" : "void"}
    returning store_id
  `);
  if (!row) return problems(isVoid ? "That referral is void already, or does not exist." : "That referral is not void.");
  await audit(actor.id, String(row.store_id), isVoid ? "platform.referral_voided" : "platform.referral_restored", { referral: referralId, reason: why });
  return { ok: true };
}

/**
 * Adds or removes credit for a referrer, with a reason (audited and in their history as "Adjusted by Kaizen"): adding is
 * usable at once, removing takes usable credit first and is refused rather than going below zero. `key` makes one
 * submission count once; a new one is made for each.
 */
export async function adjustReferralCredit(
  actor: Account,
  input: { accountId: string; currency: string; amountMinor: number; reason: string },
  key: string = crypto.randomUUID(),
): Promise<ReferralResult> {
  if (!actor.platformAdmin) return problems("Only platform admins can adjust credit.");
  const currency = input.currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return problems("Choose a currency.");
  if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor === 0) return problems("Enter an amount, positive to add or negative to remove.");
  const why = reasonOf(input.reason);
  if (why.length < 3) return problems("Say why, so the referrer and the next person can see.");
  try {
    await db().execute(sql`
      select commerce.referral_adjust(${input.accountId}::uuid, ${currency}, ${input.amountMinor}::bigint, ${why}, ${actor.id}::uuid, ${`adjust:${key}`})
    `);
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : "";
    if (text.includes("referral.insufficient")) return problems("They do not have that much credit to remove.");
    if (text.includes("referral.no_referrer")) return problems("That account has no referral code yet.");
    throw error;
  }
  await audit(actor.id, null, "platform.referral_credit_adjusted", { account: input.accountId, currency, amountMinor: input.amountMinor, reason: why });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Emails to the referrer
// ---------------------------------------------------------------------------

/**
 * Tells the referrer that the store they referred is open, once per referral. Called after an access request is approved;
 * nothing is sent when the request had no referral, or the referrer is blocked. A failure to send never undoes anything.
 */
export async function notifyReferralOpened(storeId: string): Promise<SendOutcome | null> {
  const [row] = await db().execute<Row>(sql`
    select r.id, r.commission_bps, r.months, s.name as store_name, a.email, rr.blocked_at
    from commerce.referrals r
    join commerce.stores s on s.id = r.store_id
    join commerce.accounts a on a.id = r.referrer_account_id and a.disabled_at is null
    join commerce.referrers rr on rr.account_id = r.referrer_account_id
    where r.store_id = ${storeId}::uuid and r.status = 'active'
  `);
  if (!row || row.blocked_at) return null;
  const email = renderEmail(
    referredStoreOpenedEmail({
      storeName: String(row.store_name),
      commissionBps: Number(row.commission_bps),
      months: Number(row.months),
      url: `${siteUrl()}/admin/account/referrals`,
    }),
  );
  return sendEmail({
    storeId: null,
    kind: "referral.store_opened",
    to: String(row.email),
    email,
    fromName: "Kaizen",
    idempotencyKey: `referral-opened:${String(row.id)}`,
  });
}

/** Tells a referrer that credit was taken off one of their invoices, once per invoice. */
export async function notifyCreditApplied(input: {
  accountId: string;
  invoiceId: string;
  invoiceNumber: string | null;
  amountMinor: number;
  currency: string;
}): Promise<SendOutcome | null> {
  const [row] = await db().execute<Row>(sql`select email from commerce.accounts where id = ${input.accountId}::uuid and disabled_at is null`);
  if (!row) return null;
  const email = renderEmail(
    referralCreditAppliedEmail({
      amountMinor: input.amountMinor,
      currency: input.currency,
      invoiceNumber: input.invoiceNumber,
      url: `${siteUrl()}/admin/account/referrals`,
    }),
  );
  return sendEmail({
    storeId: null,
    kind: "referral.credit_applied",
    to: String(row.email),
    email,
    fromName: "Kaizen",
    idempotencyKey: `referral-credit-applied:${input.invoiceId}`,
  });
}
