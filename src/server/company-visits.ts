import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import {
  COMPANY_PAGES_KEPT,
  enrichUrl,
  isLookupAddress,
  isSoleTrader,
  LOOKUP_KEEP_DAYS,
  LOOKUP_MAX_BODY_BYTES,
  LOOKUP_TIMEOUT_MS,
  LOOKUPS_PER_STORE_DAY,
  lookupKey,
  norwegianNumber,
  readEnrichAnswer,
  type CompanyDay,
  type CompanyFacts,
  type CompanyVisitInput,
  type LookupAnswer,
} from "@/lib/company-lookup";
import { OTHER_PAGE, RETENTION_MONTHS } from "@/lib/visit-record";

import { visitSecret } from "./analytics-visits";
import { lookupCompany } from "./brreg";
import { cappedText } from "./capped-text";
import { companyLookupConnection, type CompanyLookupConnection } from "./company-lookup-settings";
import { log } from "./log";
import { col, typedRow, typedRows } from "./typed-rows";

/**
 * Which companies visited (D890, `docs/analytics.md` "Companies"): the one writer of `visit_companies`, `company_visits` and
 * `company_lookups`, and their reads. A page view the visit counter counted, on a store with `company_recognition` on, comes here after
 * the beacon has been answered (`/api/visit`, `after()`): its address is asked about once a UTC day whatever the store (the day's answer is
 * kept under a keyed hash, never the address), through Kaizena Flow's Leadfeeder connection, and only a company is kept: the company's
 * facts once, and the store's day for it (visitor-days, page views, the page shapes). The address is held in memory for the request and
 * sent to Leadfeeder only; it is never written to a table or a log.
 */

export type CompanyVisitOutcome = "company" | "none" | "not_connected" | "no_address" | "no_key" | "capped" | "failed";

/** What the lookup is done with: Leadfeeder by default, a stand-in in tests. */
export type LookupDeps = {
  connection?: () => Promise<CompanyLookupConnection | null>;
  lookup?: (connection: CompanyLookupConnection, address: string) => Promise<LookupAnswer>;
  /** Whether a Norwegian organisation number is a sole trader's (Brønnøysund's organisation form `ENK`), null when unknown. */
  norwegianSoleTrader?: (organisationNumber: string) => Promise<boolean | null>;
};

/**
 * Asks Leadfeeder about one address (`GET /v1/ip/enrich`): only its fixed host, with the address and the account id in the query and the
 * key in `X-Api-Key`; no redirect is followed. A 404 is no company; any other answer that is not a 200 of the documented shape, a timeout
 * or a network error is a failure, and the visit is counted without its company.
 */
export async function enrichAddress(connection: CompanyLookupConnection, address: string, doFetch: typeof fetch = fetch): Promise<LookupAnswer> {
  try {
    const response = await doFetch(enrichUrl(address, connection.accountId), {
      headers: { Accept: "application/json", "X-Api-Key": connection.apiKey },
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS),
    });
    if (response.status === 404) return { kind: "none" };
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return { kind: "failed", reason: `http_${response.status}` };
    }
    return readEnrichAnswer(JSON.parse(await cappedText(response, LOOKUP_MAX_BODY_BYTES)));
  } catch (error) {
    const name = error instanceof Error ? error.name : "";
    return { kind: "failed", reason: name === "TimeoutError" || name === "AbortError" ? "timeout" : name === "SyntaxError" ? "shape" : "network" };
  }
}

/** Brønnøysund's word on a Norwegian organisation number: a sole trader (`ENK`) or not; null when the register cannot say. */
async function brregSoleTrader(organisationNumber: string): Promise<boolean | null> {
  const found = await lookupCompany(organisationNumber);
  return found.ok ? found.company.organisationForm === "ENK" : null;
}

const CACHED = z.object({ outcome: z.enum(["company", "none", "failed"]), company_id: col.uuid.nullable() });
const SAVED = z.object({ id: col.uuid });

/**
 * Keeps a company Leadfeeder named, updating its facts, and answers its id; null for a sole trader, whose company is a person and which is
 * never kept: by its legal form (`isSoleTrader()`), and, for a Norwegian company first seen, by Brønnøysund's organisation form `ENK`.
 */
