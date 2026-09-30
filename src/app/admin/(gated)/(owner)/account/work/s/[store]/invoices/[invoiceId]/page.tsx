import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { DraftEditor } from "@/components/admin/work/invoice-draft-editor";
import { InvoiceStatusChip } from "@/components/admin/work/invoice-status";
import { IssuedInvoiceView } from "@/components/admin/work/invoice-issued";
import { WorkOff } from "@/components/admin/work/work-off";
import { requireMember } from "@/server/auth";
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

export const metadata: Metadata = { title: "Invoice" };

/**
 * One invoice (docs/work.md 5.2, 7.2 WP6). A draft is an editor that saves itself, with live totals, a checklist
 * and the issue step; an issued, paid or void invoice is read-only from what was frozen when it was issued, with
 * its payments, credit notes and history.
 */
export default async function WorkInvoicePage({ params }: PageProps<"/admin/account/work/s/[store]/invoices/[invoiceId]">) {
  const { store: slug, invoiceId } = await params;
  const { store, role } = await requireMember(slug);
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title="Invoice" />;
  // The overview's "Invoice time" leads to `/invoices/new`: the list, with the New invoice dialog open.
  if (invoiceId === "new") redirect(`${workBase(store.slug)}/invoices?new=1`);
  const detail = await getWorkInvoiceDetail(store.id, invoiceId);
  if (!detail) notFound();

  const { invoice, client } = detail;
  const locale = store.markets[0]?.locale ?? "en";
  const list = `${workBase(store.slug)}/invoices`;
  const title = invoice.documentNumber ? `Invoice ${invoice.documentNumber}` : "Draft invoice";

  const header = (
    <header className="flex flex-col gap-2">
      <nav aria-label="Breadcrumb" className="text-sm text-muted">
        <Link href={list} className="underline">
          Invoices
        </Link>{" "}
        / {invoice.documentNumber ?? "Draft"}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{title}</h1>
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
      <div className="flex max-w-5xl flex-col gap-6">
        {header}
        <IssuedInvoiceView
          storeSlug={store.slug}
          locale={locale}
          timeZone={store.timeZone}
          detail={detail}
          isOwner={role === "owner"}
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
    <div className="flex max-w-5xl flex-col gap-6">
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
