import "server-only";

import { sql, type SQL } from "drizzle-orm";

import { db } from "@/db/client";
import { EMAIL_KINDS, EVIDENCE_EMAIL_KINDS } from "@/lib/personal-data";
import {
  RETENTION_KINDS,
  cutoffInstant,
  fallbackPeriod,
  retentionCutoff,
  ruleProblem,
  type Period,
  type RetentionBasis,
  type RetentionKind,
  type RetentionRuleRow,
} from "@/lib/retention";

import { audit } from "./auth";
import { SCHEME_RETENTION_YEARS } from "@/lib/invoice-retention";
import { anonymiseDocuments } from "./invoice-retention";
import { pruneDraftOrders } from "./draft-orders";
import { pruneAnonymisedOrderTags } from "./order-tags";
import { pruneInventoryMovements } from "./stock-alerts";
import { textList } from "./sql-arrays";

type Row = Record<string, unknown>;

/**
 * The retention schedule (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.5), run daily from the cron: plain application code with a clock
 * argument, so a test holds the clock still. Deletion lives here and in `privacy-erasure.ts`, never in a database function (the migration
 * tool cancels such statements); anonymising orders is `commerce.anonymise_expired_orders()` (UPDATE only). Every step is batched at
 * `BATCH`, isolated (a failing one is logged and the next runs) and idempotent (a second run changes nothing). `runRetention()` never throws.
 *
 * The periods are `commerce.retention_rules`, read **only** here (`retentionRules()` for the pure functions, `retentionRule()` for one
 * period through `commerce.retention_rule()`); written only by `commerce.set_retention_rule()` (`changeRetentionRule()`).
 * `retention-readers.test.ts` scans the source for any other reader.
 */

export const BATCH = 5000;
/** Rounds of one batch per step per run: the first run on a large database spreads over days, never one huge statement. */
const MAX_ROUNDS = 10;
/** Orders cost the most (each is several statements), so a run takes at most this many batches per store: a large backlog spreads over days. */
const ORDER_ROUNDS = 2;

const SECURITY_KINDS: string[] = Object.entries(EMAIL_KINDS)
  .filter(([, c]) => c === "security")
  .map(([k]) => k);

// ---------------------------------------------------------------------------------------------------------------------------------
// Reading the rules
// ---------------------------------------------------------------------------------------------------------------------------------

export type StoredRule = RetentionRuleRow & { id: string; verifiedBy: string | null; createdAt: string };

const day = (v: unknown): string => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));

/** Every row of the schedule (history included), for the pure functions of `src/lib/retention.ts` and the platform's page. */
export async function retentionRules(): Promise<StoredRule[]> {
  const rows = await db().execute<Row>(sql`
    select id, kind, country, period_value, period_unit, counts_from, source, source_url, basis, checked_on::text as checked_on,
      valid_from::text as valid_from, valid_to::text as valid_to, enforced_by, note, verified_at, verified_by, created_at
    from commerce.retention_rules order by kind, country nulls first, valid_from
  `);
  return rows.map((r) => ({
    id: String(r.id),
    kind: String(r.kind) as RetentionKind,
    country: r.country ? String(r.country).trim() : null,
    periodValue: Number(r.period_value),
    periodUnit: String(r.period_unit) as Period["periodUnit"],
    countsFrom: String(r.counts_from) as Period["countsFrom"],
    source: String(r.source),
    sourceUrl: r.source_url ? String(r.source_url) : null,
    basis: String(r.basis) as RetentionBasis,
    checkedOn: day(r.checked_on),
    validFrom: day(r.valid_from),
    validTo: r.valid_to ? day(r.valid_to) : null,
    enforcedBy: String(r.enforced_by),
    note: String(r.note ?? ""),
    verifiedAt: r.verified_at ? new Date(String(r.verified_at)).toISOString() : null,
    verifiedBy: r.verified_by ? String(r.verified_by) : null,
    createdAt: new Date(String(r.created_at)).toISOString(),
  }));
}

/**
 * The period that applies to a kind in a country on a day (`YYYY-MM-DD`): the country's own row in force, else the default, else the safe
 * side (ten years), as the database decides it. The one place a pruner reads its period.
 */
