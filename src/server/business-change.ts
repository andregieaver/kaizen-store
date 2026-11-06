import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { zonedDate } from "@/lib/booking-slots";
import { LEGAL_ROLES } from "@/lib/legal-roles";
import {
  BUSINESS_SERIES,
  TICKED_STEPS,
  cleanBusinessChange,
  type BusinessChangeProblem,
  type BusinessChecklistFacts,
  type BusinessForm,
  type BusinessSeries,
  type BusinessStep,
} from "@/lib/business-change";
import { featureOn } from "@/lib/store-features";

import { audit, type Membership } from "./auth";
import { log } from "./log";
import { memberCan } from "./permissions";
import { refreshStoreById, type Store } from "./stores";
import { col, typedRows } from "./typed-rows";

/**
 * Changing the business behind a store (B8 of `docs/own-books-and-sales.md` section 4.5, D473): the one reader and writer of
 * `commerce.store_business_changes`. A change is planned by the store's owner, one at a time, and takes effect in the database
 * (`commerce.apply_business_change()`): at the start of its day, whichever comes first of the first document issued that day and the
 * dispatcher's `businessChanges` job, which then draws the store again. Audited as `business.*` with ids only.
 */

export type BusinessChange = {
  id: string;
  status: "planned" | "applied" | "cancelled";
  startsOn: string;
  legalName: string;
  businessForm: BusinessForm;
  organisationNumber: string | null;
  vatRegistered: boolean;
  vatNumber: string | null;
  postalAddress: string | null;
  prefixes: Partial<Record<BusinessSeries, string>>;
  /** The store's business as it was before the change took effect. */
  before: { legalName: string | null; organisationNumber: string | null; vatNumber: string | null } | null;
  /** Each series' first document under the new business. */
  seriesStart: Partial<Record<BusinessSeries, string>> | null;
  appliedAt: string | null;
  /** The checklist's steps the owner ticked. */
  checked: string[];
};

export type BusinessChangeResult = { ok: true; id: string } | { ok: false; problems: (BusinessChangeProblem | "forbidden" | "not_found")[] };

const row = z.object({
  id: col.uuid,
  status: z.enum(["planned", "applied", "cancelled"]),
  starts_on: z.string(),
  legal_name: col.text,
  business_form: z.enum(["enk", "as", "asa", "nuf", "da", "ans", "sa", "other"]),
  organisation_number: col.textOrNull,
  vat_registered: col.bool,
  vat_number: col.textOrNull,
  postal_address: col.textOrNull,
  prefixes: z.record(z.string(), z.unknown()),
  before: z.record(z.string(), z.unknown()).nullable(),
  series_start: z.record(z.string(), z.unknown()).nullable(),
  applied_at: col.timestampOrNull,
  checked: z.array(z.string()),
});

const textOrNull = (value: unknown) => (typeof value === "string" && value !== "" ? value : null);
const seriesMap = (value: Record<string, unknown> | null): Partial<Record<BusinessSeries, string>> =>
  Object.fromEntries(BUSINESS_SERIES.flatMap((s) => (typeof value?.[s] === "string" ? [[s, value[s] as string]] : [])));

/** A store's changes of business: the planned one first, then those that took effect, the latest first. Cancelled ones are left out. */
export async function businessChangesOf(storeId: string): Promise<BusinessChange[]> {
  const rows = await typedRows(
    row,
    sql`
      select id, status, starts_on::text, legal_name, business_form, organisation_number, vat_registered, vat_number, postal_address, prefixes,
             before, series_start, applied_at, checked
        from commerce.store_business_changes
       where store_id = ${storeId}::uuid and status <> 'cancelled'
       order by status = 'planned' desc, starts_on desc, created_at desc
       limit 20
    `,
  );
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    startsOn: r.starts_on,
    legalName: r.legal_name,
    businessForm: r.business_form,
    organisationNumber: r.organisation_number,
    vatRegistered: r.vat_registered,
    vatNumber: r.vat_number,
    postalAddress: r.postal_address,
    prefixes: seriesMap(r.prefixes),
    before: r.before ? { legalName: textOrNull(r.before.legalName), organisationNumber: textOrNull(r.before.organisationNumber), vatNumber: textOrNull(r.before.vatNumber) } : null,
    seriesStart: r.series_start ? seriesMap(r.series_start) : null,
    appliedAt: r.applied_at,
    checked: r.checked,
  }));
}

