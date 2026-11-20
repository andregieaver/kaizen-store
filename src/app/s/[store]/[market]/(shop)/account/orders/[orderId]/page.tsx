import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Suspense } from "react";
import { z } from "zod";

import { BackorderOrderLine } from "@/components/backorder-note";
import { DeliveryBlock } from "@/components/delivery-block";
import { GiftNote } from "@/components/gift-note";
import { OrderDocuments } from "@/components/documents/order-documents";
import { OrderShipments } from "@/components/order-shipments";
import { OrderTotals } from "@/components/order-totals";
import { LineUnitPrice } from "@/components/price";
import { OwnBookings } from "@/components/own-bookings";
import { OrderReturns } from "@/components/withdraw/order-returns";
import { accountTabHref } from "@/lib/account-tabs";
import { earnedText } from "@/lib/bonus-shopper";
import { bookingWhen, isRange } from "@/lib/booking-text";
import { fileSize } from "@/lib/file-size";
import { dateIn } from "@/lib/dates";
import { t } from "@/lib/i18n";
import { formatMoney } from "@/lib/money";
import { marketPath } from "@/lib/paths";
import { featureOn } from "@/lib/store-features";
import { getCustomer, ownsOrder } from "@/server/customers";
import { shopperFulfilment } from "@/server/fulfilment";
import { parcelTrackingFor } from "@/server/shipment-tracking";
import { getOrderDocuments } from "@/server/invoices";
import { getOrderAdmin } from "@/server/order-admin";
import { getOrderDownloads } from "@/server/orders";
import { listOrderReturns } from "@/server/returns";
import { reviewableLines } from "@/server/reviews";
import { resolveAfterSaleShop } from "@/server/shop";
import { getSubscriptionForOrder } from "@/server/subscriptions";

type Props = PageProps<"/s/[store]/[market]/account/orders/[orderId]">;

export const metadata: Metadata = { robots: { index: false, follow: false } };

/** One of the customer's orders in My account (D28): what it held, where it is, and its downloads. */
export default function AccountOrderPage({ params }: Props) {
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Suspense fallback={<div className="h-64 animate-pulse rounded-lg bg-surface" />}>
        <AccountOrder params={params} />
      </Suspense>
    </div>
  );
}