async function saveCompany(company: CompanyFacts, deps: LookupDeps): Promise<string | null> {
  if (isSoleTrader(company.legalForm)) return null;
  const number = company.countryCode === "NO" ? norwegianNumber(company.registerId) : null;
  if (number) {
    const known = await typedRow(SAVED, sql`select id from commerce.visit_companies where source = 'leadfeeder' and source_id = ${company.sourceId}`);
    if (!known && (await (deps.norwegianSoleTrader ?? brregSoleTrader)(number))) return null;
  }
  const saved = await typedRow(
    SAVED,
    sql`
      insert into commerce.visit_companies
        (source, source_id, name, legal_form, domain, country_code, city, industry, employees, register_id, do_not_contact, updated_at)
      values ('leadfeeder', ${company.sourceId}, ${company.name}, ${company.legalForm}, ${company.domain}, ${company.countryCode}, ${company.city},
        ${company.industry}, ${company.employees}, ${company.registerId}, ${company.doNotContact}, now())
      on conflict (source, source_id) do update set name = excluded.name, legal_form = excluded.legal_form, domain = excluded.domain,
        country_code = excluded.country_code, city = excluded.city, industry = excluded.industry, employees = excluded.employees,
        register_id = excluded.register_id, do_not_contact = excluded.do_not_contact, updated_at = now()
      returning id
    `,
  );
  if (!saved) throw new Error("A company could not be kept.");
  return saved.id;
}

/** Counts a lookup the day's answers did not hold against the store's daily bound (`LOOKUPS_PER_STORE_DAY`); false past it. */
async function takeLookup(storeId: string, at: string): Promise<boolean> {
  const [row] = await db().execute(sql`
    insert into commerce.chat_usage (store_id, bucket, "window", count)
    values (${storeId}::uuid, 'company-lookups', date_trunc('day', ${at}::timestamptz), 1)
    on conflict (store_id, bucket, "window") do update set count = commerce.chat_usage.count + 1
    returning count
  `);
  return Number((row as { count?: unknown } | undefined)?.count ?? 0) <= LOOKUPS_PER_STORE_DAY;
}

/**
 * Counts a page view for the company whose network it came from (D890). The day's answer for the address is read first; without one, and
 * within the store's daily bound, Leadfeeder is asked and its answer kept for the UTC day (a failure too, so a broken service is not asked
 * on every page view). A sole trader is never kept or counted. Then one statement adds the page view to the store's day for the
 * company: a visitor when the page view started the visitor's day, the page's shape (a new one past `COMPANY_PAGES_KEPT` counts as
 * `(other)`). Never throws: the beacon has been answered, and a failure only costs this page view its company.
 */
