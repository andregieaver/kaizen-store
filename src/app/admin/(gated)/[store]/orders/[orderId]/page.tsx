import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { formatMoney } from "@/lib/money";
import { ORDER_STATUS_LABELS as STATUS_LABELS } from "@/lib/order-status";
import { requireMember } from "@/server/auth";
import { getOrder, getOrderDownloads, getOrderEvents, type Address } from "@/server/orders";


export const metadata: Metadata = { title: "Order" };

const EVENT_LABELS: Record<string, string> = {
  "order.placed": "Checkout started",
  "order.paid": "Paid",
  "order.cancelled": "Checkout not completed",
  "stock.short": "Not enough stock for everything paid for",
};

export default async function OrderPage({ params }: PageProps<"/admin/[store]/orders/[orderId]">) {
  const { store: slug, orderId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(orderId).success) notFound();
  const [order, events, downloads] = await Promise.all([
    getOrder(store.id, orderId),
    getOrderEvents(store.id, orderId),
    getOrderDownloads(store.id, orderId),
  ]);
  if (!order) notFound();
  const locale = store.markets[0]?.locale ?? order.locale;
  const money = (minor: number) => formatMoney(minor, order.currency, locale);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/orders`} className="text-sm underline">
          Orders
        </Link>
        <h1 className="text-2xl font-semibold">Order #{order.number}</h1>
        <p className="text-sm text-muted">
          {STATUS_LABELS[order.status]} · placed {when(order.placedAt)} · {order.marketCode}
        </p>
      </div>
      {events.some((e) => e.type === "stock.short") && (
        <p role="alert" className="rounded-md border border-red-700 bg-background p-3 text-sm dark:border-red-400">
          Some items were paid for after their stock ran out. Contact the customer before sending.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[1fr_18rem]">
        <section aria-labelledby="items" className="rounded-lg border border-border bg-background p-5">
          <h2 id="items" className="mb-3 font-medium">Items</h2>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="py-2 font-medium">Product</th>
                <th scope="col" className="py-2 font-medium">SKU</th>
                <th scope="col" className="py-2 text-right font-medium">Qty</th>
                <th scope="col" className="py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {order.lines.map((line) => (
                <tr key={line.sku} className="border-b border-border">
                  <td className="py-2">
                    {line.title}
                    {line.delivery === "digital" && <span className="block text-xs text-muted">Digital download</span>}
                  </td>
                  <td className="py-2 font-mono text-xs">{line.sku}</td>
                  <td className="py-2 text-right">{line.quantity}</td>
                  <td className="py-2 text-right">{money(line.totalMinor)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <dl className="mt-3 flex flex-col gap-1 text-sm">
            <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotalMinor)}</dd></div>
            {order.ships && (
              <div className="flex justify-between"><dt>Shipping</dt><dd>{money(order.shippingMinor)}</dd></div>
            )}
            <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(order.totalMinor)}</dd></div>
            <div className="flex justify-between text-muted"><dt>VAT included (standard rate)</dt><dd>{money(order.taxMinor)}</dd></div>
          </dl>
        </section>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="customer" className="rounded-lg border border-border bg-background p-5 text-sm">
            <h2 id="customer" className="mb-2 font-medium">Customer</h2>
            {order.email ? (
              <a href={`mailto:${order.email}`} className="underline">{order.email}</a>
            ) : (
              <p className="text-muted">Not known until payment.</p>
            )}
            {order.billingAddress.phone && <p>{order.billingAddress.phone}</p>}
            {order.ships && (
              <>
                <h3 className="mt-3 mb-1 font-medium">Ship to</h3>
                <AddressBlock address={order.shippingAddress} />
              </>
            )}
          </section>
          {order.digitalConsentAt && (
            <section aria-labelledby="downloads" className="rounded-lg border border-border bg-background p-5 text-sm">
              <h2 id="downloads" className="mb-2 font-medium">Downloads</h2>
              <p className="mb-2 text-muted">
                The customer agreed to immediate delivery and the loss of the right of withdrawal on{" "}
                {when(order.digitalConsentAt)}.
              </p>
              {downloads.length === 0 ? (
                <p className="text-muted">Download links are made when the order is paid.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {downloads.map((file) => (
                    <li key={file.token}>
                      {file.name}:{" "}
                      <span className="text-muted">
                        {file.used === 0 ? "not downloaded yet" : `downloaded ${file.used}×`}
                        {file.left !== null && `, ${file.left} left`}
                        {file.gone && " (link no longer works)"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}
          <section aria-labelledby="history" className="rounded-lg border border-border bg-background p-5 text-sm">
            <h2 id="history" className="mb-2 font-medium">History</h2>
            <ol className="flex flex-col gap-1">
              {events.map((event, index) => (
                <li key={index}>
                  <time dateTime={event.createdAt} className="text-muted">{when(event.createdAt)}</time>{" "}
                  {EVENT_LABELS[event.type] ?? event.type}
                </li>
              ))}
            </ol>
          </section>
        </div>
      </div>
    </div>
  );
}

function AddressBlock({ address }: { address: Address }) {
  const parts = [address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`.trim(), address.country];
  const lines = parts.filter((p): p is string => Boolean(p && p.trim()));
  if (lines.length === 0) return <p className="text-muted">Not known until payment.</p>;
  return (
    <address className="not-italic">
      {lines.map((line) => (
        <span key={line} className="block">{line}</span>
      ))}
    </address>
  );
}