/**
 * A change planned, or the planned one changed (the store's owner only): checked against the store's country and today in its time zone.
 * The organisation number may come later; the change waits for it on its day.
 */
export async function planBusinessChange(member: Membership, raw: Record<string, unknown>): Promise<BusinessChangeResult> {
  if (!memberCan(member, "owner")) return { ok: false, problems: ["forbidden"] };
  const { store } = member;
  const cleaned = cleanBusinessChange(raw, {
    country: store.details.country || null,
    today: zonedDate(Date.now(), store.timeZone),
    organisationNumber: store.details.organisationNumber || null,
  });
  if (!cleaned.ok) return cleaned;
  const c = cleaned.change;
  const id = await db().transaction(async (tx) => {
    const values = sql`${c.startsOn}::date, ${c.legalName}, ${c.businessForm}, ${c.organisationNumber}, ${c.vatRegistered}, ${c.vatNumber}, ${c.postalAddress}, ${JSON.stringify(c.prefixes)}::jsonb`;
    const [changed] = await tx.execute<{ id: string }>(sql`
      update commerce.store_business_changes
         set (starts_on, legal_name, business_form, organisation_number, vat_registered, vat_number, postal_address, prefixes) = (${values}), updated_at = now()
       where store_id = ${store.id}::uuid and status = 'planned'
      returning id
    `);
    if (changed) return changed.id;
    const [made] = await tx.execute<{ id: string }>(sql`
      insert into commerce.store_business_changes (store_id, starts_on, legal_name, business_form, organisation_number, vat_registered, vat_number, postal_address, prefixes, created_by)
      values (${store.id}::uuid, ${values}, ${member.account.id}::uuid)
      returning id
    `);
    return made.id;
  });
  await audit(member.account.id, store.id, "business.change_planned", { change: id, form: c.businessForm, startsOn: c.startsOn }, { area: "settings", target: { type: "business_change", id } });
  return { ok: true, id };
}

/** The planned change called off (the store's owner only); a change that took effect stays. */
export async function cancelBusinessChange(member: Membership): Promise<BusinessChangeResult> {
  if (!memberCan(member, "owner")) return { ok: false, problems: ["forbidden"] };
  const [gone] = await db().execute<{ id: string }>(sql`
    update commerce.store_business_changes set status = 'cancelled', updated_at = now()
     where store_id = ${member.store.id}::uuid and status = 'planned'
    returning id
  `);
  if (!gone) return { ok: false, problems: ["not_found"] };
  await audit(member.account.id, member.store.id, "business.change_cancelled", { change: gone.id }, { area: "settings", target: { type: "business_change", id: gone.id } });
  return { ok: true, id: gone.id };
}

/**
 * The dispatcher's `businessChanges` job (D473): each planned change whose day may have come is offered to the database, which applies it
 * when its day has come in the store's own time zone and its numbers are known; then every store whose change took effect (here, or when
 * its first document of the day was issued) is drawn again, so its pages, emails and checkout show the new business. Never throws.
 */
export async function runBusinessChanges(): Promise<{ applied: number; refreshed: number }> {
  let applied = 0;
  let refreshed = 0;
  try {
    // Tomorrow in UTC covers every time zone ahead of it; the database decides by the store's own day.
    const due = await typedRows(
      z.object({ store_id: col.uuid }),
      sql`select distinct store_id from commerce.store_business_changes where status = 'planned' and starts_on <= (now() at time zone 'utc')::date + 1 limit 200`,
    );
    for (const { store_id } of due) {
      try {
        const [result] = await db().execute<{ applied: boolean }>(sql`select commerce.apply_business_change(${store_id}::uuid) as applied`);
        if (result?.applied) applied += 1;
      } catch (error) {
        log("error", "business_change.apply_failed", { storeId: store_id }, error);
      }
    }
    const done = await typedRows(
      z.object({ id: col.uuid, store_id: col.uuid }),
      sql`select id, store_id from commerce.store_business_changes where status = 'applied' and refreshed_at is null limit 200`,
    );
    for (const change of done) {
      await refreshStoreById(change.store_id);
      await db().execute(sql`update commerce.store_business_changes set refreshed_at = now() where id = ${change.id}::uuid`);
      refreshed += 1;
    }
    if (applied > 0 || refreshed > 0) log("info", "business_change.applied", { applied, refreshed });
  } catch (error) {
    log("error", "business_change.run_failed", {}, error);
  }
  return { applied, refreshed };
}

