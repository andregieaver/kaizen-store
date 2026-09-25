import Link from "next/link";

import { formatMoney } from "@/lib/money";
import type { PlanInvoice } from "@/server/billing";

/** Stripe's invoice statuses, in the admin's words (D35). */
export const INVOICE_STATUS: Record<string, string> = {
  draft: "Draft",
  open: "Waiting for payment",
  paid: "Paid",
  uncollectible: "Uncollectible",
  void: "Void",
};

/** A store's plan invoices, each opening its own page; or why they cannot be shown. */
export function InvoiceList({
  storeSlug,
  invoices,
  date,
}: {
  storeSlug: string;
  invoices: PlanInvoice[] | null;
  date: (iso: string) => string;
}) {
  if (invoices === null) return <p className="text-sm text-muted">Invoices cannot be read from Stripe right now.</p>;
  if (invoices.length === 0) return <p className="text-sm text-muted">No invoices yet.</p>;
  return (
    <ul className="divide-y divide-border text-sm">
      {invoices.map((invoice) => (
        <li key={invoice.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
          <span>
            <Link href={`/admin/platform/stores/${storeSlug}/invoices/${invoice.id}`} className="font-medium underline">
              {invoice.number ?? "Draft invoice"}
            </Link>
            <span className="block text-xs text-muted">
              {date(invoice.createdAt)} · {INVOICE_STATUS[invoice.status] ?? invoice.status}
              {invoice.mode === "test" && " · test mode"}
            </span>
          </span>
          <span className="whitespace-nowrap">{formatMoney(invoice.totalMinor, invoice.currency, "nb-NO")}</span>
        </li>
      ))}
    </ul>
  );
}
