import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { isOrganisationNumber } from "@/lib/brreg";
import {
  ACCOUNTS_URL,
  REFRESH_DAYS,
  UNIT_URL,
  UPDATES_CHUNK,
  WATCH_WINDOW_DAYS,
  readAccounts,
  readUnit,
  readUpdates,
  updatesUrl,
  type RedFlag,
  type RegisterAccounts,
  type RegisterUnit,
  type RegisterView,
} from "@/lib/register-facts";

import { jobReport } from "./cache-events";
import { cappedText } from "./capped-text";
import { log } from "./log";
import { orgNumberSql } from "./register-sql";
import { sendCompanyFlagAlert } from "./staff-alerts";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Company facts from Brønnøysundregistrene (D891, `docs/rules/admin/commerce.md` "Company facts from Brønnøysund"): the only writer of
 * `commerce.register_companies`, and its reads. A number is asked about only at the register's fixed host, and only the number is sent (a
 * business identifier the store or the owner gave). A page with one company reads its row and asks the register when it has none or it is
 * older than `REFRESH_DAYS` (`registerFactsNow()`); a list reads rows only (`registerFacts()`); the daily watch (`watchRegister()`) fills the
 * numbers we hold, follows the register's feed of changes and tells a store when a company it sells to on payment terms is newly bankrupt,
 * being wound up, dissolved or deleted.
 */

/** How long one call to the register may take: a page waits on it once, the job on each. */
export const REGISTER_TIMEOUT_MS = 4000;
/** A page asks with less patience: it draws without the facts rather than wait. */
export const PAGE_TIMEOUT_MS = 2500;
/** The most of an answer that is read (a unit is a few kilobytes, three years of a group's accounts some tens). */
const MAX_BODY_BYTES = 256 * 1024;
/** Register calls one run of the watch makes at most; the next day takes the rest. */
export const WATCH_CALLS_PER_RUN = 300;

/** How the register is reached: the real one, a stand-in in tests. */
export type RegisterDeps = { fetch?: typeof fetch; timeoutMs?: number; now?: Date };

/** A register answer: the JSON of a 200, null for a unit or accounts it does not have (404, 410), a throw for anything else. */
async function ask(url: string, deps: RegisterDeps): Promise<unknown | null> {
  const response = await (deps.fetch ?? fetch)(url, {
    headers: { Accept: "application/json" },
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(deps.timeoutMs ?? REGISTER_TIMEOUT_MS),
  });
  if (response.status === 404 || response.status === 410) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`brreg ${response.status}`);
  }
  return JSON.parse(await cappedText(response, MAX_BODY_BYTES));
}

const today = (now: Date) => now.toISOString().slice(0, 10);

const SAVED = z.object({ red_flag: col.textOrNull, old_flag: col.textOrNull });

/** Keeps what the register says of a unit; answers the red flag it now shows when it showed none before (a new flag), else null. */
async function saveUnit(number: string, unit: RegisterUnit): Promise<RedFlag | null> {
  if (unit.status !== "company") {
    await db().execute(sql`
      insert into commerce.register_companies (organisation_number, status, org_form, facts_checked_at)
      values (${number}, ${unit.status}, ${unit.status === "sole_trader" ? unit.orgForm : null}, now())
      on conflict (organisation_number) do update set status = excluded.status, org_form = excluded.org_form, name = null, org_form_name = null,
        industry_code = null, industry_name = null, employees = null, founded = null, municipality = null, website = null, red_flag = null,
        red_flag_on = null, flagged_at = null, accounts_year = null, accounts_currency = null, revenue_minor = null, operating_result_minor = null,
        profit_minor = null, equity_minor = null, previous_revenue_minor = null, accounts_checked_at = null, facts_checked_at = now()
    `);
    return null;
  }
  const f = unit.facts;
  const row = await typedRow(
    SAVED,
    sql`
      with old as (select red_flag from commerce.register_companies where organisation_number = ${number})
      insert into commerce.register_companies as r
        (organisation_number, status, name, org_form, org_form_name, industry_code, industry_name, employees, founded, municipality, website,
         red_flag, red_flag_on, flagged_at, facts_checked_at)
      values (${number}, 'company', ${f.name}, ${f.orgForm}, ${f.orgFormName}, ${f.industryCode}, ${f.industryName}, ${f.employees}, ${f.founded}::date,
        ${f.municipality}, ${f.website}, ${f.redFlag}, ${f.redFlagOn}::date, case when ${f.redFlag}::text is not null then now() end, now())
      on conflict (organisation_number) do update set status = 'company', name = excluded.name, org_form = excluded.org_form,
        org_form_name = excluded.org_form_name, industry_code = excluded.industry_code, industry_name = excluded.industry_name,
        employees = excluded.employees, founded = excluded.founded, municipality = excluded.municipality, website = excluded.website,
        red_flag = excluded.red_flag, red_flag_on = excluded.red_flag_on,
        flagged_at = case when excluded.red_flag is null then null when r.red_flag is null then now() else coalesce(r.flagged_at, now()) end,
        facts_checked_at = now()
      returning red_flag, (select red_flag from old) as old_flag
    `,
  );
  return row?.red_flag && !row.old_flag ? (row.red_flag as RedFlag) : null;
}