async function AccountOrder({ params }: { params: Props["params"] }) {
  const { store: storeSlug, market: marketSlug, orderId } = await params;
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) notFound();
  const { store, market } = shop;
  const base = marketPath(store.slug, market.slug);
  const customer = await getCustomer(store.id);
  if (!customer) redirect(`${base}/account`);
  if (!z.uuid().safeParse(orderId).success || !(await ownsOrder(store.id, customer.id, orderId))) notFound();
  const [order, downloads, subscription, returns, documents, fulfilment, tracking] = await Promise.all([
    getOrderAdmin(store.id, orderId),
    getOrderDownloads(store.id, orderId),
    getSubscriptionForOrder(store.id, orderId),
    // The order is the signed-in customer's own (checked above): its withdrawals and returns (D153).
    listOrderReturns(store.id, orderId),
    // Its invoice and credit notes (D159), found by the order's own id: the customer's ownership was checked above.
    getOrderDocuments(store.id, orderId),
    // Its parcels, each with its lines, and what is still to come (D174): the customer's ownership was checked above.
    shopperFulfilment(store.id, orderId),
    // Where each parcel is (D238 2.7): the events the poll stored, never a carrier call while the page renders.
    parcelTrackingFor(store.id, orderId),
  ]);
  if (!order) notFound();
  // What of this order the customer may review now (D301 9.2): the lines it is the newest receipt of a product on.
  const reviewable = featureOn(store, "reviews") ? new Set((await reviewableLines(store.id, customer.id)).filter((l) => l.orderId === orderId).map((l) => l.lineId)) : new Set<string>();
  // An exchange order (D239) names its return and the original order; the original is linked only when it is this customer's own too.
  const exchangeOriginal = order.exchange && (await ownsOrder(store.id, customer.id, order.exchange.originalOrderId)) ? order.exchange.originalOrderId : null;
  const m = t(market.lang);
  const a = m.account;
  const money = (minor: number) => formatMoney(minor, order.currency, market.locale, market.priceStyle);
  const date = (iso: string) => dateIn(store, iso, "long", market.locale);
  const address = order.shippingAddress;
  // Bonus credits (D130): what this order earned and from when they can be used.
  const earned = earnedText(order.bonus, {
    money,
    date,
    line: m.bonus.earnedLine,
    ready: m.bonus.earnedNow,
  });

  return (
    <>
      <Link href={accountTabHref(`${base}/account`, "orders")} className="text-sm underline">
        {a.backToAccount}
      </Link>
      <div>
        <h1 className="text-3xl font-heading tracking-tight">{a.order(order.number)}</h1>
        <p className="text-muted">
          {date(order.placedAt)} · {a.status[order.status] ?? order.status}
        </p>
        {order.exchange && (
          <p data-exchange-order>
            {exchangeOriginal ? (
              <Link href={`${base}/account/orders/${exchangeOriginal}`} className="underline">
                {m.exchange.orderLine(order.exchange.returnNumber, order.exchange.originalOrderNumber)}
              </Link>
            ) : (
              m.exchange.orderLine(order.exchange.returnNumber, order.exchange.originalOrderNumber)
            )}
          </p>
        )}
      </div>

      {/* The store's own delivery (D237): where to collect it, or the local delivery and the note. */}
      <DeliveryBlock order={order} m={m} locale={market.locale} timeZone={store.timeZone} />
      {/* The parcels and what is still to come (D174); nothing before the first parcel. A pickup order is collected, not sent. */}
      {order.deliveryMethod !== "pickup" && (
        <OrderShipments
          fulfilment={fulfilment}
          tracking={tracking}
          m={m}
          locale={market.locale}
          timeZone={store.timeZone}
          business={order.company !== null}
        />
      )}

      <OwnBookings order={order} store={store.slug} market={market} m={m} sessionId={null} />

      <section aria-label={m.orderSummary} className="rounded-lg border border-border p-4">
        <ul className="divide-y divide-border">
          {order.lines.map((line) => (
            <li key={line.id} className="flex justify-between gap-4 py-2">
              <span>
                {isRange(line.booking) ? line.title : `${line.quantity} × ${line.title}`}
                {line.delivery === "digital" && line.variantId && <span className="block text-sm text-muted">{m.digitalDelivery}</span>}
                {line.booking && (
                  <span className="block text-sm">
                    {bookingWhen(line.booking, market.locale, m)}
                  </span>
                )}
                {/* What it was sold with (D160), from the order line. */}
                <LineUnitPrice
                  shownMinor={line.unitPriceMinor}
                  measure={line.measure}
                  gift={line.gift}
                  currency={order.currency}
                  locale={market.locale}
                  decimals={market.priceStyle?.decimals}
                  m={m}
                />
                <BackorderOrderLine backorder={line.backorder} quantity={line.quantity} m={m} locale={market.locale} />
                {reviewable.has(line.id) && (
                  <Link href={`${base}/account/reviews/${line.id}`} className="block text-sm underline underline-offset-2">
                    {m.reviews.write}
                  </Link>
                )}
              </span>
              <span className="whitespace-nowrap">
                {line.gift ? (
                  <>
                    <span className="text-muted line-through">{money(line.unitPriceMinor * line.quantity)}</span> {m.freeGift}
                  </>
                ) : (
                  money(line.unitPriceMinor * line.quantity)
                )}
              </span>
            </li>
          ))}
        </ul>
        {/* The buyer's own gift message (D173). */}
        <GiftNote gift={order.gift} m={m} />
        <OrderTotals
          order={order}
          m={m}
          lang={market.lang}
          timeZone={store.timeZone}
          money={money}
          className="mt-3 flex flex-col gap-1 border-t border-border pt-3"
          balanceAtVenue
          refundedLabel={a.refunded}
        />
        {earned && <p className="mt-3 text-sm">{earned}</p>}
      </section>

      <OrderDocuments
        lang={market.lang}
        locale={market.locale}
        base={base}
        invoice={documents.invoice}
        creditNotes={documents.creditNotes}
        testOrder={!documents.invoice && documents.eligibility === "test_mode"}
      />

      <OrderReturns m={m.returns} base={base} order={order} orderKey={null} returns={returns} />

      {downloads.length > 0 && (
        <section aria-labelledby="downloads-heading" className="rounded-lg border border-border p-4">
          <h2 id="downloads-heading" className="mb-2 font-medium">{m.downloads}</h2>
          <ul className="divide-y divide-border">
            {downloads.map((file) => (
              <li key={file.token} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <span>
                  <span className="font-medium">{file.name}</span>
                  <span className="block text-sm text-muted">
                    {[fileSize(file.sizeBytes), !file.gone && file.left !== null && m.downloadsLeft(file.left)]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                {file.gone ? (
                  <span className="max-w-sm text-sm">{m.downloadGone}</span>
                ) : (
                  <a
                    href={`${base}/download/${file.token}`}
                    className="inline-flex min-h-11 items-center button-primary px-5 text-sm font-medium"
                  >
                    {m.download}
                    <span className="sr-only">: {file.name}</span>
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {subscription && subscription.status !== "pending" && subscription.status !== "expired" && (
        <section className="rounded-lg border border-border p-4">
          <h2 className="mb-1 font-medium">{m.subscription}</h2>
          <p>
            {m.planEvery(subscription.interval, subscription.intervalCount)} · {m.subscriptionStatus[subscription.status]}
          </p>
          <Link href={`${base}/subscription/${subscription.manageToken}`} className="mt-2 inline-block underline">
            {m.manageSubscription}
          </Link>
        </section>
      )}

      {order.ships && address.line1 && (
        <section>
          <h2 className="mb-1 font-medium">{m.deliverTo}</h2>
          <address className="not-italic">
            {[address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`]
              .filter((part) => part && part.trim())
              .map((part) => (
                <span key={part} className="block">
                  {part}
                </span>
              ))}
          </address>
        </section>
      )}
    </>
  );
}
