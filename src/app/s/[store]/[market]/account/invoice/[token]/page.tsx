import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { HostedInvoice } from "@/components/work/hosted-invoice";
import { marketPath } from "@/lib/paths";
import { isInvoiceToken } from "@/lib/work-email";
import { printableState } from "@/lib/work-invoice-print";
import { resolveShop } from "@/server/shop";
import { creditNoteDocumentData, findInvoiceByToken, invoiceDocumentData } from "@/server/work-invoices";

type Props = PageProps<"/s/[store]/[market]/account/invoice/[token]">;

export const metadata: Metadata = { robots: { index: false, follow: false }, referrer: "no-referrer" };

/**
 * A client's invoice, from the link in the email (docs/work.md 4.7, WP7b). The token in the
 * address is the whole access, so there is no sign-in; it is long and random, the page is not
 * indexed, and the address is not passed on as a referrer. Only an issued invoice (or a credited
 * one) is ever found: a draft has no token, and a token that is not this store's is a 404.
 * `?credit={id}` shows one of the invoice's credit notes. Everything is read per request from the
 * frozen document; nothing here changes anything.
 */
export default function HostedInvoicePage({ params, searchParams }: Props) {
  return (
    <Suspense fallback={<div className="mx-auto h-96 max-w-[210mm] animate-pulse rounded-lg bg-surface" />}>
      <Hosted params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Hosted({ params, searchParams }: Pick<Props, "params" | "searchParams">) {
  const { store: storeSlug, market: marketSlug, token } = await params;
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop || !isInvoiceToken(token)) notFound();
  const { store, market } = shop;
  const found = await findInvoiceByToken(token);
  if (!found || found.storeId !== store.id) notFound();
  const doc = await invoiceDocumentData(store.id, found.invoiceId);
  if (!doc || !printableState(doc).printable) notFound();
  const wanted = (await searchParams).credit;
  const creditId = typeof wanted === "string" && z.uuid().safeParse(wanted).success ? wanted : null;
  const credit = creditId ? await creditNoteDocumentData(store.id, creditId) : null;
  return (
    <HostedInvoice
      doc={doc}
      credit={credit && credit.invoiceId === doc.invoiceId ? credit : null}
      invoiceHref={marketPath(store.slug, market.slug, `/account/invoice/${token}`)}
      contactEmail={store.details.contactEmail}
    />
  );
}
