import "server-only";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db/client";
import { decimalAmount, quarterOf, taxDetailsInput, toCsv, type TaxDetails } from "@/lib/dac7";

import { audit } from "./auth";
import { hostOwnsResource, type Hosting } from "./hosts";

/**
 * DAC7 for stores with hosts (D71): hosts give their tax details and the
 * addresses of their rooms and homes in their area; the store sees whose
 * are missing and downloads the year's report (sellers and properties, per
 * quarter) to file with its tax authority by 31 January.
 */

type Row = Record<string, unknown>;

const toDetails = (row: Row): TaxDetails => ({
  kind: row.kind === "entity" ? "entity" : "individual",
  legalName: String(row.legal_name),
  dateOfBirth: row.date_of_birth ? String(row.date_of_birth).slice(0, 10) : null,
  address: String(row.address),
  country: String(row.country),
  tin: String(row.tin),
  tinCountry: String(row.tin_country),
  vatNumber: String(row.vat_number),
  businessNumber: String(row.business_number),
  iban: String(row.iban),
});

export async function getHostTaxDetails(storeId: string, hostId: string): Promise<TaxDetails | null> {
  const [row] = await db().execute<Row>(sql`
    select kind, legal_name, to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, address, country, tin, tin_country,
      vat_number, business_number, iban
    from commerce.host_tax_details where store_id = ${storeId}::uuid and host_id = ${hostId}::uuid
  `);
  return row ? toDetails(row) : null;
}

export type SaveResult = { ok: true } | { ok: false; problems: string[] };

const problemsOf = (error: z.ZodError) => [...new Set(error.issues.map((i) => i.message))];

/** Saves the host's own tax details. What they wrote is kept out of the audit log. */
export async function saveHostTaxDetails({ account, store, host }: Hosting, values: Record<string, unknown>): Promise<SaveResult> {
  const parsed = taxDetailsInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  const d = parsed.data;
  const person = d.kind === "individual";
  await db().execute(sql`
    insert into commerce.host_tax_details
      (host_id, store_id, kind, legal_name, date_of_birth, address, country, tin, tin_country, vat_number, business_number, iban)
    values (${host.id}::uuid, ${store.id}::uuid, ${d.kind}, ${d.legalName}, ${person ? d.dateOfBirth : null}::date, ${d.address},
      ${d.country}, ${d.tin}, ${d.tinCountry}, ${d.vatNumber}, ${person ? "" : d.businessNumber}, ${d.iban})
    on conflict (host_id) do update set
      kind = excluded.kind, legal_name = excluded.legal_name, date_of_birth = excluded.date_of_birth,
      address = excluded.address, country = excluded.country, tin = excluded.tin, tin_country = excluded.tin_country,
      vat_number = excluded.vat_number, business_number = excluded.business_number, iban = excluded.iban, updated_at = now()
  `);
  await audit(account.id, store.id, "host.tax_details_saved", { hostId: host.id });
  return { ok: true };
}

const propertyInput = z.object({
  address: z.string().trim().min(5, "Write the address: street, postcode and town.").max(400),
  landRegistryNumber: z.string().trim().max(80).default(""),
});

/** Where a host's room or home is, for the report. Only their own rooms and homes. */
export async function saveUnitProperty(
  { account, store, host }: Hosting,
  resourceId: string,
  values: Record<string, unknown>,
): Promise<SaveResult> {
  if (!(await hostOwnsResource(store.id, host.id, resourceId))) return { ok: false, problems: ["That is not one of your rooms."] };
  const parsed = propertyInput.safeParse(values);
  if (!parsed.success) return { ok: false, problems: problemsOf(parsed.error) };
  await db().execute(sql`
    update commerce.booking_resources set property_address = ${parsed.data.address},
      land_registry_number = ${parsed.data.landRegistryNumber}, updated_at = now()
    where store_id = ${store.id}::uuid and id = ${resourceId}::uuid and host_id = ${host.id}::uuid and kind = 'unit'
  `);
  await audit(account.id, store.id, "host.property_saved", { hostId: host.id, resourceId });
  return { ok: true };
}

/** A room's or home's address and land registry number, as the host gave them. */
export async function getUnitProperty(storeId: string, resourceId: string): Promise<{ address: string; landRegistryNumber: string }> {
  const [row] = await db().execute<Row>(sql`
    select property_address, land_registry_number from commerce.booking_resources
    where store_id = ${storeId}::uuid and id = ${resourceId}::uuid
  `);
  return { address: String(row?.property_address ?? ""), landRegistryNumber: String(row?.land_registry_number ?? "") };
}

export type TaxStatus = {
  /** Their tax details are given. */
  details: boolean;
  /** Their rooms and homes without an address. */
  missingAddresses: string[];
};