export async function retentionRule(kind: RetentionKind, country: string | null, at: string): Promise<Period> {
  const [row] = await db().execute<Row>(sql`
    select period_value, period_unit, counts_from from commerce.retention_rule(${kind}, ${country}::char(2), ${at}::date)
  `);
  if (!row) return fallbackPeriod(kind);
  return { periodValue: Number(row.period_value), periodUnit: String(row.period_unit) as Period["periodUnit"], countsFrom: String(row.counts_from) as Period["countsFrom"] };
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------------------------------------------

export const RETENTION_STEPS = [
  "documents",
  "orders",
  "security_emails",
  "email_bodies",
  "carts",
  "delivery_quotes",
  "customer_codes",
  "customer_sessions",
  "webhook_payloads",
  "consents",
  "privacy_request_contact",
  "privacy_requests",
  "inventory_movements",
  "draft_orders",
  "order_tags",
] as const;
export type RetentionStep = (typeof RETENTION_STEPS)[number];

/** What one step did: how many rows it removed or anonymised, and (for stores' steps) per store. */
export type StepResult = { count: number; perStore?: Record<string, number> };

export type RetentionRun = {
  at: string;
  counts: Record<RetentionStep, number>;
  /** The files of anonymised documents that could not be removed (listed so they can be removed by hand). */
  filesLeft: string[];
  errors: { step: RetentionStep; message: string }[];
};

type StoreRow = { id: string; slug: string; country: string | null; /** The store uses an OSS or IOSS scheme: its records are kept at least ten years (D161). */ scheme: boolean };
type Ctx = { now: Date; rules: StoredRule[]; storesList: () => Promise<StoreRow[]>; filesLeft: string[]; batch: number };
export type StepFn = (ctx: Ctx) => Promise<StepResult>;

const dayOf = (at: Date) => at.toISOString().slice(0, 10);

async function loadStores(): Promise<StoreRow[]> {
  const rows = await db().execute<Row>(sql`
    select s.id, s.slug, s.country, coalesce(p.oss_scheme, 'none') <> 'none' or p.ioss_number is not null as scheme
      from commerce.stores s left join commerce.store_tax_profile p on p.store_id = s.id
     order by s.created_at`);
  return rows.map((r) => ({ id: String(r.id), slug: String(r.slug), country: r.country ? String(r.country).trim() : null, scheme: r.scheme === true }));
}

/** The store's own day for an instant that is never later than the database's own clock (the SQL functions refuse a future day). */
async function storeToday(storeId: string, now: Date): Promise<string> {
  const [row] = await db().execute<Row>(sql`select commerce.store_day(${storeId}::uuid, least(${now.toISOString()}::timestamptz, now()))::text as d`);
  return String(row?.d ?? dayOf(now)).slice(0, 10);
}

async function period(ctx: Ctx, kind: RetentionKind): Promise<Period> {
  return retentionRule(kind, null, dayOf(ctx.now));
}

/** Runs one batched statement until a round returns less than a batch (at most `MAX_ROUNDS` rounds); the statement returns the ids it changed. */
async function batched(batch: number, statement: () => Promise<unknown[]>): Promise<number> {
  let total = 0;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const rows = await statement();
    total += rows.length;
    if (rows.length < batch) break;
  }
  return total;
}

