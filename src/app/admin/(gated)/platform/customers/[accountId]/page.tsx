import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";

import { InvoiceList } from "@/components/admin/plan-invoices";
import { SUBSCRIPTION_LABELS } from "@/lib/plans";
import { listStoreInvoices } from "@/server/billing";
import { listEmails } from "@/server/email";
import { getPlatformCustomer } from "@/server/platform-customers";
import { getStore } from "@/server/stores";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Customer" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * One of Kaizen's customers (D35): their stores, each store's plan (the
 * subscription) and invoices (the orders), unpaid plans, and the emails
 * Kaizen sent them; each links to its own page, which links back here.
 */
export default async function PlatformCustomerPage({ params }: PageProps<"/admin/platform/customers/[accountId]">) {
  await connection();
  await requirePlatformAdmin();
  const { accountId } = await params;
  if (!z.uuid().safeParse(accountId).success) notFound();
  const customer = await getPlatformCustomer(accountId);
  if (!customer) notFound();
  // Invoices go to the store's owners; staff see the store without them.
  const owned = customer.stores.filter((s) => s.role === "owner");
  const [invoices, emails] = await Promise.all([
    Promise.all(
      owned.map(async (s) => {
        const store = await getStore(s.slug);
        return { store: s, invoices: store ? await listStoreInvoices(store.id, 6) : null };
      }),
    ),
    listEmails({ storeId: null, to: customer.email, limit: 20 }),
  ]);
  const date = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const kaizenEmails = emails.filter((e) => e.storeName === null);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/platform/customers" className="text-sm underline">
          Customers
        </Link>
        <h1 className="text-2xl font-semibold">{customer.name || customer.email}</h1>
        <p className="text-sm text-muted">
          <a href={`mailto:${customer.email}`} className="underline">
            {customer.email}
          </a>{" "}
          · since {date(customer.createdAt)}
          {customer.platformAdmin && " · platform admin"}
          {customer.disabled && " · disabled"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {[
          ["Stores", String(customer.stores.length)],
          ["On a plan", String(customer.onPlan)],
          ["Plan reminders", customer.planRemindersOptedOut ? "Said no" : "Allowed"],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4">
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-semibold">{value}</span>
          </div>
        ))}
      </div>

      <section aria-labelledby="stores" className={card}>
        <h2 id="stores" className="mb-3 font-medium">Stores and plans</h2>
        {customer.stores.length === 0 ? (
          <p className="text-sm text-muted">Works in no store.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th scope="col" className="py-2 pr-4 font-medium">Store</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Role</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Plan</th>
                  <th scope="col" className="py-2 font-medium">Next invoice</th>
                </tr>
              </thead>
              <tbody>
                {customer.stores.map((s) => (
                  <tr key={s.slug} className="border-b border-border last:border-0">
                    <td className="py-2 pr-4">
                      <Link href={`/admin/platform/stores/${s.slug}`} className="font-medium underline">
                        {s.name}
                      </Link>
                      <span className="block text-xs text-muted">
                        <Link href={`/admin/${s.slug}`} className="underline">
                          Store admin
                        </Link>
                      </span>
                    </td>
                    <td className="py-2 pr-4 capitalize">{s.role}</td>
                    <td className="py-2 pr-4">
                      {s.planName && s.status ? (
                        <>
                          {s.planName}
                          <span className="block text-xs text-muted">
                            {SUBSCRIPTION_LABELS[s.status] ?? s.status}
                            {s.cancelAtPeriodEnd && " · ends with the period"}
                            {s.mode === "test" && " · test mode"}
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">No plan</span>
                      )}
                    </td>
                    <td className="py-2">
                      {s.currentPeriodEnd && s.status !== "canceled" ? date(s.currentPeriodEnd) : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="invoices" className={card}>
        <h2 id="invoices" className="mb-3 font-medium">Invoices</h2>
        {owned.length === 0 ? (
          <p className="text-sm text-muted">Owns no store, so gets no invoices.</p>
        ) : (
          <div className="flex flex-col gap-4">
            {invoices.map(({ store, invoices: list }) => (
              <div key={store.slug}>
                {owned.length > 1 && <h3 className="mb-1 text-sm font-medium">{store.name}</h3>}
                <InvoiceList storeSlug={store.slug} invoices={list} date={date} />
              </div>
            ))}
          </div>
        )}
      </section>

      {customer.unpaidPlans.length > 0 && (
        <section aria-labelledby="unpaid" className={card}>
          <h2 id="unpaid" className="mb-3 font-medium">Went to pay for a plan</h2>
          <ul className="divide-y divide-border text-sm">
            {customer.unpaidPlans.map((u) => (
              <li key={`${u.storeSlug}-${u.capturedAt}`} className="flex flex-wrap justify-between gap-2 py-2">
                <span>
                  {u.planName} for{" "}
                  <Link href={`/admin/platform/stores/${u.storeSlug}`} className="underline">
                    {u.storeName}
                  </Link>
                </span>
                <span className="text-muted">
                  {date(u.capturedAt)} · {u.recovered ? "paid" : "not paid"} · {u.remindersSent} reminders
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="emails" className={card}>
        <h2 id="emails" className="mb-3 font-medium">Emails from Kaizen</h2>
        {kaizenEmails.length === 0 ? (
          <p className="text-sm text-muted">No emails yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {kaizenEmails.map((email) => (
              <li key={email.id} className="flex flex-wrap justify-between gap-2 py-2">
                <Link href={`/admin/platform/emails/${email.id}`} className="underline">
                  {email.subject}
                </Link>
                <span className="text-muted">{date(email.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
