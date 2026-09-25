import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { accountLabel, moneyByCurrency } from "@/components/admin/customer-bar";
import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS } from "@/lib/order-status";
import { planSummary, SUBSCRIPTION_STATUS_LABELS } from "@/lib/subscriptions";
import { requireMember } from "@/server/auth";
import { findCustomer, getCustomerDetail } from "@/server/customer-admin";
import { listEmails } from "@/server/email";

export const metadata: Metadata = { title: "Customer" };

const card = "rounded-lg border border-border bg-background p-5";

/**
 * One customer (D35): who they are and how to reach them, every order and
 * subscription they have, and the emails they got; each links to its own
 * page, which links back here.
 */
export default async function CustomerPage({ params }: PageProps<"/admin/[store]/customers/[customerId]">) {
  const { store: slug, customerId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(customerId).success) notFound();
  const ref = await findCustomer(store.id, customerId);
  if (!ref) notFound();
  // An order's or subscription's id finds its customer; the page lives at the customer's own address.
  if (ref.key !== customerId) redirect(`/admin/${store.slug}/customers/${ref.key}`);
  const [customer, emails] = await Promise.all([getCustomerDetail(store.id, ref), listEmails({ storeId: store.id, to: ref.email, limit: 20 })]);
  if (!customer) notFound();
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const date = (iso: string) => new Date(iso).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" });
  const base = `/admin/${store.slug}`;
  const spent = moneyByCurrency(customer.spentMinor, locale);
  const averageMinor = Object.fromEntries(
    Object.entries(customer.spentMinor).map(([currency, total]) => {
      const count = customer.orderList.filter((o) => o.currency === currency && o.status !== "cancelled").length;
      return [currency, count > 0 ? Math.round(Number(total) / count) : 0];
    }),
  );
  const address = customer.address;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`${base}/customers`} className="text-sm underline">
          Customers
        </Link>
        <h1 className="text-2xl font-semibold">{customer.name || customer.email}</h1>
        <p className="text-sm text-muted">
          {accountLabel(customer.account)}
          {customer.firstOrderAt && ` · first order ${date(customer.firstOrderAt)}`}
          {customer.accountCreatedAt && ` · account since ${date(customer.accountCreatedAt)}`}
          {customer.lastSignInAt && ` · last signed in ${date(customer.lastSignInAt)}`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          ["Orders", String(customer.orders)],
          ["Spent", spent || "–"],
          ["Average order", moneyByCurrency(averageMinor, locale) || "–"],
          ["Active subscriptions", String(customer.liveSubscriptions)],
        ].map(([label, value]) => (
          <div key={label} className="flex flex-col gap-1 rounded-lg border border-border bg-background p-4">
            <span className="text-sm text-muted">{label}</span>
            <span className="text-xl font-semibold">{value}</span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="orders" className={card}>
            <h2 id="orders" className="mb-3 font-medium">Orders</h2>
            {customer.orderList.length === 0 ? (
              <p className="text-sm text-muted">No orders yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-border">
                      <th scope="col" className="py-2 pr-4 font-medium">Order</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Placed</th>
                      <th scope="col" className="py-2 pr-4 font-medium">Status</th>
                      <th scope="col" className="py-2 text-right font-medium">Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {customer.orderList.map((order) => (
                      <tr key={order.id} className="border-b border-border last:border-0">
                        <td className="py-2 pr-4">
                          <Link href={`${base}/orders/${order.id}`} className="font-medium underline">
                            #{order.number}
                          </Link>
                          <span className="block text-xs text-muted">
                            {order.items === 1 ? "1 item" : `${order.items} items`}
                            {order.subscriptionId && (
                              <>
                                {" · "}
                                <Link href={`${base}/subscriptions/${order.subscriptionId}`} className="underline">
                                  subscription
                                </Link>
                              </>
                            )}
                          </span>
                        </td>
                        <td className="py-2 pr-4 whitespace-nowrap">{date(order.placedAt)}</td>
                        <td className="py-2 pr-4">
                          {order.status === "cancelled" ? "Cancelled and refunded" : ORDER_STATUS_LABELS[order.status]}
                          {order.refunded && order.status !== "cancelled" && <span className="block text-xs text-muted">Refunded in part</span>}
                        </td>
                        <td className="py-2 text-right whitespace-nowrap">{formatMoney(order.totalMinor, order.currency, locale)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <section aria-labelledby="subscriptions" className={card}>
            <h2 id="subscriptions" className="mb-3 font-medium">Subscriptions</h2>
            {customer.subscriptionList.length === 0 ? (
              <p className="text-sm text-muted">No subscriptions.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {customer.subscriptionList.map((s) => (
                  <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                    <span>
                      <Link href={`${base}/subscriptions/${s.id}`} className="font-medium underline">
                        Subscription #{s.number}
                      </Link>
                      <span className="block text-xs text-muted">
                        {SUBSCRIPTION_STATUS_LABELS[s.status]} ·{" "}
                        {planSummary({ interval: s.interval as "month", intervalCount: s.intervalCount, discountPercent: 0 })} ·{" "}
                        {s.orders === 1 ? "1 order" : `${s.orders} orders`}
                        {s.currentPeriodEnd && ["active", "past_due"].includes(s.status) && ` · renews ${date(s.currentPeriodEnd)}`}
                      </span>
                    </span>
                    <span className="whitespace-nowrap">{formatMoney(s.totalMinor, s.currency, locale)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="emails" className={card}>
            <h2 id="emails" className="mb-3 font-medium">Emails</h2>
            {emails.length === 0 ? (
              <p className="text-sm text-muted">No emails yet.</p>
            ) : (
              <ul className="divide-y divide-border text-sm">
                {emails.map((email) => (
                  <li key={email.id} className="flex flex-wrap justify-between gap-2 py-2">
                    <Link href={`${base}/emails/${email.id}`} className="underline">
                      {email.subject}
                    </Link>
                    <span className="text-muted">{date(email.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="contact" className={`${card} text-sm`}>
            <h2 id="contact" className="mb-2 font-medium">Contact</h2>
            <a href={`mailto:${customer.email}`} className="break-all underline">
              {customer.email}
            </a>
            {customer.phone && (
              <p>
                <a href={`tel:${customer.phone}`} className="underline">
                  {customer.phone}
                </a>
              </p>
            )}
            {address && (
              <>
                <h3 className="mt-3 mb-1 font-medium">Address</h3>
                <address className="not-italic">
                  {[address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`, address.country]
                    .filter((part) => part && String(part).trim())
                    .map((part) => (
                      <span key={String(part)} className="block">
                        {part}
                      </span>
                    ))}
                </address>
              </>
            )}
          </section>
          <section aria-labelledby="more" className={`${card} text-sm`}>
            <h2 id="more" className="mb-2 font-medium">Account and preferences</h2>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              <dt className="text-muted">Account</dt>
              <dd>{accountLabel(customer.account)}</dd>
              <dt className="text-muted">Wishlist</dt>
              <dd>{customer.account ? (customer.wishlistItems === 1 ? "1 item" : `${customer.wishlistItems} items`) : "–"}</dd>
              <dt className="text-muted">Cart reminders</dt>
              <dd>{customer.cartRemindersOptedOut ? "Said no" : "Allowed"}</dd>
            </dl>
          </section>
        </div>
      </div>
    </div>
  );
}