const STEPS: Record<RetentionStep, StepFn> = {
  // 1. Documents past the seller's country's period (the 1b function, called first: a document is never anonymised later than its order).
  async documents(ctx) {
    const perStore: Record<string, number> = {};
    let count = 0;
    for (const store of await ctx.storesList()) {
      const today = await storeToday(store.id, ctx.now);
      const byCountry = retentionCutoff(store.country, today, ctx.rules);
      // A store that uses the OSS or IOSS schemes keeps its records at least ten years (D161); the scheme never shortens a period.
      const bySchemes = `${String(Number(today.slice(0, 4)) - SCHEME_RETENTION_YEARS).padStart(4, "0")}-01-01`;
      const cutoff = store.scheme && bySchemes < byCountry ? bySchemes : byCountry;
      const result = await anonymiseDocuments(store.id, cutoff);
      perStore[store.id] = result.documents;
      count += result.documents;
      ctx.filesLeft.push(...result.filesLeft);
    }
    return { count, perStore };
  },

  // 2 and 3. Orders (and, through the function, their withdrawals, returns' notes and VAT checks): sales past the period, host orders on
  // their own period, and orders never paid after their own. `commerce.anonymise_expired_orders()` judges by the database's clock.
  async orders(ctx) {
    const perStore: Record<string, number> = {};
    let count = 0;
    for (const store of await ctx.storesList()) {
      const today = await storeToday(store.id, ctx.now);
      let n = 0;
      for (let round = 0; round < ORDER_ROUNDS; round++) {
        const [row] = await db().execute<Row>(sql`select commerce.anonymise_expired_orders(${store.id}::uuid, ${today}::date, ${ctx.batch}::integer) as n`);
        const done = Number(row?.n ?? 0);
        n += done;
        if (done < ctx.batch) break;
      }
      if (n > 0) {
        // What hung on the anonymised orders: staff-entered field values, and the evidence emails that waited for their order.
        await db().execute(sql`
          delete from commerce.field_values fv using commerce.orders o
          where fv.store_id = ${store.id}::uuid and fv.entity = 'order' and o.store_id = fv.store_id and o.id = fv.entity_id and o.anonymised_at is not null
        `);
        await blankEmails(ctx, sql`e.store_id = ${store.id}::uuid and e.kind = any(${textList(EVIDENCE_EMAIL_KINDS)})
          and exists (select 1 from commerce.orders o where o.id = e.order_id and o.anonymised_at is not null)`);
      }
      perStore[store.id] = n;
      count += n;
    }
    return { count, perStore };
  },

  // 5. Sign-in codes, links, password resets and invitations: of no use after a short time.
  async security_emails(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "security_emails"), ctx.now);
    return { count: await blankEmails(ctx, sql`e.kind = any(${textList(SECURITY_KINDS)}) and e.created_at < ${cutoff.toISOString()}::timestamptz`) };
  },

  // 4. Email bodies: the row stays (its idempotency key stops a replayed webhook from sending again); evidence kinds wait for their order.
  async email_bodies(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "email_bodies"), ctx.now);
    return {
      count: await blankEmails(ctx, sql`e.created_at < ${cutoff.toISOString()}::timestamptz
        and (e.kind <> all(${textList(EVIDENCE_EMAIL_KINDS)}) or e.order_id is null
             or exists (select 1 from commerce.orders o where o.id = e.order_id and o.anonymised_at is not null))`),
    };
  },

  // 6. Carts: the person and the company details go, the row stays (an order may point at it).
  async carts(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "carts"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          update commerce.carts set customer_id = null, company_name = null, organisation_number = null, vat_number = null, vat_check_id = null, affiliate_code = null
          where id in (
            select c.id from commerce.carts c
            where (c.customer_id is not null or c.company_name is not null or c.organisation_number is not null or c.vat_number is not null
                   or c.vat_check_id is not null or c.affiliate_code is not null)
              and coalesce(case when c.status = 'open' then c.expires_at end, c.updated_at) < ${cutoff}::timestamptz
            order by c.id limit ${ctx.batch})
          returning id
        `),
      ),
    };
  },

  // 7. Delivery quotes: the postal code a delivery was priced for.
  async delivery_quotes(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "delivery_quotes"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          update commerce.delivery_quotes set postal_code = '', pickup_points = '[]'::jsonb
          where id in (
            select q.id from commerce.delivery_quotes q
            where q.expires_at < ${cutoff}::timestamptz and (q.postal_code <> '' or q.pickup_points <> '[]'::jsonb) order by q.id limit ${ctx.batch})
          returning id
        `),
      ),
    };
  },

  // 8. Sign-in codes: every address that ever asked for one would otherwise be kept for ever.
  async customer_codes(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "customer_codes"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          delete from commerce.customer_codes where id in (select id from commerce.customer_codes where expires_at < ${cutoff}::timestamptz order by id limit ${ctx.batch}) returning id
        `),
      ),
    };
  },

  // 9. Sessions that expired a month ago.
  async customer_sessions(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "customer_sessions"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          delete from commerce.customer_sessions where id in (select id from commerce.customer_sessions where expires_at < ${cutoff}::timestamptz order by id limit ${ctx.batch}) returning id
        `),
      ),
    };
  },

  // 10. A payment provider's event holds a name, an email and an address: emptied after 90 days, the row stays so its id still de-duplicates.
  async webhook_payloads(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "webhook_payloads"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          update commerce.webhook_events set payload = '{}'::jsonb
          where id in (select id from commerce.webhook_events where processed_at < ${cutoff}::timestamptz and payload <> '{}'::jsonb order by id limit ${ctx.batch})
          returning id
        `),
      ),
    };
  },

  // 11. The cookie consent log (the pg_cron job does the same where the extension exists; both are idempotent).
  async consents(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "consents"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          delete from commerce.consents where id in (select id from commerce.consents where created_at < ${cutoff}::timestamptz order by id limit ${ctx.batch}) returning id
        `),
      ),
    };
  },

  // 12. The address a finished request was logged under is forgotten after 30 days (the table's rule lets only this change an answered row).
  async privacy_request_contact(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "privacy_request_contact"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          update commerce.privacy_requests set subject_email = null
          where id in (select id from commerce.privacy_requests where status <> 'open' and subject_email is not null
                         and completed_at < ${cutoff}::timestamptz order by id limit ${ctx.batch})
          returning id
        `),
      ),
    };
  },

  // 13. The request record itself after 24 months: the one deletion the table's guard allows (it refuses a younger one whoever asks).
  async privacy_requests(ctx) {
    const cutoff = cutoffInstant(await period(ctx, "privacy_requests"), ctx.now).toISOString();
    return {
      count: await batched(ctx.batch, () =>
        db().execute(sql`
          delete from commerce.privacy_requests
          where id in (select id from commerce.privacy_requests where status <> 'open'
                         and completed_at < least(${cutoff}::timestamptz, now() - interval '24 months') order by id limit ${ctx.batch})
          returning id
        `),
      ),
    };
  },

  // 14. The history of stock after 24 months (wave 3, D172): the guard of the table allows exactly this deletion and no younger one. A movement holds no
  // personal data, so this is a size limit, not an erasure.
  async inventory_movements(ctx) {
    return { count: await pruneInventoryMovements(ctx.now, ctx.batch, MAX_ROUNDS) };
  },

  // Draft orders (wave 3, D173, docs/wave-3-orders.md 3.6): an open draft not edited for 90 days, a finished one 30 days after it ended. Their contact data is deleted; the orders they made keep all their own.
  async draft_orders(ctx) {
    return { count: await pruneDraftOrders(ctx.now) };
  },

  // The tags of orders that are anonymised (D162): staff text about a person's order goes with the person (the SQL anonymising function holds no delete, so this is application code).
  async order_tags() {
    return { count: await pruneAnonymisedOrderTags() };
  },
};

/** Blanks sent emails matching a condition (alias `e`): address, subject and bodies go, the row and its idempotency key stay. */
async function blankEmails(ctx: Ctx, condition: SQL): Promise<number> {
  return batched(ctx.batch, () =>
    db().execute(sql`
      update commerce.email_messages set to_address = '[removed]', subject = '[removed]', html = '', text = ''
      where id in (
        select e.id from commerce.email_messages e where e.to_address <> '[removed]' and ${condition} order by e.created_at, e.id limit ${ctx.batch})
      returning id
    `),
  );
}

/**
 * The daily run: documents, orders, then the small tables, in this order; a failing step is logged and the next runs. The totals are
 * written to the audit log as one platform entry (`retention.run`, counts only) and, per store with anything removed,
 * `privacy.retention_applied`, so an owner sees what the schedule did. Never throws.
 */
export async function runRetention(now: Date = new Date(), deps: { steps?: Partial<Record<RetentionStep, StepFn>>; batch?: number } = {}): Promise<RetentionRun> {
  const run: RetentionRun = {
    at: now.toISOString(),
    counts: Object.fromEntries(RETENTION_STEPS.map((s) => [s, 0])) as Record<RetentionStep, number>,
    filesLeft: [],
    errors: [],
  };
  let stores: Promise<StoreRow[]> | null = null;
  let rules: StoredRule[] = [];
  try {
    rules = await retentionRules();
  } catch (error) {
    console.error("[retention] the rules could not be read", error);
  }
  const ctx: Ctx = { now, rules, storesList: () => (stores ??= loadStores()), filesLeft: run.filesLeft, batch: deps.batch ?? BATCH };
  const perStore = new Map<string, { documents: number; orders: number }>();
  for (const step of RETENTION_STEPS) {
    try {
      const result = await (deps.steps?.[step] ?? STEPS[step])(ctx);
      run.counts[step] = result.count;
      if (result.perStore && (step === "documents" || step === "orders")) {
        for (const [storeId, n] of Object.entries(result.perStore)) {
          const entry = perStore.get(storeId) ?? { documents: 0, orders: 0 };
          entry[step] += n;
          perStore.set(storeId, entry);
        }
      }
    } catch (error) {
      console.error(`[retention] ${step} failed`, error);
      run.errors.push({ step, message: error instanceof Error ? error.message.slice(0, 300) : "failed" });
    }
  }
  try {
    await audit(null, null, "retention.run", { ...run.counts, errors: run.errors.length, filesLeft: run.filesLeft.length }, { area: "platform" });
    for (const [storeId, n] of perStore) {
      if (n.documents + n.orders > 0) await audit(null, storeId, "privacy.retention_applied", { documents: n.documents, orders: n.orders }, { area: "customers" });
    }
  } catch (error) {
    console.error("[retention] the run could not be written to the activity log", error);
  }
  return run;
}

// ---------------------------------------------------------------------------------------------------------------------------------
// The platform's page
// ---------------------------------------------------------------------------------------------------------------------------------

export type RetentionOverview = {
  rules: StoredRule[];
  unverified: number;
  /** The last daily results (`retention.run`), newest first. */
  lastRuns: { at: string; counts: Record<string, number>; errors: number; filesLeft: number }[];
};

export async function retentionOverview(limit = 30): Promise<RetentionOverview> {
  const [rules, runs] = await Promise.all([
    retentionRules(),
    db().execute<Row>(sql`
      select created_at, details from commerce.audit_log where action = 'retention.run' order by created_at desc, id desc limit ${limit}
    `),
  ]);
  const current = rules.filter((r) => r.validTo === null);
  return {
    rules,
    unverified: current.filter((r) => !r.verifiedAt).length,
    lastRuns: runs.map((r) => {
      const d = (r.details ?? {}) as Record<string, unknown>;
      const counts: Record<string, number> = {};
      for (const step of RETENTION_STEPS) counts[step] = Number(d[step] ?? 0);
      return { at: new Date(String(r.created_at)).toISOString(), counts, errors: Number(d.errors ?? 0), filesLeft: Number(d.filesLeft ?? 0) };
    }),
  };
}

export type ChangeRuleInput = {
  kind: RetentionKind;
  country: string | null;
  periodValue: number;
  periodUnit: "days" | "months";
  countsFrom: "event" | "end_of_year";
  source: string;
  sourceUrl: string | null;
  basis: RetentionBasis;
  checkedOn: string;
  validFrom: string;
  note: string;
};

export type ChangeRuleResult = { ok: true; id: string } | { ok: false; problem: string };

/** The database's own message for an error (drizzle wraps the driver's error: the text is on its cause). */
const dbMessage = (error: unknown): string => {
  const e = error as { message?: string; cause?: { message?: string } } | null;
  return `${e?.cause?.message ?? ""} ${e?.message ?? ""}`;
};

const DB_PROBLEMS: Record<string, string> = {
  retention_rule_floor: "Bookkeeping data is kept at least five years (60 months).",
  retention_rule_ceiling: "A period above fifty years is not allowed.",
  retention_rule_period: "A period is a whole number of days or months above zero.",
  retention_rule_backdated: "The new rule must start after the latest one for this kind and country.",
  retention_rule_country: "That country is not known.",
  retention_rule_dates: "A rule needs the day it starts and the day it was checked.",
};

/** A platform admin changes a period: never an edit in place, a new row with the old one closed (`commerce.set_retention_rule()`). The caller checks the account is a platform admin. */
export async function changeRetentionRule(accountId: string, input: ChangeRuleInput): Promise<ChangeRuleResult> {
  if (!(RETENTION_KINDS as readonly string[]).includes(input.kind)) return { ok: false, problem: "That kind of data is not on the schedule." };
  const refusal = ruleProblem(input.kind, { periodValue: input.periodValue, periodUnit: input.periodUnit, countsFrom: input.countsFrom });
  if (refusal) {
    return {
      ok: false,
      problem: {
        floor: DB_PROBLEMS.retention_rule_floor,
        ceiling: DB_PROBLEMS.retention_rule_ceiling,
        period: DB_PROBLEMS.retention_rule_period,
        year_unit: "A period counted from the end of the year is a whole number of years.",
      }[refusal],
    };
  }
  if (input.source.trim().length === 0) return { ok: false, problem: "Say where the period comes from." };
  try {
    const [row] = await db().execute<Row>(sql`
      select commerce.set_retention_rule(
        ${input.kind}, ${input.country}::char(2), ${input.periodValue}::integer, ${input.periodUnit}, ${input.countsFrom}, ${input.source.trim()},
        ${input.sourceUrl}, ${input.basis}, ${input.checkedOn}::date, ${input.validFrom}::date, null, ${input.note.trim()}, ${accountId}::uuid
      ) as id
    `);
    return { ok: true, id: String(row.id) };
  } catch (error) {
    const message = dbMessage(error);
    const code = Object.keys(DB_PROBLEMS).find((c) => message.includes(c));
    if (code) return { ok: false, problem: DB_PROBLEMS[code] };
    throw error;
  }
}

/** Marks a rule as reviewed by a person (once; a later change is a new rule). The caller checks the account is a platform admin. */
export async function verifyRetentionRule(accountId: string, ruleId: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  try {
    await db().execute(sql`select commerce.verify_retention_rule(${ruleId}::uuid, ${accountId}::uuid)`);
    return { ok: true };
  } catch (error) {
    if (dbMessage(error).includes("retention_rule_verified")) return { ok: false, problem: "No such rule, or it is already reviewed." };
    throw error;
  }
}
