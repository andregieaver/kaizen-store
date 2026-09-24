import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { z } from "zod";

import {
  CancelForm,
  ContactForm,
  NoteForm,
  RefundForm,
  ResendButton,
  SendForm,
} from "@/components/admin/order-actions";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { ORDER_STATUS_LABELS as STATUS_LABELS } from "@/lib/order-status";
import { requireMember } from "@/server/auth";
import { listEmails } from "@/server/email";
import { CARRIERS, getOrderAdmin } from "@/server/order-admin";
import { getOrderDownloads, getOrderEvents, type Address, type OrderEvent } from "@/server/orders";

export const metadata: Metadata = { title: "Order" };

const EVENT_LABELS: Record<string, string> = {
  "order.placed": "Checkout started",
  "order.paid": "Paid",
  "order.cancelled": "Checkout not completed",
  "stock.short": "Not enough stock for everything paid for",
  "payment.started": "Payment opened",
  "order.sent": "Sent",
  "order.refunded": "Refunded",
  "order.restocked": "Put back in stock",
  "order.cancelled_by_staff": "Cancelled and refunded",
  "order.edited": "Customer details changed",
  "note.added": "Note",
  "subscription.renewed": "Subscription renewed",
  "subscription.cancel": "Subscription set to end with the period",
  "subscription.resume": "Subscription kept after all",
  "subscription.cancel_now": "Subscription cancelled",
};

const card = "rounded-lg border border-border bg-background p-5";

/**
 * Everything about one order and everything staff do with it (D27): what
 * was bought and paid, sending with tracking, refunds and restocking,
 * cancelling, the customer's details, notes, and the full history,
 * including every email the customer got.
 */
