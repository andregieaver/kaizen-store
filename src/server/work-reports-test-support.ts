import { sql } from "drizzle-orm";

import { db } from "@/db/client";

import * as invoices from "./work-invoices";
import type { WorkActor } from "./work-invoices";

type Row = Record<string, unknown>;

/**
 * Stores, clients, assignments, time and issued invoices for the reports' and the control center's integration
 * tests (never imported by the app): a Norwegian store that can issue invoices, and helpers that issue one on a
 * chosen day through the same functions the admin uses, so what is reported is what the database really holds.
 */
export type ReportFixture = { storeId: string; slug: string; accountId: string; actor: WorkActor };

let counter = 0;

export async function makeReportStore(tag: string, options: { timeZone?: string; work?: boolean } = {}): Promise<ReportFixture> {
  const name = `wr-${tag}-${Date.now().toString(36)}${(counter++).toString(36)}`;
  const [request] = await db().execute<Row>(
    sql`insert into commerce.access_requests (email, name, store_name) values (${`${name}@example.com`}, 'W', 'Arbeid') returning id`,
  );
  await db().execute(sql`select commerce.approve_access_request(${String(request.id)}::uuid, ${name}, 'Arbeid', null)`);
  const [owner] = await db().execute<Row>(sql`select id from commerce.accounts where email = ${`${name}@example.com`}`);
  const [store] = await db().execute<Row>(sql`select id from commerce.stores where slug = ${name}`);
  const storeId = String(store.id);
  await db().execute(sql`
    update commerce.stores set legal_name = 'Konsulent AS', organisation_number = '923456789',
      postal_address = 'Storgata 1, 0150 Oslo', country = 'NO', contact_email = 'post@konsulent.no',
      modules = ${options.work === false ? sql`'{}'::text[]` : sql`array['work']`}
      ${options.timeZone ? sql`, time_zone = ${options.timeZone}` : sql``}
    where id = ${storeId}::uuid`);
  await db().execute(sql`
    insert into commerce.work_settings (store_id, vat_registered, vat_number, default_payment_days, bank_account, bic, payment_note)
    values (${storeId}::uuid, true, 'NO923456789MVA', 14, 'NO9386011117947', 'DNBANOKKXXX', 'Pay by bank transfer.')`);
  const accountId = String(owner.id);
  return { storeId, slug: name, accountId, actor: { account: { id: accountId }, store: { id: storeId } } };
}

export async function makeReportClient(
  f: ReportFixture,
  over: { name?: string; currency?: string; rate?: number | null } = {},
): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_clients (store_id, name, country, billing_address, currency, default_hourly_rate_minor,
                                       locale, business, vat_treatment, billing_email)
    values (${f.storeId}::uuid, ${over.name ?? "Kunde AS"}, 'NO', '{"line1":"Kirkeveien 1","postalCode":"0364","city":"Oslo"}'::jsonb,
            ${over.currency ?? "NOK"}, ${"rate" in over ? over.rate : 100000}, 'nb-NO', true, 'domestic', 'faktura@kunde.no')
    returning id`);
  return String(row.id);
}

export async function makeReportAssignment(
  f: ReportFixture,
  clientId: string,
  over: { name?: string; billing?: "hourly" | "fixed_fee"; rate?: number | null; fixed?: number | null } = {},
): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_assignments (store_id, client_id, name, billing_type, hourly_rate_minor, fixed_amount_minor)
    values (${f.storeId}::uuid, ${clientId}::uuid, ${over.name ?? "Rådgivning"}, ${over.billing ?? "hourly"},
            ${"rate" in over ? over.rate : null}, ${over.fixed ?? null})
    returning id`);
  return String(row.id);
}

/** A time entry on a day (a date in the store's time zone). */
export async function logReportTime(
  f: ReportFixture,
  assignmentId: string,
  day: string,
  minutes: number,
  over: { billable?: boolean; prepaid?: number } = {},
): Promise<string> {
  const [row] = await db().execute<Row>(sql`
    insert into commerce.work_time_entries (store_id, assignment_id, account_id, work_date, minutes, billable, prepaid_minutes)
    values (${f.storeId}::uuid, ${assignmentId}::uuid, ${f.accountId}::uuid, ${day}::date, ${minutes}, ${over.billable ?? true}, ${over.prepaid ?? 0})
    returning id`);
  return String(row.id);
}

export async function reportToday(f: ReportFixture): Promise<string> {
  const [row] = await db().execute<Row>(sql`select commerce.work_today(${f.storeId}::uuid)::text as d`);
  return String(row.d);
}

export type ReportLine = { assignmentId: string | null; description?: string; priceMinor: number; quantityHundredths?: number };

function ok<T extends object>(result: invoices.InvoiceResult<T>): Extract<invoices.InvoiceResult<T>, { ok: true }> {
  if (!result.ok) throw new Error(`Expected success, got: ${result.problems.join(" | ")}`);
  return result as Extract<invoices.InvoiceResult<T>, { ok: true }>;
}

/** A draft for a client with lines of units (no time), left as a draft. Returns the invoice id and its line ids. */
export async function makeReportDraft(
  f: ReportFixture,
  clientId: string,
  lines: ReportLine[],
): Promise<{ invoiceId: string; lineIds: string[] }> {
  const { invoiceId } = ok(await invoices.createDraftInvoice(f.actor, { clientId }));
  const saved = ok(
    await invoices.saveLines(
      f.actor,
      invoiceId,
      lines.map((l, i) => ({
        assignmentId: l.assignmentId,
        description: l.description ?? `Line ${i + 1}`,
        unit: "unit",
        quantityHundredths: l.quantityHundredths ?? 100,
        unitPriceMinor: l.priceMinor,
        discountBp: 0,
        vatCategory: "standard",
      })),
    ),
  );
  return { invoiceId, lineIds: saved.lines.map((l) => l.id) };
}

/** An invoice issued on a day. Issue in date order within a store: an earlier date than the previous is refused. */
export async function issueReportInvoice(
  f: ReportFixture,
  clientId: string,
  day: string,
  lines: ReportLine[],
  options: { fxRate?: string } = {},
): Promise<{ invoiceId: string; lineIds: string[]; documentNumber: string }> {
  const draft = await makeReportDraft(f, clientId, lines);
  const issued = ok(
    await invoices.issueInvoice(f.actor, { invoiceId: draft.invoiceId, issuedOn: day, ...(options.fxRate ? { fxRate: options.fxRate } : {}) }),
  ).invoice;
  return { ...draft, documentNumber: issued.documentNumber };
}

export async function payReportInvoice(f: ReportFixture, invoiceId: string, amountMinor: number, day: string): Promise<void> {
  ok(await invoices.recordPayment(f.actor, { invoiceId, amountMinor, receivedOn: day }));
}

export async function creditReportLine(f: ReportFixture, invoiceId: string, lineId: string, quantityHundredths: number): Promise<void> {
  ok(
    await invoices.creditInvoice(f.actor, {
      invoiceId,
      kind: "partial",
      reason: "Agreed reduction",
      lines: [{ lineId, quantityHundredths }],
    }),
  );
}
