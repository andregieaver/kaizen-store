import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { NUMBER_SERIES, numberSeriesInput, workSettingsInput, type WorkSettingsInput } from "@/lib/work-input";
import {
  DEFAULT_WORK_SETTINGS,
  changedSettings,
  documentNumberOf,
  seriesInputProblem,
  sellerReadiness,
} from "@/lib/work-settings";
import type { ReadinessProblem, SellerDetails } from "@/lib/work-vat";

import { audit, type Membership } from "./auth";
import { refreshDraftInvoices } from "./work-draft-sync";
import { problem, workGuard, zodProblems, type WorkResult } from "./work-errors";
import { can } from "@/lib/permissions";

type Row = Record<string, unknown>;

/**
 * Work's settings (docs/work.md 4.2, 4.4, 4.9, 4.10): the module's switch,
 * what an invoice says about the seller and how it is paid, the defaults, and
 * the two numbering series. Everything here is the owner's: the actions
 * check the role, and so do these functions, so a caller cannot forget.
 */

export type Saved = WorkResult;

const OWNER_ONLY = "Only an owner can change Work's settings.";

// --- The module switch ---------------------------------------------------------

/** Switches Work (clients, hours and invoices) on or off. Off hides the pages; nothing is deleted. */
export async function setWorkModule({ account, store }: Membership, enabled: boolean): Promise<void> {
  await db().execute(sql`
    update commerce.stores set modules = case when ${enabled}
      then (select array_agg(distinct m) from unnest(modules || array['work']) m)
      else array_remove(modules, 'work') end
    where id = ${store.id}::uuid
  `);
  await audit(account.id, store.id, enabled ? "work.enabled" : "work.disabled", {});
}

// --- Settings ------------------------------------------------------------------

export type WorkSettings = WorkSettingsInput & { updatedAt: string | null };

const orNull = (value: unknown): string | null =>
  value === null || value === undefined || value === "" ? null : String(value);

/** The store's Work settings; a store that has saved none has the defaults (registered for VAT, 14 days). */
export async function getWorkSettings(storeId: string): Promise<WorkSettings> {
  const [row] = await db().execute<Row>(sql`
    select * from commerce.work_settings where store_id = ${storeId}::uuid
  `);
  if (!row) return { ...DEFAULT_WORK_SETTINGS, updatedAt: null };
  return {
    vatRegistered: Boolean(row.vat_registered),
    vatNumber: orNull(row.vat_number),
    defaultPaymentDays: Number(row.default_payment_days ?? DEFAULT_WORK_SETTINGS.defaultPaymentDays),
    defaultCurrency: orNull(row.default_currency),
    bankAccount: orNull(row.bank_account),
    bic: orNull(row.bic),
    paymentNote: orNull(row.payment_note),
    invoiceFooter: orNull(row.invoice_footer),
    latePaymentNote: orNull(row.late_payment_note),
    estimateAlertMinutes: row.estimate_alert_minutes === null ? null : Number(row.estimate_alert_minutes),
    estimateAlertPopup: Boolean(row.estimate_alert_popup),
    estimateAlertSound: Boolean(row.estimate_alert_sound),
    showTimeNotesToClients: Boolean(row.show_time_notes_to_clients),
    updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : null,
  };
}

/** Checks and saves the settings (`workSettingsInput`). Owners only; written to the audit log. */
export async function saveWorkSettings({ account, store, role }: Membership, raw: unknown): Promise<Saved> {
  if (!can({ role }, "owner")) return problem(OWNER_ONLY);
  const parsed = workSettingsInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const s = parsed.data;
  if (s.vatRegistered === false && s.vatNumber) s.vatNumber = null;
  const before = await getWorkSettings(store.id);
  await db().execute(sql`
    insert into commerce.work_settings (
      store_id, vat_registered, vat_number, default_payment_days, default_currency, bank_account, bic, payment_note,
      invoice_footer, late_payment_note, estimate_alert_minutes, estimate_alert_popup, estimate_alert_sound,
      show_time_notes_to_clients, updated_by
    ) values (
      ${store.id}::uuid, ${s.vatRegistered}, ${s.vatNumber}, ${s.defaultPaymentDays}, ${s.defaultCurrency}, ${s.bankAccount},
      ${s.bic}, ${s.paymentNote}, ${s.invoiceFooter}, ${s.latePaymentNote}, ${s.estimateAlertMinutes}, ${s.estimateAlertPopup},
      ${s.estimateAlertSound}, ${s.showTimeNotesToClients}, ${account.id}::uuid
    )
    on conflict (store_id) do update set
      vat_registered = excluded.vat_registered, vat_number = excluded.vat_number,
      default_payment_days = excluded.default_payment_days, default_currency = excluded.default_currency,
      bank_account = excluded.bank_account, bic = excluded.bic, payment_note = excluded.payment_note,
      invoice_footer = excluded.invoice_footer, late_payment_note = excluded.late_payment_note,
      estimate_alert_minutes = excluded.estimate_alert_minutes, estimate_alert_popup = excluded.estimate_alert_popup,
      estimate_alert_sound = excluded.estimate_alert_sound,
      show_time_notes_to_clients = excluded.show_time_notes_to_clients,
      updated_at = now(), updated_by = excluded.updated_by
  `);
  // Registered or not decides which VAT a draft shows, so the drafts are priced again (docs/work.md 4.4).
  if (before.vatRegistered !== s.vatRegistered) {
    await db().transaction((tx) => refreshDraftInvoices(tx, { storeId: store.id }));
  }
  // Which settings changed, never their values: a bank account does not belong in a log.
  await audit(account.id, store.id, "work.settings.saved", { changed: changedSettings(before, s) });
  return { ok: true };
}

