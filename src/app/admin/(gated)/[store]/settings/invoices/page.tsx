import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { InvoiceNotes, InvoiceReadinessList, InvoiceSettingsForm, SeriesForm } from "@/components/admin/invoices/invoice-settings-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { getInvoiceSettings, invoiceReadiness, seriesStates } from "@/server/invoice-settings";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { saveInvoiceSettingsAction, setSeriesAction } from "./actions";

export const metadata: Metadata = { title: "Invoicing settings" };

/**
 * Invoicing (D159, `docs/wave-1b-invoices.md` 2.3): the switch, what is missing before it can be switched on, the two number series until
 * their first document is issued, the note printed on every document and whether the confirmation email carries the invoice. Only owners open
 * it: it changes legal numbering. The wording is for an accountant's eyes and needs review.
 */
export default async function InvoiceSettingsPage({ params }: PageProps<"/admin/[store]/settings/invoices">) {
  const gated = await requirePermission((await params).store, "owner");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const base = `/admin/${store.slug}`;
  const words = adminText(adminLangOf(gated.account.adminLocale), "invoices");
  const [settings, readiness, series] = await Promise.all([getInvoiceSettings(store.id), invoiceReadiness(store.id), seriesStates(store.id)]);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={words.settings.title}
        description={words.settings.description}
      />
      <InvoiceReadinessList base={base} readiness={readiness} words={words} />
      <InvoiceSettingsForm settings={settings} readiness={readiness} paymentsHref={`${base}/settings/payments`} saveAction={saveInvoiceSettingsAction.bind(null, store.slug)} words={words} />
      {series.map((state) => (
        <SeriesForm key={state.series} state={state} action={setSeriesAction.bind(null, store.slug)} words={words} />
      ))}
      <InvoiceNotes words={words} />
    </div>
  );
}
