import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { CustomerBar } from "@/components/admin/customer-bar";
import { INVOICE_STATUS } from "@/components/admin/plan-invoices";
import { formatMoney } from "@/lib/money";
import { SUBSCRIPTION_LABELS } from "@/lib/plans";
import { getStoreBilling, getStoreInvoice } from "@/server/billing";
import { listStorePeople } from "@/server/platform-customers";
import { getStore } from "@/server/stores";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Invoice" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * One of Kaizen's invoices to a store for its plan (D35), as Stripe has it:
 * the platform's order page, linked to the store's owner and its plan.
 */
export default async function PlanInvoicePage({ params }: PageProps<"/admin/platform/stores/[store]/invoices/[invoiceId]">) {
  await connection();
  await requirePlatformAdmin();
  const { store: slug, invoiceId } = await params;
  const store = await getStore(slug);
  if (!store) notFound();
  const [invoice, billing, people] = await Promise.all([
    getStoreInvoice(store.id, invoiceId),
    getStoreBilling(store.id),
    listStorePeople(store.id),
  ]);
  if (!invoice) notFound();
  const owner = people.find((p) => p.role === "owner") ?? people[0];
  const money = (minor: number) => formatMoney(minor, invoice.currency, "nb-NO");
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const planPage = `/admin/platform/stores/${store.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href="/admin/platform/stores" className="underline">
            Stores
          </Link>{" "}
          ›{" "}
          <Link href={planPage} className="underline">
            {store.name}
          </Link>
        </p>
        <h1 className="text-2xl font-semibold">Invoice {invoice.number ?? "(draft)"}</h1>
        <p className="text-sm text-muted">
          {INVOICE_STATUS[invoice.status] ?? invoice.status} · {date(invoice.createdAt)}
          {invoice.mode === "test" && " · test mode"}
        </p>
      </div>

      {owner && (
        <CustomerBar
          customer={{
            href: `/admin/platform/customers/${owner.id}`,
            name: owner.name,
            email: owner.email,
            account: "verified",
            badge: `${owner.role === "owner" ? "Owner" : "Staff"} of ${store.name}`,
            facts: [billing?.planName ? `${billing.planName}, ${SUBSCRIPTION_LABELS[billing.status ?? ""] ?? billing.status}` : "No plan"],
          }}
        />
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="lines" className={card}>
          <h2 id="lines" className="mb-3 font-medium">What it is for</h2>
          <table className="w-full text-left text-sm">
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={i} className="border-b border-border">
                  <td className="py-2 pr-4">{line.description}</td>
                  <td className="py-2 text-right whitespace-nowrap">{money(line.amountMinor)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 pr-4 text-left font-semibold">Total</th>
                <td className="py-2 text-right font-semibold whitespace-nowrap">{money(invoice.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="payment" className={`${card} text-sm`}>
            <h2 id="payment" className="mb-2 font-medium">Payment</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Status</dt>
              <dd>{INVOICE_STATUS[invoice.status] ?? invoice.status}</dd>
              <dt className="text-muted">Paid</dt>
              <dd>{money(invoice.paidMinor)}</dd>
              {invoice.dueAt && (
                <>
                  <dt className="text-muted">Due</dt>
                  <dd>{date(invoice.dueAt)}</dd>
                </>
              )}
              {invoice.paidAt && (
                <>
                  <dt className="text-muted">Paid on</dt>
                  <dd>{date(invoice.paidAt)}</dd>
                </>
              )}
              {invoice.periodStart && invoice.periodEnd && (
                <>
                  <dt className="text-muted">Period</dt>
                  <dd>
                    {date(invoice.periodStart)} – {date(invoice.periodEnd)}
                  </dd>
                </>
              )}
            </dl>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {invoice.hostedUrl && (
                <a href={invoice.hostedUrl} target="_blank" rel="noreferrer" className="underline">
                  Invoice page
                </a>
              )}
              {invoice.pdfUrl && (
                <a href={invoice.pdfUrl} target="_blank" rel="noreferrer" className="underline">
                  PDF
                </a>
              )}
              <a
                href={`https://dashboard.stripe.com/${invoice.mode === "test" ? "test/" : ""}invoices/${invoice.id}`}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                In Stripe
              </a>
            </p>
          </section>
          <section aria-labelledby="plan" className={`${card} text-sm`}>
            <h2 id="plan" className="mb-2 font-medium">Plan</h2>
            <p>
              {billing?.planName ?? "No plan"}
              {billing?.status && <span className="text-muted"> · {SUBSCRIPTION_LABELS[billing.status] ?? billing.status}</span>}
            </p>
            <Link href={planPage} className="mt-2 inline-block underline">
              The store&apos;s plan and all its invoices
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
