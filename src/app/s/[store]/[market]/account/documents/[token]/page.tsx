import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";

import { DocumentPrintButton } from "@/components/documents/document-print-button";
import { OrderDocumentView } from "@/components/documents/order-document-view";
import { documentPdfHref } from "@/components/documents/order-documents";
import { PayRouteGuard } from "@/components/pay-route-guard";
import { documentText } from "@/lib/invoice-text";
import { isDocumentToken } from "@/lib/document-token";
import { marketPath } from "@/lib/paths";
import { documentFileName } from "@/lib/work-invoice-print";
import { findDocumentByToken } from "@/server/invoices";
import { resolveShop } from "@/server/shop";

type Props = PageProps<"/s/[store]/[market]/account/documents/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/** Hidden when printing: the store's header, footer and navigation, so only the document is on the paper. */
const PRINT_ONLY_DOCUMENT = `
@media print {
  body header:not(.wd header), body footer:not(.wd footer), body nav { display: none !important; }
}
`;

/**
 * A shop order's invoice or credit note, from the link in the shopper's email or on their order page (D159, `docs/wave-1b-invoices.md` 2.2
 * point 4). The token in the address is the whole access, so there is no sign-in and no cookie: it is long and random, the page is not indexed
 * and the address is not passed on as a referrer. A token of another store, a malformed one and an anonymised document are the same not-found page (it streams, so its status line is sent first, as Work's hosted invoice; the PDF route answers a real 404). The
 * document is drawn from its frozen snapshot, in the order's language; nothing here reads live data or changes anything. `?print=1` (where the
 * PDF route lands when it could not make the file) opens the browser's print dialog, which saves a PDF.
 */
export default function HostedDocumentPage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-[210mm] animate-pulse rounded-lg bg-surface" />}>
      <Hosted params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Hosted({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || !isDocumentToken(token)) notFound();
  const { store, market } = shop;
  const found = await findDocumentByToken(store.id, token);
  if (!found) notFound();
  const { snapshot } = found;
  const t = documentText(snapshot.language);
  const title = documentFileName(snapshot.documentType === "credit_note" ? t.creditNote : t.invoice, snapshot.number);
  const auto = (await searchParams).print === "1";
  const base = marketPath(store.slug, market.slug);
  return (
    <div className="mx-auto flex w-full max-w-[210mm] flex-col gap-4" lang={snapshot.language}>
      {/* Entered by a full page load, so no tracking script or owner code from an earlier page is still here to read the token in the address. */}
      <PayRouteGuard store={store.slug} />
      <style>{PRINT_ONLY_DOCUMENT}</style>
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <h1 className="font-heading text-2xl tracking-tight">{title}</h1>
        <div className="flex flex-wrap items-center gap-3">
          <a href={documentPdfHref(base, token)} className="inline-flex min-h-11 items-center button-primary px-5 text-sm font-medium">
            {t.downloadPdf}
          </a>
          <DocumentPrintButton label={t.print} documentTitle={title} auto={auto} />
        </div>
      </div>
      <div className="rounded-lg bg-[#f3f4f6] p-2 sm:p-4">
        <OrderDocumentView snapshot={snapshot} />
      </div>
    </div>
  );
}