/** For each of the store's hosts: what the report still lacks. */
export async function hostTaxStatus(storeId: string): Promise<Map<string, TaxStatus>> {
  const rows = await db().execute<Row>(sql`
    select h.id, t.host_id is not null as details,
      coalesce((select array_agg(r.name order by r.position, r.name) from commerce.booking_resources r
        where r.store_id = h.store_id and r.host_id = h.id and r.kind = 'unit' and r.active and r.property_address = ''), '{}') as missing
    from commerce.hosts h
    left join commerce.host_tax_details t on t.store_id = h.store_id and t.host_id = h.id
    where h.store_id = ${storeId}::uuid
  `);
  return new Map(rows.map((row) => [String(row.id), { details: Boolean(row.details), missingAddresses: (row.missing as string[]) ?? [] }]));
}

// ---------------------------------------------------------------------------
// The yearly report
// ---------------------------------------------------------------------------

type Quarters = [number, number, number, number];
const quarters = (): Quarters => [0, 0, 0, 0];

export type SellerReport = {
  hostId: string;
  name: string;
  email: string;
  details: TaxDetails | null;
  currency: string;
  /** What shoppers paid for the host's bookings, less refunds, per quarter. */
  considerationMinor: Quarters;
  /** The store's commission, per quarter. */
  feesMinor: Quarters;
  /** Bookings paid for, per quarter. */
  activities: Quarters;
};

export type PropertyReport = {
  hostId: string;
  resourceId: string;
  name: string;
  address: string;
  landRegistryNumber: string;
  currency: string;
  considerationMinor: Quarters;
  activities: Quarters;
  /** Nights booked in the year's paid bookings. */
  nights: number;
};

export type Dac7Report = { year: number; sellers: SellerReport[]; properties: PropertyReport[] };

/**
 * The year's report: for every host paid in it, their details and, per
 * quarter of payment (where the store is), what shoppers paid (refunds
 * taken off in the quarter they were made), the store's commission and the
 * number of bookings; and for every room or home booked, its address, its
 * bookings and nights. Amounts are per currency, as they were paid.
 */
