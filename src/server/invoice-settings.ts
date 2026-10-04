import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import { DEFAULT_PREFIX, parseInvoiceSettings, parseSeries, seriesProblem, type InvoiceSettingsField, type InvoiceSettingsForm, type InvoiceSettingsValues, type SeriesForm, type SeriesName } from "@/lib/invoice-settings";
import { sellerReadiness, type SellerField } from "@/lib/invoice-readiness";

import { audit, type Membership } from "./auth";
import { memberCan } from "./permissions";

type Row = Record<string, unknown>;

/**
 * Invoicing's settings (D159, `docs/wave-1b-invoices.md` 2.3 and 3.1): the switch, the note printed on every document, whether the
 * confirmation email carries the invoice, and the two series' prefix and first number until the first document is issued. One row in
 * `commerce.invoice_settings` per store, made on first save: no row means invoicing is on (the migration wrote `enabled = false` for the
 * stores that already had real orders). Owners only change any of it, because it changes legal numbering. The database sets
 * `enabled_from` itself when the switch goes on: invoices are issued from then on and never back-dated.
 */

export type InvoiceSettings = {
  enabled: boolean;
  /** When invoicing was last switched on (null: always on, or off). */
  enabledFrom: string | null;
  footerNote: string | null;
  emailWithConfirmation: boolean;
  /** A row exists, so the store (or the migration) has chosen. */
  saved: boolean;
};

const DEFAULTS: InvoiceSettings = { enabled: true, enabledFrom: null, footerNote: null, emailWithConfirmation: true, saved: false };

export async function getInvoiceSettings(storeId: string): Promise<InvoiceSettings> {
  const [row] = await db().execute<Row>(sql`
    select enabled, enabled_from, footer_note, email_with_confirmation from commerce.invoice_settings where store_id = ${storeId}::uuid
  `);
  if (!row) return { ...DEFAULTS };
  return {
    enabled: row.enabled === true,
    enabledFrom: row.enabled_from ? new Date(String(row.enabled_from)).toISOString() : null,
    footerNote: row.footer_note ? String(row.footer_note) : null,
    emailWithConfirmation: row.email_with_confirmation !== false,
    saved: true,
  };
}

/** Whether Kaizen invoices this store's orders: when it does, Stripe's own invoice option is not used (`startCheckout()`). */
export async function kaizenInvoicingOn(storeId: string): Promise<boolean> {
  return (await getInvoiceSettings(storeId)).enabled;
}

const OWNER_ONLY = "Only an owner can change the invoicing settings.";

export type SettingsSaveResult =
  | { ok: true; settings: InvoiceSettings }
  | { ok: false; errors: Partial<Record<InvoiceSettingsField, string>>; problems: string[] };

/**
 * Saves the switch, the note and the email option. Owners only. Audit: `invoice.settings_updated` with the names of what changed
 * (never the note's text).
 */
export async function saveInvoiceSettings(membership: Membership, form: InvoiceSettingsForm): Promise<SettingsSaveResult> {
  const { account, store } = membership;
  if (!memberCan(membership, "owner")) return { ok: false, errors: {}, problems: [OWNER_ONLY] };
  const parsed = parseInvoiceSettings(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, problems: Object.values(parsed.errors) };
  const v: InvoiceSettingsValues = parsed.values;
  const before = await getInvoiceSettings(store.id);
  await db().execute(sql`
    insert into commerce.invoice_settings (store_id, enabled, footer_note, email_with_confirmation, updated_by, updated_at)
    values (${store.id}::uuid, ${v.enabled}, ${v.footerNote}, ${v.emailWithConfirmation}, ${account.id}::uuid, now())
    on conflict (store_id) do update set
      enabled = excluded.enabled, footer_note = excluded.footer_note, email_with_confirmation = excluded.email_with_confirmation,
      updated_by = excluded.updated_by, updated_at = now()
  `);
  const changed: string[] = [];
  if (before.enabled !== v.enabled) changed.push("enabled");
  if ((before.footerNote ?? null) !== v.footerNote) changed.push("footerNote");
  if (before.emailWithConfirmation !== v.emailWithConfirmation) changed.push("emailWithConfirmation");
  if (changed.length > 0 || !before.saved) await audit(account.id, store.id, "invoice.settings_updated", { fields: changed, enabled: v.enabled });
  return { ok: true, settings: await getInvoiceSettings(store.id) };
}

export type SeriesState = {
  series: SeriesName;
  prefix: string;
  nextNumber: number;
  /** Documents issued in it: once there is one, the prefix and the numbers cannot be changed. */
  issued: number;
  locked: boolean;
  /** The next document's number as it will be written. */
  nextDocumentNumber: string;
};