/** Keeps a company's latest accounts, or that it has none. */
async function saveAccounts(number: string, a: RegisterAccounts | null): Promise<void> {
  await db().execute(sql`
    update commerce.register_companies set accounts_year = ${a?.year ?? null}, accounts_currency = ${a?.currency ?? null},
      revenue_minor = ${a?.revenueMinor ?? null}, operating_result_minor = ${a?.operatingResultMinor ?? null}, profit_minor = ${a?.profitMinor ?? null},
      equity_minor = ${a?.equityMinor ?? null}, previous_revenue_minor = ${a?.previousRevenueMinor ?? null}, accounts_checked_at = now()
    where organisation_number = ${number} and status = 'company'
  `);
}

/**
 * Asks the register about one number and keeps the answer: the unit, and with `accounts` its latest accounts too (a company only). Answers
 * the unit's status and the red flag that is new since the last answer. Throws when the register cannot be reached or answers otherwise.
 */
export async function refreshRegisterCompany(number: string, options: { accounts: boolean }, deps: RegisterDeps = {}): Promise<{ status: RegisterUnit["status"]; newFlag: RedFlag | null }> {
  if (!isOrganisationNumber(number)) throw new Error("Not an organisation number.");
  const json = await ask(UNIT_URL(number), deps);
  const unit = json === null ? ({ status: "not_found" } as const) : readUnit(json, today(deps.now ?? new Date()));
  const newFlag = await saveUnit(number, unit);
  if (options.accounts && unit.status === "company") await saveAccounts(number, readAccounts(await ask(ACCOUNTS_URL(number), deps)));
  return { status: unit.status, newFlag };
}

const VIEW_ROW = z.object({
  organisation_number: col.text,
  status: z.enum(["company", "sole_trader", "not_found"]),
  name: col.textOrNull,
  org_form: col.textOrNull,
  org_form_name: col.textOrNull,
  industry_code: col.textOrNull,
  industry_name: col.textOrNull,
  employees: col.int.nullable(),
  founded: col.textOrNull,
  municipality: col.textOrNull,
  website: col.textOrNull,
  red_flag: z.enum(["bankrupt", "winding_up", "dissolution", "deleted"]).nullable(),
  red_flag_on: col.textOrNull,
  flagged_at: col.timestampOrNull,
  accounts_year: col.int.nullable(),
  accounts_currency: col.textOrNull,
  revenue_minor: col.minorOrNull,
  operating_result_minor: col.minorOrNull,
  profit_minor: col.minorOrNull,
  equity_minor: col.minorOrNull,
  previous_revenue_minor: col.minorOrNull,
  facts_checked_at: col.timestamp,
});

function viewOf(r: z.output<typeof VIEW_ROW>): RegisterView {
  return {
    number: r.organisation_number,
    status: r.status,
    facts:
      r.status === "company"
        ? {
            name: r.name,
            orgForm: r.org_form,
            orgFormName: r.org_form_name,
            industryCode: r.industry_code,
            industryName: r.industry_name,
            employees: r.employees,
            founded: r.founded,
            municipality: r.municipality,
            website: r.website,
            redFlag: r.red_flag,
            redFlagOn: r.red_flag_on,
          }
        : null,
    accounts:
      r.accounts_year !== null && r.accounts_currency
        ? {
            year: r.accounts_year,
            currency: r.accounts_currency.trim(),
            revenueMinor: r.revenue_minor,
            operatingResultMinor: r.operating_result_minor,
            profitMinor: r.profit_minor,
            equityMinor: r.equity_minor,
            previousRevenueMinor: r.previous_revenue_minor,
          }
        : null,
    checkedAt: r.facts_checked_at,
    flaggedAt: r.flagged_at,
  };
}