/** A step of the checklist the owner does elsewhere (the bank, Stripe, the accounting system), ticked as done or not (the owner only). */
export async function tickBusinessStep(member: Membership, step: string, done: boolean): Promise<BusinessChangeResult> {
  if (!memberCan(member, "owner")) return { ok: false, problems: ["forbidden"] };
  if (!(TICKED_STEPS as readonly string[]).includes(step)) return { ok: false, problems: ["not_found"] };
  const [changed] = await db().execute<{ id: string }>(sql`
    update commerce.store_business_changes
       set checked = case when ${done} then array(select distinct unnest(checked || array[${step}::text])) else array_remove(checked, ${step}::text) end,
           updated_at = now()
     where store_id = ${member.store.id}::uuid and status = 'planned'
    returning id
  `);
  if (!changed) return { ok: false, problems: ["not_found"] };
  return { ok: true, id: changed.id };
}

/**
 * What the checklist is drawn from, read from the store: whether Work is on (its invoices carry a bank account), whether it takes payments,
 * the accounting system it books into and that company's number, how many of its legal pages still name the business as it is, whether it
 * pays for a plan, and whether it invoices businesses.
 */
export async function businessChecklistFacts(store: Store, change: Pick<BusinessChange, "organisationNumber" | "vatRegistered" | "vatNumber" | "checked">): Promise<BusinessChecklistFacts> {
  const oldName = store.details.legalName?.trim() || null;
  const roles = sql.join(LEGAL_ROLES.map((role) => sql`${role}`), sql`, `);
  const facts = await typedRows(
    z.object({ payments: col.bool, accounting: col.bool, accounting_org: col.textOrNull, legal_pages: col.int }),
    sql`
      select
        exists (select 1 from commerce.stripe_accounts a where a.store_id = ${store.id}::uuid)
          or exists (select 1 from commerce.payment_providers p where p.store_id = ${store.id}::uuid and p.enabled) as payments,
        exists (select 1 from commerce.tripletex_connections t where t.store_id = ${store.id}::uuid)
          or exists (select 1 from commerce.fiken_connections f where f.store_id = ${store.id}::uuid) as accounting,
        coalesce(
          (select t.company_org_number from commerce.tripletex_connections t where t.store_id = ${store.id}::uuid limit 1),
          (select f.company_org_number from commerce.fiken_connections f where f.store_id = ${store.id}::uuid limit 1)) as accounting_org,
        (select count(*)::int from commerce.page_roles r join commerce.pages p on p.id = r.page_id
          where r.store_id = ${store.id}::uuid and r.role in (${roles})
            and ${oldName}::text is not null and position(lower(${oldName}::text) in lower(p.published::text)) > 0) as legal_pages
    `,
  );
  const f = facts[0];
  return {
    change,
    checked: change.checked,
    workOn: store.workOn,
    takesPayments: f.payments,
    accounting: f.accounting ? { organisationNumber: f.accounting_org } : null,
    legalPagesNamingOld: f.legal_pages,
    paysPlan: !store.house,
    invoicesBusinesses: store.workOn || featureOn(store, "business"),
  };
}

export type { BusinessStep };

/** Where the store's invoice and credit note series stand: each one's prefix and the next number it gives. */
export async function businessSeriesNow(storeId: string): Promise<Partial<Record<BusinessSeries, { prefix: string; next: number }>>> {
  const rows = await typedRows(
    z.object({ series: z.string(), prefix: col.textOrNull, next_number: z.coerce.number() }),
    sql`select series, prefix, next_number from commerce.document_series where store_id = ${storeId}::uuid and series in ('invoice', 'credit_note', 'work_invoice', 'work_credit_note')`,
  );
  return Object.fromEntries(rows.map((r) => [r.series, { prefix: r.prefix ?? "", next: r.next_number }]));
}
