import type { Metadata } from "next";

import { InvoiceNotes, InvoiceReadinessList, InvoiceSettingsForm, SeriesForm } from "@/components/admin/invoices/invoice-settings-form";
import { getInvoiceSettings, invoiceReadiness, seriesStates } from "@/server/invoice-settings";
import { requirePermission } from "@/server/permissions";

import { saveInvoiceSettingsAction, setSeriesAction } from "./actions";

export const metadata: Metadata = { title: "Invoicing settings" };

/**
 * Invoicing (D159, `docs/wave-1b-invoices.md` 2.3): the switch, what is missing before it can be switched on, the two number series until
 * their first document is issued, the note printed on every document and whether the confirmation email carries the invoice. Only owners open
 * it: it changes legal numbering. The wording is for an accountant's eyes and needs review.
 */
export default async function InvoiceSettingsPage({ params }: PageProps<"/admin/[store]/settings/invoices">) {
  const { store } = await requirePermission((await params).store, "owner");
  const base = `/admin/${store.slug}`;
  const [settings, readiness, series] = await Promise.all([getInvoiceSettings(store.id), invoiceReadiness(store.id), seriesStates(store.id)]);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Invoicing</h1>
        <p className="max-w-2xl text-sm text-muted">
          Every paid order gets an invoice in the store&apos;s own numbered series, made by the system when the payment is recorded, and every refund that
          succeeds gets a credit note in a series of its own. The shopper finds them on the order page and in the order emails. This is not tax advice.
        </p>
      </div>
      <InvoiceReadinessList base={base} readiness={readiness} />
      <InvoiceSettingsForm settings={settings} readiness={readiness} paymentsHref={`${base}/settings/payments`} saveAction={saveInvoiceSettingsAction.bind(null, store.slug)} />
      {series.map((state) => (
        <SeriesForm key={state.series} state={state} action={setSeriesAction.bind(null, store.slug)} />
      ))}
      <InvoiceNotes />
    </div>
  );
}