export async function dac7Report(storeId: string, year: number, timeZone: string): Promise<Dac7Report> {
  const inYear = (column: ReturnType<typeof sql>) =>
    sql`extract(year from ${column} at time zone ${timeZone})::int = ${year}`;
  const paid = sql`(select min(e.created_at) from commerce.order_events e
    where e.store_id = o.store_id and e.order_id = o.id and e.type = 'order.paid')`;
  const [orders, refunds, lines, hosts] = await Promise.all([
    db().execute<Row>(sql`
      select o.id, o.host_id, o.currency, o.total_minor, o.commission_minor - coalesce(c.reversed_minor, 0) as fees, p.paid_at,
        (select count(*)::int from commerce.order_lines ol
          where ol.store_id = o.store_id and ol.order_id = o.id and ol.variant_id is not null) as activities
      from commerce.orders o
      cross join lateral (select ${paid} as paid_at) p
      left join commerce.host_commissions c on c.store_id = o.store_id and c.order_id = o.id
      where o.store_id = ${storeId}::uuid and o.host_id is not null and p.paid_at is not null and ${inYear(sql`p.paid_at`)}
    `),
    db().execute<Row>(sql`
      select o.host_id, o.currency, r.amount_minor, r.created_at
      from commerce.refunds r
      join commerce.payments pay on pay.store_id = r.store_id and pay.id = r.payment_id
      join commerce.orders o on o.store_id = pay.store_id and o.id = pay.order_id
      where r.store_id = ${storeId}::uuid and o.host_id is not null and r.status <> 'failed' and ${inYear(sql`r.created_at`)}
    `),
    db().execute<Row>(sql`
      select o.host_id, o.currency, ol.total_minor, b.resource_id, b.starts_at, b.ends_at, p.paid_at,
        res.name, res.property_address, res.land_registry_number
      from commerce.orders o
      cross join lateral (select ${paid} as paid_at) p
      join commerce.order_lines ol on ol.store_id = o.store_id and ol.order_id = o.id
      join commerce.bookings b on b.store_id = ol.store_id and b.order_line_id = ol.id and b.status = 'confirmed'
      join commerce.booking_resources res on res.store_id = b.store_id and res.id = b.resource_id and res.kind = 'unit'
      where o.store_id = ${storeId}::uuid and o.host_id is not null and p.paid_at is not null and ${inYear(sql`p.paid_at`)}
    `),
    db().execute<Row>(sql`
      select h.id, h.name, a.email, t.kind, t.legal_name, to_char(t.date_of_birth, 'YYYY-MM-DD') as date_of_birth, t.address,
        t.country, t.tin, t.tin_country, t.vat_number, t.business_number, t.iban
      from commerce.hosts h
      join commerce.accounts a on a.id = h.account_id
      left join commerce.host_tax_details t on t.store_id = h.store_id and t.host_id = h.id
      where h.store_id = ${storeId}::uuid
    `),
  ]);

  const hostById = new Map(hosts.map((h) => [String(h.id), h]));
  const sellers = new Map<string, SellerReport>();
  const seller = (hostId: string, currency: string) => {
    const key = `${hostId}:${currency}`;
    let found = sellers.get(key);
    if (!found) {
      const h = hostById.get(hostId);
      found = {
        hostId,
        name: String(h?.name ?? ""),
        email: String(h?.email ?? ""),
        details: h?.legal_name ? toDetails(h) : null,
        currency,
        considerationMinor: quarters(),
        feesMinor: quarters(),
        activities: quarters(),
      };
      sellers.set(key, found);
    }
    return found;
  };
  for (const o of orders) {
    const s = seller(String(o.host_id), String(o.currency));
    const q = quarterOf(new Date(String(o.paid_at)).toISOString(), timeZone) - 1;
    s.considerationMinor[q] += Number(o.total_minor);
    s.feesMinor[q] += Number(o.fees);
    s.activities[q] += Number(o.activities);
  }
  for (const r of refunds) {
    const q = quarterOf(new Date(String(r.created_at)).toISOString(), timeZone) - 1;
    seller(String(r.host_id), String(r.currency)).considerationMinor[q] -= Number(r.amount_minor);
  }

  const properties = new Map<string, PropertyReport>();
  for (const l of lines) {
    const key = `${l.resource_id}:${l.currency}`;
    let p = properties.get(key);
    if (!p) {
      p = {
        hostId: String(l.host_id),
        resourceId: String(l.resource_id),
        name: String(l.name),
        address: String(l.property_address),
        landRegistryNumber: String(l.land_registry_number),
        currency: String(l.currency),
        considerationMinor: quarters(),
        activities: quarters(),
        nights: 0,
      };
      properties.set(key, p);
    }
    const q = quarterOf(new Date(String(l.paid_at)).toISOString(), timeZone) - 1;
    p.considerationMinor[q] += Number(l.total_minor);
    p.activities[q] += 1;
    // Check-in to check-out, e.g. 15:00 to 11:00 the next day, is one night.
    p.nights += Math.max(1, Math.round((new Date(String(l.ends_at)).getTime() - new Date(String(l.starts_at)).getTime()) / 86_400_000));
  }

  const byName = <T extends { name: string; currency: string }>(a: T, b: T) =>
    a.name.localeCompare(b.name) || a.currency.localeCompare(b.currency);
  return { year, sellers: [...sellers.values()].sort(byName), properties: [...properties.values()].sort(byName) };
}

const Q = ["Q1", "Q2", "Q3", "Q4"];

/** The report's sellers or properties as CSV, one row each. */
export function dac7Csv(report: Dac7Report, part: "sellers" | "properties"): string {
  const money = (values: Quarters, currency: string) => values.map((v) => decimalAmount(v, currency));
  if (part === "sellers") {
    return toCsv([
      [
        "Host", "Email", "Type", "Legal name", "Date of birth", "Address", "Country", "TIN", "TIN issued by", "VAT number",
        "Business registration number", "IBAN", "Currency",
        ...Q.map((q) => `Consideration ${q}`), ...Q.map((q) => `Commission ${q}`), ...Q.map((q) => `Activities ${q}`),
      ],
      ...report.sellers.map((s) => [
        s.name, s.email, s.details?.kind ?? "", s.details?.legalName ?? "", s.details?.dateOfBirth ?? "", s.details?.address ?? "",
        s.details?.country ?? "", s.details?.tin ?? "", s.details?.tinCountry ?? "", s.details?.vatNumber ?? "",
        s.details?.businessNumber ?? "", s.details?.iban ?? "", s.currency,
        ...money(s.considerationMinor, s.currency), ...money(s.feesMinor, s.currency), ...s.activities,
      ]),
    ]);
  }
  const hostName = new Map(report.sellers.map((s) => [s.hostId, s.details?.legalName || s.name]));
  return toCsv([
    [
      "Host", "Property", "Address", "Land registry number", "Currency",
      ...Q.map((q) => `Consideration ${q}`), ...Q.map((q) => `Rentals ${q}`), "Nights rented",
    ],
    ...report.properties.map((p) => [
      hostName.get(p.hostId) ?? "", p.name, p.address, p.landRegistryNumber, p.currency,
      ...money(p.considerationMinor, p.currency), ...p.activities, p.nights,
    ]),
  ]);
}