export async function recordCompanyVisit(input: CompanyVisitInput, deps: LookupDeps = {}): Promise<CompanyVisitOutcome> {
  try {
    if (!isLookupAddress(input.address)) return "no_address";
    const secret = visitSecret();
    if (!secret) return "no_key";
    const now = input.now ?? new Date();
    const at = now.toISOString();
    const utcDay = at.slice(0, 10);
    const key = lookupKey(secret, utcDay, input.address);

    let companyId: string | null = null;
    const cached = await typedRow(CACHED, sql`select outcome, company_id from commerce.company_lookups where key = ${key}`);
    if (cached) {
      if (cached.outcome !== "company" || !cached.company_id) return cached.outcome === "failed" ? "failed" : "none";
      companyId = cached.company_id;
    } else {
      const connection = await (deps.connection ?? companyLookupConnection)();
      if (!connection) return "not_connected";
      if (!(await takeLookup(input.storeId, at))) return "capped";
      const answer = await (deps.lookup ?? ((c, a) => enrichAddress(c, a)))(connection, input.address);
      let outcome: "company" | "none" | "failed" = answer.kind;
      if (answer.kind === "company") {
        companyId = await saveCompany(answer.company, deps);
        // A sole trader is a person: nothing of it is kept, and the day's answer says only that there is nothing to show.
        if (!companyId) outcome = "none";
      } else if (answer.kind === "failed") {
        log("warn", "company_lookup.failed", { store: input.storeId, reason: answer.reason });
      }
      await db().execute(sql`
        insert into commerce.company_lookups (key, day, company_id, outcome)
        values (${key}, ${utcDay}::date, ${outcome === "company" ? companyId : null}::uuid, ${outcome})
        on conflict (key) do nothing
      `);
      if (outcome !== "company") return outcome;
    }

    await db().execute(sql`
      insert into commerce.company_visits as cv (store_id, day, company_id, visitors, page_views, pages, first_seen, last_seen)
      values (${input.storeId}::uuid, ${input.day}::date, ${companyId}::uuid, ${input.newVisitor ? 1 : 0}, 1,
        jsonb_build_object(${input.page}::text, 1), ${at}::timestamptz, ${at}::timestamptz)
      on conflict (store_id, day, company_id) do update set
        visitors = cv.visitors + excluded.visitors,
        page_views = cv.page_views + 1,
        last_seen = greatest(cv.last_seen, excluded.last_seen),
        pages = (
          select jsonb_set(cv.pages, array[k], to_jsonb(coalesce((cv.pages ->> k)::int, 0) + 1))
          from (
            select case when cv.pages ? ${input.page}::text or (select count(*) from jsonb_object_keys(cv.pages)) < ${COMPANY_PAGES_KEPT}
              then ${input.page}::text else ${OTHER_PAGE}::text end as k
          ) chosen
        )
    `);
    return "company";
  } catch (error) {
    log("warn", "company_visit.failed", { store: input.storeId }, error);
    return "failed";
  }
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type VisitCompany = {
  id: string;
  name: string;
  legalForm: string | null;
  domain: string | null;
  countryCode: string | null;
  city: string | null;
  industry: string | null;
  employees: string | null;
  registerId: string | null;
  doNotContact: boolean;
};

const DAY_ROW = z.object({
  company_id: col.uuid,
  day: col.text,
  visitors: col.int,
  page_views: col.int,
  pages: z.record(z.string(), z.number()),
  last_seen: col.timestamp,
});

const COMPANY_ROW = z.object({
  id: col.uuid,
  name: col.text,
  legal_form: col.textOrNull,
  domain: col.textOrNull,
  country_code: col.textOrNull,
  city: col.textOrNull,
  industry: col.textOrNull,
  employees: col.textOrNull,
  register_id: col.textOrNull,
  do_not_contact: col.bool,
});

/**
 * A store's companies over a period of store days (`from` inclusive, `to` exclusive): each day of each company, and the companies' facts.
 * Through the `(store_id, day, company_id)` key.
 */
export async function companyReport(storeId: string, period: { from: string; to: string }): Promise<{ days: CompanyDay[]; companies: Map<string, VisitCompany> }> {
  const rows = await typedRows(
    DAY_ROW,
    sql`
      select cv.company_id, cv.day::text as day, cv.visitors, cv.page_views, cv.pages, cv.last_seen
      from commerce.company_visits cv
      where cv.store_id = ${storeId}::uuid and cv.day >= ${period.from}::date and cv.day < ${period.to}::date
    `,
  );
  const ids = [...new Set(rows.map((r) => r.company_id))];
  const companies = new Map<string, VisitCompany>();
  if (ids.length > 0) {
    const facts = await typedRows(
      COMPANY_ROW,
      sql`
        select id, name, legal_form, domain, trim(country_code) as country_code, city, industry, employees, register_id, do_not_contact
        from commerce.visit_companies where id = any(${`{${ids.join(",")}}`}::uuid[])
      `,
    );
    for (const f of facts) {
      companies.set(f.id, {
        id: f.id,
        name: f.name,
        legalForm: f.legal_form,
        domain: f.domain,
        countryCode: f.country_code,
        city: f.city,
        industry: f.industry,
        employees: f.employees,
        registerId: f.register_id,
        doNotContact: f.do_not_contact,
      });
    }
  }
  return {
    days: rows.map((r) => ({ companyId: r.company_id, day: r.day, visitors: r.visitors, pageViews: r.page_views, pages: r.pages, lastSeen: r.last_seen })),
    companies,
  };
}

/** Whether the store has counted any company yet, at any time: the page then explains an empty period differently from a first wait. */
export async function hasCompanyVisits(storeId: string): Promise<boolean> {
  const row = await typedRow(z.object({ one: col.int }), sql`select 1 as one from commerce.company_visits where store_id = ${storeId}::uuid limit 1`);
  return row !== null;
}

// ---------------------------------------------------------------------------
// Retention (the daily job)
// ---------------------------------------------------------------------------

const BATCH = 5_000;
const MAX_BATCHES = 40;

/**
 * The daily job's part (D890): the day's answers older than `LOOKUP_KEEP_DAYS`, a store's company days older than the visits' 25 months,
 * and companies no store's days point at any more. In batches; never throws, what it managed is returned.
 */
export async function pruneCompanyVisits(now: Date = new Date()): Promise<{ lookups: number; days: number; companies: number }> {
  const done = { lookups: 0, days: 0, companies: 0 };
  try {
    const today = sql`(${now.toISOString()}::timestamptz at time zone 'UTC')::date`;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const gone = await db().execute(sql`
        delete from commerce.company_lookups where key in (
          select key from commerce.company_lookups where day < ${today} - ${LOOKUP_KEEP_DAYS}::int limit ${BATCH}
        ) returning 1
      `);
      done.lookups += gone.length;
      if (gone.length < BATCH) break;
    }
    const cutoff = sql`(${today} - make_interval(months => ${RETENTION_MONTHS}))::date`;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const gone = await db().execute(sql`
        delete from commerce.company_visits where (store_id, day, company_id) in (
          select store_id, day, company_id from commerce.company_visits where day < ${cutoff} limit ${BATCH}
        ) returning 1
      `);
      done.days += gone.length;
      if (gone.length < BATCH) break;
    }
    const orphans = await db().execute(sql`
      delete from commerce.visit_companies c
      where not exists (select 1 from commerce.company_visits cv where cv.company_id = c.id)
        and not exists (select 1 from commerce.company_lookups l where l.company_id = c.id)
        and c.updated_at < ${now.toISOString()}::timestamptz - interval '7 days'
      returning 1
    `);
    done.companies = orphans.length;
  } catch (error) {
    log("warn", "company_visits.prune_failed", {}, error);
  }
  return done;
}
