import type { Metadata } from "next";
import { Suspense } from "react";

import { InvoicesView } from "@/components/admin/invoices/invoices-view";
import { InvoicesSkeleton } from "@/components/admin/invoices/skeletons";
import { DOCUMENTS_PER_PAGE, exportProblemOf, parseInvoiceQuery } from "@/lib/invoice-admin";
import { todayIn } from "@/lib/work-dates";
import { getInvoiceSettings } from "@/server/invoice-settings";
import { failingPdfs, invoiceCounts, listCreditNotes, listInvoices, waitingCreditNotes, waitingInvoices } from "@/server/invoices";
import { memberCan, requirePermission } from "@/server/permissions";

import { checkAgainAction, retryPdfAction } from "./actions";

export const metadata: Metadata = { title: "Invoices" };

type Props = PageProps<"/admin/[store]/invoices">;

/**
 * The store's invoices and credit notes (D159, `docs/wave-1b-invoices.md` 2.3): what was issued, by period and search, the orders still
 * waiting for an invoice with the reason, and a CSV for the accountant. Everyone who can read orders sees it; *Check again*, *Try again* and
 * the CSV need the right to change orders.
 */
export default async function InvoicesPage({ params, searchParams }: Props) {
  const { store } = await requirePermission((await params).store, "orders:read");
  return (
    <Suspense fallback={<InvoicesSkeleton />}>
      <Documents storeSlug={store.slug} searchParams={searchParams} />
    </Suspense>
  );
}

async function Documents({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  // Every page checks for itself: a layout's check does not stop its page from streaming.
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const today = todayIn(store.timeZone);
  const raw = await searchParams;
  const query = parseInvoiceQuery(raw, today);
  const filter = { from: query.from, to: query.to, q: query.q, limit: DOCUMENTS_PER_PAGE, offset: (query.page - 1) * DOCUMENTS_PER_PAGE };
  const waitingTab = query.tab === "waiting";
  const [settings, counts, documents, waiting, waitingNotes, failing] = await Promise.all([
    getInvoiceSettings(store.id),
    invoiceCounts(store.id, today),
    waitingTab ? null : query.tab === "credit-notes" ? listCreditNotes(store.id, filter) : listInvoices(store.id, filter),
    waitingTab ? waitingInvoices(store.id, today) : [],
    waitingTab ? waitingCreditNotes(store.id) : [],
    waitingTab ? failingPdfs(store.id) : [],
  ]);
  return (
    <InvoicesView
      base={`/admin/${store.slug}`}
      query={query}
      today={today}
      counts={counts}
      invoicingOn={settings.enabled}
      canWrite={memberCan(member, "orders:write")}
      canSettings={memberCan(member, "owner")}
      documents={documents}
      waiting={waiting}
      waitingNotes={waitingNotes}
      failing={failing}
      exportProblem={exportProblemOf(typeof raw.export === "string" ? raw.export : undefined)}
      actions={{ checkAgain: checkAgainAction.bind(null, store.slug), retryPdf: retryPdfAction.bind(null, store.slug) }}
      locale={store.markets[0]?.locale ?? "en-GB"}
    />
  );
}