/** The two series as the settings page shows them. */
export async function seriesStates(storeId: string): Promise<SeriesState[]> {
  const rows = await db().execute<Row>(sql`
    select s.series, s.prefix, s.next_number,
      case s.series
        when 'invoice' then (select count(*) from commerce.invoices i where i.store_id = s.store_id)
        else (select count(*) from commerce.credit_notes c where c.store_id = s.store_id)
      end as issued
    from commerce.document_series s
    where s.store_id = ${storeId}::uuid and s.series in ('invoice', 'credit_note')
    order by s.series
  `);
  const found = new Map(rows.map((r) => [String(r.series), r]));
  return (["invoice", "credit_note"] as const).map((series) => {
    const row = found.get(series);
    const prefix = row ? String(row.prefix) : DEFAULT_PREFIX[series];
    const nextNumber = row ? Number(row.next_number) : 1;
    const issued = Number(row?.issued ?? 0);
    return { series, prefix, nextNumber, issued, locked: issued > 0, nextDocumentNumber: `${prefix}${nextNumber}` };
  });
}

export type SeriesSaveResult =
  | { ok: true; series: SeriesState[] }
  | { ok: false; errors: Partial<Record<"series" | "prefix" | "nextNumber", string>>; problems: string[] };

/**
 * Chooses a series' prefix and first number, only until its first document is issued (`commerce.set_sales_series()` refuses it
 * after, as D141's guard does). Owners only. Audit: `invoice.series_set`.
 */
export async function setSeries(membership: Membership, form: SeriesForm): Promise<SeriesSaveResult> {
  const { account, store } = membership;
  if (!memberCan(membership, "owner")) return { ok: false, errors: {}, problems: [OWNER_ONLY] };
  const parsed = parseSeries(form);
  if (!parsed.ok) return { ok: false, errors: parsed.errors, problems: Object.values(parsed.errors) };
  try {
    await db().execute(sql`select commerce.set_sales_series(${store.id}::uuid, ${parsed.series}, ${parsed.prefix}, ${parsed.nextNumber}::bigint)`);
  } catch (error) {
    const text = error instanceof Error ? `${error.message} ${(error as { cause?: { message?: string } }).cause?.message ?? ""}` : String(error);
    const problem = seriesProblem(text);
    if (!problem) throw error;
    return { ok: false, errors: {}, problems: [problem] };
  }
  await audit(account.id, store.id, "invoice.series_set", { series: parsed.series, prefix: parsed.prefix, firstNumber: parsed.nextNumber });
  return { ok: true, series: await seriesStates(store.id) };
}

export type InvoiceReadiness = {
  /** Everything an invoice needs from the seller is there and the store's tax profile is saved. */
  ready: boolean;
  /** The seller's details an invoice needs that the store has not given. */
  missing: SellerField[];
  taxProfileSaved: boolean;
  vatRegistered: boolean;
  /** Where each missing field is fixed (a path under the store's admin). */
  fixAt: Record<string, string>;
  /** The store keeps its rates by hand: the VAT in another currency needs an accountant's look (Directive Art. 91). */
  ratesByHand: boolean;
  /** Stripe's own invoice option is ignored while Kaizen invoicing is on. */
  stripeInvoicesIgnored: boolean;
};

/** What is missing before invoices can be issued, for the settings page and the AI manager's `invoice_readiness`. */
export async function invoiceReadiness(storeId: string): Promise<InvoiceReadiness> {
  const [row] = await db().execute<Row>(sql`
    select s.legal_name, s.postal_address, s.organisation_number, s.country::text as country, s.rates_auto,
           tp.store_id is not null as profile_saved, coalesce(tp.vat_registered, false) as vat_registered, tp.vat_number,
           coalesce((select p.order_invoices from commerce.payment_providers p where p.store_id = s.id and p.provider = 'stripe'), false) as stripe_invoices
    from commerce.stores s
    left join commerce.store_tax_profile tp on tp.store_id = s.id
    where s.id = ${storeId}::uuid
  `);
  const settings = await getInvoiceSettings(storeId);
  if (!row) return { ready: false, missing: [], taxProfileSaved: false, vatRegistered: false, fixAt: {}, ratesByHand: false, stripeInvoicesIgnored: false };
  const text = (v: unknown) => (v === null || v === undefined ? null : String(v));
  const profile = row.profile_saved ? { vatRegistered: row.vat_registered === true, vatNumber: text(row.vat_number) } : null;
  const missing = sellerReadiness(
    { legalName: text(row.legal_name), postalAddress: text(row.postal_address), organisationNumber: text(row.organisation_number), country: text(row.country) },
    profile,
  );
  const fixAt: Record<string, string> = {};
  for (const field of missing) fixAt[field] = field === "vat_number" ? "/settings/tax" : "/settings/company";
  return {
    ready: missing.length === 0 && profile !== null,
    missing,
    taxProfileSaved: profile !== null,
    vatRegistered: profile?.vatRegistered ?? false,
    fixAt,
    ratesByHand: row.rates_auto !== true,
    stripeInvoicesIgnored: settings.enabled && row.stripe_invoices === true,
  };
}
