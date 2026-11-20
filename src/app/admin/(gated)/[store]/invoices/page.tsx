import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { InvoicesView } from "@/components/admin/invoices/invoices-view";
import { InvoicesSkeleton } from "@/components/admin/invoices/skeletons";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { exportProblemOf, invoicesHref, parseInvoiceQuery } from "@/lib/invoice-admin";
import { LIST_PAGE_SIZE, listOffset } from "@/lib/list-page";
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
  const gated = await requirePermission((await params).store, "orders:read");
  // While the online shop is off (D178 step 5), what was sold stays reachable as long as an order can still be withdrawn from or returned.
  const shopOff = await requireShopOrAfterSale(gated);
  if (shopOff) return shopOff;
  const { store } = gated;
  return (
    <Suspense fallback={<InvoicesSkeleton label={adminText(adminLangOf(gated.account.adminLocale), "invoices").view.loading} />}>
      <Documents storeSlug={store.slug} searchParams={searchParams} />
    </Suspense>
  );
}

async function Documents({ storeSlug, searchParams }: { storeSlug: string; searchParams: Props["searchParams"] }) {
  // Every page checks for itself: a layout's check does not stop its page from streaming.
  const member = await requirePermission(storeSlug, "orders:read");
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "invoices");
  // English keeps the store's own way of writing money; another admin language writes it its own way.
  const locale = lang === "en" ? (store.markets[0]?.locale ?? "en-GB") : ADMIN_LANG_FACTS[lang].locale;
  const today = todayIn(store.timeZone);
  const raw = await searchParams;
  const query = parseInvoiceQuery(raw, today);
  // A hundred a page, with how many the period and search find in all (code review 1.13, D834).
  const filter = { from: query.from, to: query.to, q: query.q, limit: LIST_PAGE_SIZE, offset: listOffset(query.page) };
  const waitingTab = query.tab === "waiting";
  const [settings, counts, documents, waiting, waitingNotes, failing] = await Promise.all([
    getInvoiceSettings(store.id),
    invoiceCounts(store.id, today),
    waitingTab ? null : query.tab === "credit-notes" ? listCreditNotes(store.id, filter) : listInvoices(store.id, filter),
    waitingTab ? waitingInvoices(store.id, today) : [],
    waitingTab ? waitingCreditNotes(store.id) : [],
    waitingTab ? failingPdfs(store.id) : [],
  ]);
  // A page past the last (a link kept from before) opens the first.
  if (documents && documents.rows.length === 0 && query.page > 1) redirect(invoicesHref(`/admin/${store.slug}/invoices`, { ...query, page: 1 }, today));
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
      exportProblem={exportProblemOf(typeof raw.export === "string" ? raw.export : undefined, words)}
      actions={{ checkAgain: checkAgainAction.bind(null, store.slug), retryPdf: retryPdfAction.bind(null, store.slug) }}
      locale={locale}
      words={words}
      pagerWords={adminText(lang, "kit").pager}
    />
  );
}