// --- Readiness -----------------------------------------------------------------

/** The seller as an invoice would freeze it: the store's business details and the saved Work settings. */
export async function sellerDetails(storeId: string): Promise<SellerDetails> {
  const [row] = await db().execute<Row>(sql`
    select s.legal_name, s.organisation_number, s.postal_address, s.country,
           coalesce(w.vat_registered, true) as vat_registered, w.vat_number, w.bank_account
    from commerce.stores s left join commerce.work_settings w on w.store_id = s.id
    where s.id = ${storeId}::uuid
  `);
  return {
    legalName: orNull(row?.legal_name),
    organisationNumber: orNull(row?.organisation_number),
    postalAddress: orNull(row?.postal_address),
    country: orNull(row?.country),
    vatRegistered: row ? Boolean(row.vat_registered) : true,
    vatNumber: orNull(row?.vat_number),
    bankAccount: orNull(row?.bank_account),
  };
}

/** What is still missing before an invoice can be issued, read from what is saved (not from a form). */
export async function workReadiness(storeId: string): Promise<{ ready: boolean; problems: ReadinessProblem[] }> {
  return sellerReadiness(await sellerDetails(storeId));
}

// --- Numbering -----------------------------------------------------------------

export type SeriesName = (typeof NUMBER_SERIES)[number];

export type SeriesState = {
  series: SeriesName;
  prefix: string;
  nextNumber: number;
  /** Documents issued in it so far. From the first, the numbers are the law's and cannot be changed. */
  issued: number;
  /** The last document number issued, as printed. */
  lastDocumentNumber: string | null;
  /** What the next document will be called. */
  nextDocumentNumber: string;
};

/** Both series' prefix, next number and what has been issued in them. */
export async function getWorkSeries(storeId: string): Promise<Record<SeriesName, SeriesState>> {
  const [rows, invoices, notes] = await Promise.all([
    db().execute<Row>(sql`
      select series, prefix, next_number from commerce.document_series
      where store_id = ${storeId}::uuid and series in ('work_invoice', 'work_credit_note')
    `),
    db().execute<Row>(sql`
      select count(*)::int as n, (array_agg(document_number order by number desc))[1] as last
      from commerce.work_invoices where store_id = ${storeId}::uuid and number is not null
    `),
    db().execute<Row>(sql`
      select count(*)::int as n, (array_agg(document_number order by number desc))[1] as last
      from commerce.work_credit_notes where store_id = ${storeId}::uuid
    `),
  ]);
  const issued: Record<SeriesName, { n: number; last: string | null }> = {
    work_invoice: { n: Number(invoices[0]?.n ?? 0), last: orNull(invoices[0]?.last) },
    work_credit_note: { n: Number(notes[0]?.n ?? 0), last: orNull(notes[0]?.last) },
  };
  const state = (series: SeriesName): SeriesState => {
    const row = rows.find((r) => r.series === series);
    const prefix = String(row?.prefix ?? (series === "work_invoice" ? "W-" : "WCN-"));
    const nextNumber = Number(row?.next_number ?? 1);
    return {
      series,
      prefix,
      nextNumber,
      issued: issued[series].n,
      lastDocumentNumber: issued[series].last,
      nextDocumentNumber: documentNumberOf(prefix, nextNumber),
    };
  };
  return { work_invoice: state("work_invoice"), work_credit_note: state("work_credit_note") };
}

/**
 * Sets a series' prefix and next number (`commerce.work_set_series`). Only
 * before the first document is issued in it: numbers already issued are the
 * law's, so after that the answer is a plain refusal, and the database
 * refuses too (it never lets a number go down once one is issued).
 */
export async function setWorkSeries({ account, store, role }: Membership, raw: unknown): Promise<Saved> {
  if (!can({ role }, "owner")) return problem(OWNER_ONLY);
  const parsed = numberSeriesInput.safeParse(raw);
  if (!parsed.success) return problem(...zodProblems(parsed.error));
  const input = parsed.data;
  const tooLong = seriesInputProblem(input);
  if (tooLong) return problem(tooLong);
  const before = (await getWorkSeries(store.id))[input.series];
  if (before.issued > 0) {
    return problem(
      `${before.issued === 1 ? "A document has" : "Documents have"} already been issued in this numbering (the last is ${before.lastDocumentNumber}), so it can no longer be changed.`,
    );
  }
  // The database refuses what the check above cannot see (two people saving at once), in its own words.
  const set = await workGuard(async () => {
    await db().execute(sql`
      select commerce.work_set_series(${store.id}::uuid, ${input.series}, ${input.prefix}, ${input.nextNumber}::bigint)
    `);
    return { ok: true as const };
  });
  if (!set.ok) return set;
  await audit(account.id, store.id, "work.series.changed", {
    series: input.series,
    from: before.nextDocumentNumber,
    to: documentNumberOf(input.prefix, input.nextNumber),
  });
  return { ok: true };
}
