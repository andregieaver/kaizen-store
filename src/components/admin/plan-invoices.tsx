import Link from "next/link";

import { formatMoney } from "@/lib/money";
import type { PlanInvoice } from "@/server/billing";
import { platformEn, type PlatformMessages } from "@/lib/admin-messages/platform.en";

/** Stripe's invoice statuses, in the admin's words (D35); a page in another language reads `platform.invoiceList.status` (D312 A11). */
export const INVOICE_STATUS: Record<string, string> = platformEn.invoiceList.status;

/** A store's plan invoices, each opening its own page; or why they cannot be shown. */
export function InvoiceList({
  storeSlug,
  invoices,
  date,
  words = platformEn.invoiceList,
}: {
  storeSlug: string;
  invoices: PlanInvoice[] | null;
  date: (iso: string) => string;
  /** The account's words (D312 A11); English unless given. */
  words?: PlatformMessages["invoiceList"];
}) {
  if (invoices === null) return <p className="text-sm text-muted">{words.unreadable}</p>;
  if (invoices.length === 0) return <p className="text-sm text-muted">{words.none}</p>;
  return (
    <ul className="divide-y divide-line text-sm">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
          <span>
            <Link href={`/admin/platform/stores/${storeSlug}/invoices/${invoice.id}`} className="font-medium underline">
              {invoice.number ?? words.draft}
            </Link>
            <span className="block text-xs text-muted">
              {date(invoice.createdAt)} · {words.status[invoice.status] ?? invoice.status}
              {invoice.mode === "test" && words.testMode}
            </span>
          </span>
          <span className="whitespace-nowrap">{formatMoney(invoice.totalMinor, invoice.currency, "nb-NO")}</span>
        </li>
      ))}
    </ul>
  );
}
