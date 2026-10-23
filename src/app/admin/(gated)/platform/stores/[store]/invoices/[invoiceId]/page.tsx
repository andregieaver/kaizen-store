import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";

import { CustomerBar } from "@/components/admin/customer-bar";
import { formatMoney } from "@/lib/money";
import { getStoreBilling, getStoreInvoice } from "@/server/billing";
import { listStorePeople } from "@/server/platform-customers";
import { getStore } from "@/server/stores";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Invoice" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * One of Kaizen's invoices to a store for its plan (D35), as Stripe has it:
 * the platform's order page, linked to the store's owner and its plan.
 */
export default async function PlanInvoicePage({ params }: PageProps<"/admin/platform/stores/[store]/invoices/[invoiceId]">) {
  await connection();
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").invoice;
  const t = adminText(lang, "platform");
  const billingWords = adminText(lang, "billing");
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
  const date = (iso: string) => new Date(iso).toLocaleDateString(ADMIN_LANG_FACTS[lang].locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const planPage = `/admin/platform/stores/${store.slug}`;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-sm">
          <Link href="/admin/platform/stores" className="underline">
            {w.stores}
          </Link>{" "}
          ›{" "}
          <Link href={planPage} className="underline">
            {store.name}
          </Link>
        </p>
        <PageHeader
          title={fillWords(w.title, { number: invoice.number ?? w.draft })}
          description={<>{t.invoiceList.status[invoice.status] ?? invoice.status} · {date(invoice.createdAt)}{invoice.mode === "test" && w.testMode}</>}
        />
        </div>

      {owner && (
        <CustomerBar
          words={adminText(lang, "customers")}
          customer={{
            href: `/admin/platform/customers/${owner.id}`,
            name: owner.name,
            email: owner.email,
            avatarPath: owner.avatarPath,
            account: "verified",
            badge: fillWords(owner.role === "owner" ? w.ownerOf : w.staffOf, { store: store.name }),
            facts: [billing?.planName ? `${billing.planName}, ${billingWords.statuses[billing.status ?? ""] ?? billing.status}` : w.noPlan],
          }}
        />
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_18rem]">
        <section aria-labelledby="lines" className={card}>
          <h2 id="lines" className="mb-3 text-title text-ink">{w.for}</h2>
          <table className="w-full text-left text-sm">
            <tbody>
              {invoice.lines.map((line, i) => (
                <tr key={i} className="border-b border-line">
                  <td className="py-2 pr-4">{line.description}</td>
                  <td className="py-2 text-right whitespace-nowrap">{money(line.amountMinor)}</td>
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-2 pr-4 text-left font-medium">{w.total}</th>
                <td className="py-2 text-right font-medium whitespace-nowrap">{money(invoice.totalMinor)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="payment" className={`${card} text-sm`}>
            <h2 id="payment" className="mb-2 text-title text-ink">{w.payment}</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">{w.status}</dt>
              <dd>{t.invoiceList.status[invoice.status] ?? invoice.status}</dd>
              <dt className="text-muted">{w.paid}</dt>
              <dd>{money(invoice.paidMinor)}</dd>
              {invoice.dueAt && (
                <>
                  <dt className="text-muted">{w.due}</dt>
                  <dd>{date(invoice.dueAt)}</dd>
                </>
              )}
              {invoice.paidAt && (
                <>
                  <dt className="text-muted">{w.paidOn}</dt>
                  <dd>{date(invoice.paidAt)}</dd>
                </>
              )}
              {invoice.periodStart && invoice.periodEnd && (
                <>
                  <dt className="text-muted">{w.period}</dt>
                  <dd>
                    {date(invoice.periodStart)} – {date(invoice.periodEnd)}
                  </dd>
                </>
              )}
            </dl>
            <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
              {invoice.hostedUrl && (
                <a href={invoice.hostedUrl} target="_blank" rel="noreferrer" className="underline">
                  {w.page}
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
                {w.inStripe}
              </a>
            </p>
          </section>
          <section aria-labelledby="plan" className={`${card} text-sm`}>
            <h2 id="plan" className="mb-2 text-title text-ink">{w.plan}</h2>
            <p>
              {billing?.planName ?? w.noPlan}
              {billing?.status && <span className="text-muted"> · {billingWords.statuses[billing.status] ?? billing.status}</span>}
            </p>
            <Link href={planPage} className="mt-2 inline-block underline">
              {w.storePlan}
            </Link>
          </section>
        </div>
      </div>
    </div>
  );
}
