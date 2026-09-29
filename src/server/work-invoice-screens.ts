import "server-only";

import { sql } from "drizzle-orm";

import { readDb } from "@/db/client";
import { OFFERABLE_CURRENCIES } from "@/lib/money";
import type { Store } from "@/server/stores";

import { listAssignments, listClients } from "./work";
import { suggestFxRate } from "./work-invoices";
import { listTimeEntries } from "./work-time";

type Row = Record<string, unknown>;

/**
 * What the invoice screens need besides the invoice itself (docs/work.md 7.2 WP6): the store's VAT basis for
 * the editor's live totals, its fixed-fee assignments (whose lines logged time never rewrites), the choices of
 * the new-invoice dialog and the exchange rate to suggest. Reads only, every query takes the store's id.
 */

/** What prices a draft besides the client: whether the store charges VAT, and its country's standard rate in basis points. */
export async function invoiceVatBasis(
  storeId: string,
): Promise<{ sellerVatRegistered: boolean; standardRateBp: number }> {
  const [row] = await readDb().execute<Row>(sql`
    select coalesce(ws.vat_registered, true) as vat_registered,
           coalesce(round(commerce.vat_rate(st.country, 'standard') * 10000), 0)::int as standard_bp
    from commerce.stores st left join commerce.work_settings ws on ws.store_id = st.id
    where st.id = ${storeId}::uuid
  `);
  return {
    sellerVatRegistered: row ? Boolean(row.vat_registered) : true,
    standardRateBp: row ? Number(row.standard_bp) : 0,
  };
}

/** The client's assignments that bill a fixed fee. */
export async function fixedFeeAssignmentIds(storeId: string, clientId: string): Promise<string[]> {
  const rows = await readDb().execute<Row>(sql`
    select id from commerce.work_assignments
    where store_id = ${storeId}::uuid and client_id = ${clientId}::uuid and billing_type = 'fixed_fee'
  `);
  return rows.map((row) => String(row.id));
}

export type NewInvoiceChoices = {
  clients: { id: string; name: string; currency: string; rateMinor: number | null }[];
  assignments: { id: string; clientId: string; name: string; draftInvoiceId: string | null }[];
  currencies: string[];
};

/** The clients (not archived) and their assignments the new-invoice dialog offers, with the drafts already made. */
export async function newInvoiceChoices(storeId: string): Promise<NewInvoiceChoices> {
  const [clients, assignments] = await Promise.all([listClients(storeId), listAssignments(storeId, { status: "all" })]);
  return {
    clients: clients.map((c) => ({
      id: c.id,
      name: c.name,
      currency: c.currency,
      rateMinor: c.defaultHourlyRateMinor,
    })),
    assignments: assignments.map((a) => ({
      id: a.id,
      clientId: a.clientId,
      name: a.name,
      draftInvoiceId: a.draftInvoiceId,
    })),
    currencies: [...OFFERABLE_CURRENCIES],
  };
}

/** The exchange rate to suggest for each currency the invoice could be in, from the store's own rates (checked against the ECB's by the person). */
export function fxSuggestions(
  store: Pick<Store, "chosenCurrencies">,
  homeCurrency: string | null,
): Record<string, string> {
  if (!homeCurrency) return {};
  const rates = new Map(store.chosenCurrencies.map((c) => [c.currency, { rate: c.rate }]));
  const out: Record<string, string> = {};
  for (const currency of OFFERABLE_CURRENCIES) {
    if (currency === homeCurrency) continue;
    const rate = suggestFxRate(rates, homeCurrency, currency);
    if (rate) out[currency] = rate;
  }
  return out;
}

/** One time entry as it sits on a draft's line, for taking it off again. */
export type LineTime = {
  id: string;
  workDate: string;
  /** What the invoice takes from it: the minutes less what prepaid hours covered. */
  minutes: number;
  person: string;
  task: string | null;
  note: string | null;
};

/** The logged time on a draft's lines, by line id: what "Release time" can take off. */
export async function draftLineTime(
  storeId: string,
  invoiceId: string,
  clientId: string,
): Promise<Record<string, LineTime[]>> {
  const { entries } = await listTimeEntries(storeId, { clientId, billing: "on_draft", limit: 5000 });
  const byLine: Record<string, LineTime[]> = {};
  for (const entry of entries) {
    if (entry.invoiceId !== invoiceId || !entry.invoiceLineId) continue;
    (byLine[entry.invoiceLineId] ??= []).push({
      id: entry.id,
      workDate: entry.workDate,
      minutes: entry.invoiceableMinutes,
      person: entry.accountName,
      task: entry.taskTitle,
      note: entry.note,
    });
  }
  for (const list of Object.values(byLine)) list.sort((a, b) => a.workDate.localeCompare(b.workDate));
  return byLine;
}

/** The currency of a country (the seller's, for the VAT stated in it), or null. */
export async function countryCurrency(country: string | null): Promise<string | null> {
  if (!country) return null;
  const [row] = await readDb().execute<Row>(
    sql`select currency::text as currency from commerce.countries where code = ${country}`,
  );
  return row ? String(row.currency) : null;
}
