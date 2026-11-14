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
import { tidyOptions } from "@/server/work-imported-invoices";
import { workBase } from "@/lib/work-paths";
import { memberCan, requirePermission } from "@/server/permissions";
import { Card, PageHeader } from "@/components/admin/ui";
import { workWords } from "@/server/work-words";
import { workScreens, workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";
import { einvoiceLines } from "@/server/einvoice-sending";
import { TripletexDocumentsPanel } from "@/components/admin/tripletex-panel";
import { adminLangOf } from "@/lib/admin-lang";
import { getTripletexConnection, tripletexDocuments } from "@/server/tripletex";

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
  const pw = workScreens().workInvoicePage;
  const title = invoice.documentNumber ? fillWords(pw.title, { number: invoice.documentNumber }) : tw.draftInvoice;

  const header = (
    <header className="flex flex-col gap-2">
      <nav aria-label={tw.breadcrumb} className="text-sm text-muted">
        <Link href={list} className="underline">
          {tw.invoices}
        </Link>{" "}
        / {invoice.documentNumber ?? pw.draft}
      </nav>
      <div className="flex flex-wrap items-center gap-3">
        <PageHeader title={<>{title}</>} />
        {invoice.status === "draft" && <InvoiceStatusChip status="draft" dueOn={null} today={detail.today} />}
      </div>
      <p className="text-sm text-muted">
        {pw.for}{" "}
        <Link href={`${workBase(store.slug)}/clients/${client.id}`} className="underline">
          {client.name}
        </Link>
        {detail.assignment ? `, ${detail.assignment.name}` : ""}
      </p>
    </header>
  );

  if (invoice.status !== "draft") {
    const homeCurrency = invoice.vatHomeMinor !== null ? await countryCurrency(detail.seller?.country ?? null) : null;
    // Tripletex (D453): the invoice and its credit notes as they stand there, for a store that is connected.
    const tripletex = await getTripletexConnection(store.id);
    const booked = [
      ...(invoice.documentNumber ? [{ kind: "work_invoice" as const, localId: invoice.id, number: invoice.documentNumber }] : []),
      ...detail.creditNotes.map((note) => ({ kind: "work_credit_note" as const, localId: note.id, number: note.documentNumber })),
    ];
    const inTripletex = tripletex ? await tripletexDocuments(store.id, booked) : null;
    // E-invoices (D463): to a business client, the invoice and its credit notes as the network and the access point left them.
    const lang = adminLangOf(viewer.account.adminLocale);
    const einvoiceDocs = [
      ...(invoice.documentNumber && !invoice.imported ? [{ type: "work_invoice" as const, id: invoice.id, label: fillWords(pw.invoice, { number: invoice.documentNumber }), href: `${workBase(store.slug)}/invoices/${invoice.id}/xml` }] : []),
      ...detail.creditNotes.map((note) => ({ type: "work_credit_note" as const, id: note.id, label: fillWords(pw.creditNote, { number: note.documentNumber }), href: `${workBase(store.slug)}/credit-notes/${note.id}/xml` })),
    ];
    const einvoice = detail.buyer?.business && einvoiceDocs.length > 0 ? await einvoiceLines(store.id, einvoiceDocs, lang) : null;
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
          tidy={invoice.imported && memberCan(viewer, "owner") ? await tidyOptions(store.id, invoice.id) : null}
        />
        {einvoice && (
          <Card title={pw.einvoiceTitle} compact>
            <ul className="flex flex-col gap-2 text-sm">
              {einvoiceDocs.map((doc) => (
                <li key={doc.id}>
                  <p className="font-medium">{doc.label}</p>
                  <p className="text-muted">{einvoice[`${doc.type}:${doc.id}`] ?? pw.notYet}</p>
                  <a href={doc.href} className="underline">
                    {pw.download}
                  </a>
                </li>
              ))}
            </ul>
          </Card>
        )}
        {inTripletex && !invoice.imported && (
          <TripletexDocumentsPanel lang={adminLangOf(viewer.account.adminLocale)} storeSlug={store.slug} documents={booked} states={inTripletex} owner={memberCan(viewer, "owner")} />
        )}
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
  // The checklist's words in the account's language, read here so the client editor imports no catalogue (bloat review step 0.11).
  const rw = workScreens().workReadiness;
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
        readinessWords={{
          toFix: rw.toFix,
          fix: rw.fix,
          check: rw.check,
          open: rw.open,
          problems: adminLangOf(viewer.account.adminLocale) === "en" ? null : rw.problems,
        }}
      />
    </div>
  );
}