/** What is kept of each of several numbers (nine digits each), by number; a number never asked about is not in the map. */
export async function registerFacts(numbers: readonly string[]): Promise<Map<string, RegisterView>> {
  const wanted = [...new Set(numbers.filter((n) => /^\d{9}$/.test(n)))];
  if (wanted.length === 0) return new Map();
  const rows = await typedRows(
    VIEW_ROW,
    sql`
      select organisation_number, status, name, org_form, org_form_name, industry_code, industry_name, employees, founded::text as founded,
        municipality, website, red_flag, red_flag_on::text as red_flag_on, flagged_at, accounts_year, accounts_currency, revenue_minor,
        operating_result_minor, profit_minor, equity_minor, previous_revenue_minor, facts_checked_at
      from commerce.register_companies where organisation_number = any(${`{${wanted.join(",")}}`}::text[])
    `,
  );
  return new Map(rows.map((r) => [r.organisation_number, viewOf(r)]));
}

/**
 * One company's facts for a page: what is kept, asked of the register first when there is nothing or it is older than `REFRESH_DAYS`, with
 * `PAGE_TIMEOUT_MS` of patience. A register that does not answer leaves what was kept (or nothing): the page draws without it.
 */
export async function registerFactsNow(number: string, deps: RegisterDeps = {}): Promise<RegisterView | null> {
  if (!isOrganisationNumber(number)) return null;
  const kept = (await registerFacts([number])).get(number) ?? null;
  const now = deps.now ?? new Date();
  const stale = !kept || now.getTime() - Date.parse(kept.checkedAt) > REFRESH_DAYS * 86_400_000;
  if (!stale) return kept;
  try {
    await refreshRegisterCompany(number, { accounts: true }, { timeoutMs: PAGE_TIMEOUT_MS, ...deps });
    return (await registerFacts([number])).get(number) ?? kept;
  } catch (error) {
    log("warn", "register_facts.unavailable", { number }, error);
    return kept;
  }
}

// ---------------------------------------------------------------------------
// The daily watch
// ---------------------------------------------------------------------------

const KNOWN = z.object({
  number: col.text,
  status: col.textOrNull,
  facts_checked_at: col.timestampOrNull,
  accounts_checked_at: col.timestampOrNull,
});

export type WatchOutcome = { known: number; added: number; changed: number; accounts: number; flagged: number; alerts: number };

/**
 * The daily run's part (D891): every organisation number we hold that is a Norwegian one (stores' business customers, stores' own
 * businesses, visiting companies Leadfeeder named) is read in one statement with what is kept of it. New numbers are asked about with their
 * accounts; the register's feed of changes is read for the companies kept (`UPDATES_CHUNK` numbers a call, `WATCH_WINDOW_DAYS` back), and a
 * changed company asked again, as is one older than `REFRESH_DAYS`; accounts older than that are asked again. A company newly flagged
 * (bankrupt, wound up, dissolved, deleted) is emailed to the stores that sell to it on payment terms. At most `WATCH_CALLS_PER_RUN` calls;
 * the first call that fails stops the run's asking and is reported, so a register that is down is not asked again and again.
 */