export default async function OrderPage({ params }: PageProps<"/admin/[store]/orders/[orderId]">) {
  const { store: slug, orderId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(orderId).success) notFound();
  const [order, events, downloads, emails] = await Promise.all([
    getOrderAdmin(store.id, orderId),
    getOrderEvents(store.id, orderId),
    getOrderDownloads(store.id, orderId),
    listEmails({ storeId: store.id, orderId }),
  ]);
  if (!order) notFound();
  const locale = store.markets[0]?.locale ?? order.locale;
  const money = (minor: number) => formatMoney(minor, order.currency, locale);
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const paid = order.status === "paid" || order.status === "fulfilled" || order.status === "closed";
  const cancelledAfterPayment = order.status === "cancelled" && order.paidMinor > 0;
  const restockable = order.lines
    .filter((l) => l.variantId && l.delivery === "physical" && l.quantity > l.restocked)
    .map((l) => ({ id: l.id, title: l.title, left: l.quantity - l.restocked }));
  const digits = minorUnitDigits(order.currency);
  const typedAmount = (minor: number) => (minor / 10 ** digits).toFixed(digits).replace(".", ",");
  const ids = { storeSlug: store.slug, orderId: order.id };
  const address = order.shippingAddress;

  // History: the order's events and its emails, newest first.
  const history: { at: string; node: ReactNode }[] = [
    ...events.map((event) => ({ at: event.createdAt, node: <EventLine event={event} money={money} /> })),
    ...emails.map((email) => ({
      at: email.createdAt,
      node: (
        <>
          Email:{" "}
          <Link href={`/admin/${store.slug}/emails/${email.id}`} className="underline">
            {email.subject}
          </Link>
          {email.status !== "sent" && (
            <span className="text-muted"> ({email.status === "logged" ? "not sent: email is not set up" : email.status})</span>
          )}
        </>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <Link href={`/admin/${store.slug}/orders`} className="text-sm underline">
            Orders
          </Link>
          <h1 className="text-2xl font-semibold">Order #{order.number}</h1>
          <p className="text-sm text-muted">
            {cancelledAfterPayment ? "Cancelled and refunded" : STATUS_LABELS[order.status]} · placed {when(order.placedAt)} ·{" "}
            {order.marketCode}
            {order.subscriptionId && (
              <>
                {" · "}
                <Link href={`/admin/${store.slug}/subscriptions/${order.subscriptionId}`} className="underline">
                  part of a subscription
                </Link>
              </>
            )}
          </p>
        </div>
        {paid && (
          <div className="flex flex-wrap items-center gap-2">
            {order.ships && (
              <Link
                href={`/admin/${store.slug}/orders/${order.id}/packing-slip`}
                target="_blank"
                className="inline-flex min-h-10 items-center rounded-md border border-border px-4 text-sm"
              >
                Packing slip
              </Link>
            )}
            {order.email && <ResendButton {...ids} />}
          </div>
        )}
      </div>
      {events.some((e) => e.type === "stock.short") && (
        <p role="alert" className="rounded-md border border-red-700 bg-background p-3 text-sm dark:border-red-400">
          Some items were paid for after their stock ran out. Contact the customer before sending.
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="items" className={card}>
            <h2 id="items" className="mb-3 font-medium">Items</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
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
                    <tr key={line.id} className="border-b border-border">
                      <td className="py-2">
                        {line.title}
                        {line.delivery === "digital" && line.variantId && <span className="block text-xs text-muted">Digital download</span>}
                        {line.restocked > 0 && <span className="block text-xs text-muted">{line.restocked} put back in stock</span>}
                      </td>
                      <td className="py-2 font-mono text-xs">{line.sku}</td>
                      <td className="py-2 text-right">{line.quantity}</td>
                      <td className="py-2 text-right">{money(line.unitPriceMinor * line.quantity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><dt>Subtotal</dt><dd>{money(order.subtotalMinor)}</dd></div>
              {order.ships && <div className="flex justify-between"><dt>Shipping</dt><dd>{money(order.shippingMinor)}</dd></div>}
              {order.discountMinor > 0 && (
                <div className="flex justify-between">
                  <dt>
                    Discount
                    {order.discountCode && (
                      <>
                        {" "}
                        <Link href={`/admin/${store.slug}/discounts`} className="font-mono text-xs underline">
                          {order.discountCode}
                        </Link>
                      </>
                    )}
                  </dt>
                  <dd>−{money(order.discountMinor)}</dd>
                </div>
              )}
              <div className="flex justify-between font-semibold"><dt>Total</dt><dd>{money(order.totalMinor)}</dd></div>
              <div className="flex justify-between text-muted"><dt>VAT included (standard rate)</dt><dd>{money(order.taxMinor)}</dd></div>
              {order.refundedMinor > 0 && (
                <>
                  <div className="flex justify-between border-t border-border pt-1"><dt>Refunded</dt><dd>−{money(order.refundedMinor)}</dd></div>
                  <div className="flex justify-between font-semibold"><dt>Kept</dt><dd>{money(order.paidMinor - order.refundedMinor)}</dd></div>
                </>
              )}
            </dl>
          </section>

          {paid && order.ships && (
            <section aria-labelledby="sending" className={card}>
              <h2 id="sending" className="mb-3 font-medium">{order.shipments.length > 0 ? "Sent" : "Send the order"}</h2>
              {order.shipments.length > 0 && (
                <ul className="mb-4 flex flex-col gap-1 text-sm">
                  {order.shipments.map((s) => (
                    <li key={s.id}>
                      {when(s.createdAt)}: {s.carrier || "Parcel"}{" "}
                      {s.trackingNumber && <span className="font-mono">{s.trackingNumber}</span>}{" "}
                      {s.trackingUrl && (
                        <a href={s.trackingUrl} target="_blank" rel="noreferrer" className="underline">
                          Track
                        </a>
                      )}
                    </li>
                  ))}
                </ul>
              )}
              {order.shipments.length > 0 ? (
                <details>
                  <summary className="cursor-pointer text-sm underline">Add another parcel</summary>
                  <div className="mt-3">
                    <SendForm {...ids} carriers={CARRIERS.map(({ id, name }) => ({ id, name }))} hasEmail={Boolean(order.email)} />
                  </div>
                </details>
              ) : (
                <SendForm {...ids} carriers={CARRIERS.map(({ id, name }) => ({ id, name }))} hasEmail={Boolean(order.email)} />
              )}
            </section>
          )}

          {(paid || cancelledAfterPayment) && (order.refundableMinor > 0 || restockable.length > 0) && (
            <section aria-labelledby="refund" className={card}>
              <h2 id="refund" className="mb-1 font-medium">Refund</h2>
              <p className="mb-3 text-sm text-muted">
                Paid {money(order.paidMinor)}
                {order.refundedMinor > 0 && `, refunded ${money(order.refundedMinor)}`}. Refunds go back to the
                customer&apos;s card or payment method through Stripe; Kaizen&apos;s fee on the refunded amount is
                returned to you.
              </p>
              <RefundForm
                {...ids}
                refundable={typedAmount(order.refundableMinor)}
                refundableLabel={money(order.refundableMinor)}
                lines={restockable}
                hasEmail={Boolean(order.email)}
                canRefund={order.canRefund && order.refundableMinor > 0}
              />
              {order.refunds.length > 0 && (
                <ul className="mt-4 flex flex-col gap-1 border-t border-border pt-3 text-sm">
                  {order.refunds.map((r) => (
                    <li key={r.id}>
                      {when(r.createdAt)}: {money(r.amountMinor)} · {r.reason}
                      {r.status !== "succeeded" && <span className="text-muted"> ({r.status})</span>}
                      {r.by && <span className="text-muted"> · {r.by}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {order.status === "paid" && (
            <section aria-labelledby="cancel" className={card}>
              <h2 id="cancel" className="mb-1 font-medium">Cancel the order</h2>
              {order.subscriptionId && (
                <p className="mb-2 text-sm text-muted">
                  This cancels this order only. The subscription goes on unless you also cancel it on its page.
                </p>
              )}
              <CancelForm {...ids} amountLabel={money(order.refundableMinor)} hasEmail={Boolean(order.email)} />
            </section>
          )}

          <section aria-labelledby="history" className={card}>
            <h2 id="history" className="mb-3 font-medium">History</h2>
            {order.status !== "pending_payment" && (
              <div className="mb-4">
                <NoteForm {...ids} />
              </div>
            )}
            <ol className="flex flex-col gap-2 text-sm">
              {history.map((item, index) => (
                <li key={index} className="flex flex-col sm:flex-row sm:gap-3">
                  <time dateTime={item.at} className="shrink-0 text-muted sm:w-40">{when(item.at)}</time>
                  <span className="min-w-0">{item.node}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex flex-col gap-6">
          <section aria-labelledby="customer" className={`${card} text-sm`}>
            <h2 id="customer" className="mb-2 font-medium">Customer</h2>
            {order.email ? (
              <a href={`mailto:${order.email}`} className="break-all underline">{order.email}</a>
            ) : (
              <p className="text-muted">Not known until payment.</p>
            )}
            {(address.phone || order.billingAddress.phone) && <p>{address.phone || order.billingAddress.phone}</p>}
            {order.ships && (
              <>
                <h3 className="mt-3 mb-1 font-medium">Ship to</h3>
                <AddressBlock address={address} />
              </>
            )}
            {order.status !== "pending_payment" && (
              <details className="mt-3">
                <summary className="cursor-pointer underline">Change email or address</summary>
                <div className="mt-3">
                  <ContactForm
                    {...ids}
                    values={{
                      email: order.email,
                      name: address.name ?? "",
                      line1: address.line1 ?? "",
                      line2: address.line2 ?? "",
                      postalCode: address.postalCode ?? "",
                      city: address.city ?? "",
                      phone: address.phone ?? "",
                    }}
                  />
                </div>
              </details>
            )}
          </section>
          {order.digitalConsentAt && (
            <section aria-labelledby="downloads" className={`${card} text-sm`}>
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
        </div>
      </div>
    </div>
  );
}

function EventLine({ event, money }: { event: OrderEvent; money: (minor: number) => string }) {
  const label = EVENT_LABELS[event.type] ?? event.type;
  const data = event.data as Record<string, unknown>;
  if (event.type === "note.added") {
    return (
      <>
        <span className="font-medium">Note</span> by {String(data.by ?? "staff")}:{" "}
        <span className="whitespace-pre-wrap">{String(data.note ?? "")}</span>
      </>
    );
  }
  if (event.type === "order.refunded" || event.type === "order.restocked") {
    const restocked = (data.restocked as { sku: string; quantity: number }[] | undefined) ?? [];
    return (
      <>
        {label}
        {Number(data.amount) > 0 && ` ${money(Number(data.amount))}`}
        {data.reason ? ` · ${String(data.reason)}` : ""}
        {restocked.length > 0 && ` · back in stock: ${restocked.map((r) => `${r.quantity} × ${r.sku}`).join(", ")}`}
      </>
    );
  }
  if (event.type === "order.sent") {
    return (
      <>
        {label}
        {data.carrier ? ` with ${String(data.carrier)}` : ""}
        {data.tracking ? ` (${String(data.tracking)})` : ""}
      </>
    );
  }
  return <>{label}</>;
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
