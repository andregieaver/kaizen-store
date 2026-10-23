import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DraftEditor } from "@/components/admin/work/invoice-draft-editor";
import { InvoiceStatusChip } from "@/components/admin/work/invoice-status";
import { IssuedInvoiceView } from "@/components/admin/work/invoice-issued";
import { WorkOff } from "@/components/admin/work/work-off";
import { getAssignment, getClient } from "@/server/work";
import {
  countryCurrency,
  draftLineTime,
  fixedFeeAssignmentIds,
  fxSuggestions,
  invoiceVatBasis,
} from "@/server/work-invoice-screens";
import { getWorkInvoiceDetail, nextInvoiceNumberPreview } from "@/server/work-invoices";
import { workBase } from "@/lib/work-paths";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { workWords } from "@/server/work-words";
import { workText } from "@/lib/work-text";

export const metadata: Metadata = { title: "Invoice" };

/**
 * One invoice (docs/work.md 5.2, 7.2 WP6). A draft is an editor that saves itself, with live totals, a checklist
 * and the issue step; an issued, paid or void invoice is read-only from what was frozen when it was issued, with
 * its payments, credit notes and history.
 */
export default async function WorkInvoicePage({ params }: PageProps<"/admin/account/work/s/[store]/invoices/[invoiceId]">) {
  await workWords();
  const tw = workText().pageStoreInvoicesInvoiceIdPage;
  const { store: slug, invoiceId } = await params;
  const viewer = await requirePermission(slug, "settings:read");
  const { store } = viewer;
  const off = (await workWords()).w.off;
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title={off.titles.invoice} words={off} />;
  // The overview's "Invoice time" leads to `/invoices/new`: the list, with the New invoice dialog open.
  if (invoiceId === "new") redirect(`${workBase(store.slug)}/invoices?new=1`);
  const detail = await getWorkInvoiceDetail(store.id, invoiceId);
  if (!detail) notFound();

  const { invoice, client } = detail;
  const locale = store.markets[0]?.locale ?? "en";
  const list = `${workBase(store.slug)}/invoices`;
  const title = invoice.documentNumber ? `Invoice ${invoice.documentNumber}` : tw.draftInvoice;

  const header = (
    <header className="flex flex-col gap-2">
      <nav aria-label={tw.breadcrumb} className="text-sm text-muted">
        <Link href={list} className="underline">
          {tw.invoices}
        </Link>{" "}
        / {invoice.documentNumber ?? "Draft"}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={<>{title}</>} />
        {invoice.status === "draft" && <InvoiceStatusChip status="draft" dueOn={null} today={detail.today} />}
      </div>
      <p className="text-sm text-muted">
        For{" "}
        <Link href={`${workBase(store.slug)}/clients/${client.id}`} className="underline">
          {client.name}
        </Link>
        {detail.assignment ? `, ${detail.assignment.name}` : ""}
      </p>
    </header>
  );

  if (invoice.status !== "draft") {
    const homeCurrency = invoice.vatHomeMinor !== null ? await countryCurrency(detail.seller?.country ?? null) : null;
    return (
      <div className="flex flex-col gap-6">
        {header}
        <IssuedInvoiceView
          storeSlug={store.slug}
          locale={locale}
          timeZone={store.timeZone}
          detail={detail}
          isOwner={memberCan(viewer, "owner")}
          homeCurrency={homeCurrency}
        />
      </div>
    );
  }

  const [vat, fixedFee, timeByLine, nextNumber, fullClient, assignment] = await Promise.all([
    invoiceVatBasis(store.id),
    fixedFeeAssignmentIds(store.id, client.id),
    draftLineTime(store.id, invoice.id, client.id),
    nextInvoiceNumberPreview(store.id),
    getClient(store.id, client.id),
    invoice.assignmentId ? getAssignment(store.id, invoice.assignmentId) : Promise.resolve(null),
  ]);
  const newLineRateMinor = (assignment?.summary.rateMinor || fullClient?.defaultHourlyRateMinor) ?? null;
  return (
    <div className="flex flex-col gap-6">
      {header}
      <DraftEditor
        storeSlug={store.slug}
        locale={locale}
        detail={detail}
        vat={vat}
        fixedFeeAssignmentIds={fixedFee}
        timeByLine={timeByLine}
        newLineRateMinor={newLineRateMinor || null}
        nextNumber={nextNumber}
        fxSuggestions={fxSuggestions(store, detail.readiness?.homeCurrency ?? null)}
      />
    </div>
  );
}