export async function watchRegister(deps: RegisterDeps & { alert?: typeof sendCompanyFlagAlert } = {}): Promise<WatchOutcome> {
  const report = jobReport();
  const now = deps.now ?? new Date();
  const out: WatchOutcome = { known: 0, added: 0, changed: 0, accounts: 0, flagged: 0, alerts: 0 };
  const known = await typedRows(
    KNOWN,
    sql`
      with held as (
        select ${orgNumberSql(sql`c.organisation_number`)} as number from commerce.customer_companies c where c.organisation_number <> ''
        union
        select ${orgNumberSql(sql`s.organisation_number`)} from commerce.stores s
        where s.organisation_number is not null and s.country = 'NO' and s.status = 'active' and not (s.is_template or coalesce(s.starter, false) or s.sandbox or s.workspace)
        union
        select v.register_id from commerce.visit_companies v where v.country_code = 'NO' and v.register_id ~ '^[0-9]{9}$'
      )
      select h.number, r.status, r.facts_checked_at, r.accounts_checked_at
      from held h left join commerce.register_companies r on r.organisation_number = h.number
      where h.number ~ '^[0-9]{9}$'
    `,
  );
  const rows = known.filter((r) => isOrganisationNumber(r.number));
  out.known = rows.length;
  if (rows.length === 0) return out;

  let calls = 0;
  let down = false;
  const flagged: { number: string; flag: RedFlag }[] = [];
  const old = (at: string | null) => !at || now.getTime() - Date.parse(at) > REFRESH_DAYS * 86_400_000;
  /** Asks once, counting the call; the first failure stops every later ask of the run. */
  async function attempt<T>(part: string, run: () => Promise<T>, cost: number): Promise<T | null> {
    if (down || calls + cost > WATCH_CALLS_PER_RUN) return null;
    calls += cost;
    try {
      return await run();
    } catch (error) {
      down = true;
      report(error, part);
      return null;
    }
  }
  const keep = (number: string, result: { newFlag: RedFlag | null } | null) => {
    if (result?.newFlag) flagged.push({ number, flag: result.newFlag });
  };

  // 1. Numbers never asked about: the unit and its accounts.
  for (const r of rows.filter((x) => x.status === null)) {
    const result = await attempt("add", () => refreshRegisterCompany(r.number, { accounts: true }, deps), 2);
    if (result) out.added++;
    keep(r.number, result);
  }

  // 2. Companies the feed says changed, and those not asked about for a while.
  const companies = rows.filter((x) => x.status === "company");
  const changed = new Set(companies.filter((x) => old(x.facts_checked_at)).map((x) => x.number));
  const since = new Date(now.getTime() - WATCH_WINDOW_DAYS * 86_400_000);
  for (let i = 0; i < companies.length; i += UPDATES_CHUNK) {
    const chunk = companies.slice(i, i + UPDATES_CHUNK).map((x) => x.number);
    const json = await attempt("feed", () => askFeed(updatesUrl(since, chunk), deps), 1);
    for (const number of json ? readUpdates(json) : []) if (chunk.includes(number)) changed.add(number);
  }
  for (const number of changed) {
    const result = await attempt("change", () => refreshRegisterCompany(number, { accounts: false }, deps), 1);
    if (result) out.changed++;
    keep(number, result);
  }

  // 3. Accounts not asked for a while (a year's accounts come once a year).
  for (const r of companies.filter((x) => old(x.accounts_checked_at))) {
    const done = await attempt(
      "accounts",
      async () => {
        await saveAccounts(r.number, readAccounts(await ask(ACCOUNTS_URL(r.number), deps)));
        return true;
      },
      1,
    );
    if (done) out.accounts++;
  }

  // 4. A company newly flagged: the stores that sell to it on payment terms are told, once per company and flag.
  out.flagged = flagged.length;
  if (flagged.length > 0) {
    try {
      const terms = await typedRows(
        z.object({ store_id: col.uuid, id: col.uuid, number: col.text }),
        sql`
          select c.store_id, c.id, ${orgNumberSql(sql`c.organisation_number`)} as number
          from commerce.customer_companies c join commerce.stores s on s.id = c.store_id and s.status = 'active'
          where c.payment_terms is not null and ${orgNumberSql(sql`c.organisation_number`)} = any(${`{${flagged.map((f) => f.number).join(",")}}`}::text[])
        `,
      );
      for (const t of terms) {
        const flag = flagged.find((f) => f.number === t.number)?.flag;
        if (!flag) continue;
        const sent = await (deps.alert ?? sendCompanyFlagAlert)(t.store_id, t.id, flag);
        if (sent && sent.sent > 0) out.alerts++;
      }
    } catch (error) {
      report(error, "alerts");
    }
  }
  log("info", "register_watch.done", { ...out, calls });
  return out;
}

/** The feed's answer for some numbers; an empty feed is an empty answer, never a failure. */
async function askFeed(url: string, deps: RegisterDeps): Promise<unknown> {
  return (await ask(url, deps)) ?? {};
}
