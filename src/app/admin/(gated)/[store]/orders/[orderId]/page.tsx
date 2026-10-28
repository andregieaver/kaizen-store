import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { z } from "zod";

import {
  BalanceForm,
  TermsPaidForm,
  CancelForm,
  ContactForm,
  NoteForm,
  RefundForm,
  ResendButton,
} from "@/components/admin/order-actions";
import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { OrderAttributionCard, ReferralDiscountRow } from "@/components/admin/order-affiliate";
import { GiftCard } from "@/components/admin/orders/gift-card";
import { OrderEditCard } from "@/components/admin/orders/order-edit-card";
import { SendParcelForm } from "@/components/admin/orders/send-parcel";
import { ShipmentList } from "@/components/admin/orders/shipment-list";
import { LocalDeliveryPanel, PickupPanel } from "@/components/admin/orders/handover-panel";
import { ArchiveButton, TagsCard } from "@/components/admin/orders/order-ops";
import { BonusEarnedRow, BonusRefundNote, BonusUsedRow } from "@/components/admin/order-bonus";
import { BringBooking } from "@/components/admin/bring-booking";
import { ChosenDeliveryBooking } from "@/components/admin/chosen-delivery-booking";
import { sendDocumentAgainAction } from "../../invoices/actions";
import { helthjemBookAction } from "../helthjem-actions";
import { porterbuddyBookAction } from "../porterbuddy-actions";
import { answerText } from "@/lib/checkout-rules";
import { pickupPointLine } from "@/lib/delivery-options";
import { formatWindow } from "@/lib/porterbuddy";
import { CustomerBar, storeCustomerBar } from "@/components/admin/customer-bar";
import { DocumentsCard } from "@/components/admin/invoices/documents-card";
import { OrderReturnsCard } from "@/components/admin/returns/order-returns-card";
import { OrderTermsCard } from "@/components/admin/order-terms-card";
import { OrderPrivacyBanner } from "@/components/admin/privacy/order-banner";
import { StaffFieldsSection } from "@/components/admin/staff-fields-section";
import { VatReliefRow, VatTreatmentPanel } from "@/components/admin/vat-treatment-panel";
import { bookingWhen } from "@/lib/booking-text";
import { putBackWords, takenFromWords } from "@/lib/inventory-admin";
import { percentText } from "@/lib/customer-tiers";
import { t } from "@/lib/i18n";
import { formatMoney, minorUnitDigits } from "@/lib/money";
import { archiveBlock } from "@/lib/order-archive";
import { fulfilmentEventText } from "@/lib/fulfilment-events-text";
import { opsEventText } from "@/lib/order-ops-events-text";
import { disputeEventText, dueWords } from "@/lib/payment-facts";
import { PaymentCard } from "@/components/admin/orders/payment-card";
import { CaptureCard } from "@/components/admin/orders/capture-card";
import { captureEventText } from "@/lib/capture";
import { orderPaymentFacts } from "@/server/payment-disputes";
import { orderCapture } from "@/server/payment-capture";
import { captureOrderAction, releaseCardAction } from "../capture-actions";
import { isReturnEvent, eventSentence } from "@/lib/return-admin";
import { marketPath, storeHref } from "@/lib/paths";
import { formatDeliveryDate } from "@/lib/standing-orders";
import { orderAttribution } from "@/server/affiliates";
import { db } from "@/db/client";
import { listLocations } from "@/server/inventory-locations";
import { memberCan, requirePermission } from "@/server/permissions";
import { orderStockHistory } from "@/server/stock-restock";
import { componentsText } from "@/lib/bundles";
import { estimateWeightGrams } from "@/server/bring-shipping";
import { notificationPath } from "@/lib/notifications";
import { trackedCarrier } from "@/server/carrier-tracking";
import { deliverySourceOf } from "@/server/delivery-source";
import { notificationStates } from "@/server/notifications";
import { orderHold } from "@/server/order-hold";
import { parcelTrackingFor } from "@/server/shipment-tracking";
import { HoldPanel } from "@/components/admin/orders/hold-panel";
import { ParcelStatus } from "@/components/admin/orders/parcel-status";
import { customerSummary } from "@/server/customer-admin";
import { listEmails } from "@/server/email";
import { getOrderDocuments } from "@/server/invoices";
import { CARRIERS, getOrderAdmin, liveShipments } from "@/server/order-admin";
import { dayWords } from "@/lib/payment-terms";
import { orderReturnsOverview } from "@/server/order-returns";
import { exchangeOrdersOfReturns } from "@/server/exchange-admin";
import { orderPrivacy } from "@/server/privacy-pages";
import { getCarrier } from "@/server/shipping-carriers";
import { deliveryOfOrder } from "@/server/standing-orders";
import { getOrderDownloads, getOrderEvents, getOrderTreatment, type Address, type OrderEvent } from "@/server/orders";
import { archiveFactsFor } from "@/server/order-archive";
import { mayRecordOutsidePayment } from "@/server/order-settings";
import { tagSuggestions } from "@/server/order-tags";
import { listCartAdds } from "@/server/wishlist-admin";

import { orderEditability } from "@/server/order-edits";

import { resendShippedAction, saveOrderFieldsAction, sendOrderAction, undoShipmentAction } from "../actions";
import { cancelOrderEditAction, recordWaitingEditPaidOutsideAction, resendOrderEditAction } from "./edit/actions";
import { archiveOrderAction, changeTagsAction, unarchiveOrderAction } from "../ops-actions";
import { checkParcelNowAction, holdOrderAction, releaseHoldAction } from "../hold-actions";
import { markDeliveredAction, registerWithdrawalAction } from "../../returns/actions";
import { collectedAction, outForDeliveryAction, readyForPickupAction } from "../handover-actions";
import { todayIn } from "@/lib/work-dates";
import { PageHeader } from "@/components/admin/ui";
import { AdminTextScope } from "@/components/admin/admin-text";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import type { OrderMessages } from "@/lib/admin-messages/order.en";

export const metadata: Metadata = { title: "Order" };

const card = "rounded-lg border border-line bg-card p-5";

/**
 * Everything about one order and everything staff do with it (D27): what
 * was bought and paid, sending with tracking, refunds and restocking,
 * cancelling, the customer's details, notes, and the full history,
 * including every email the customer got.
 */
export default async function OrderPage({ params }: PageProps<"/admin/[store]/orders/[orderId]">) {
  const { store: slug, orderId } = await params;
  const member = await requirePermission(slug, "orders:read");
  // While the online shop is off (D178 step 5), what was sold stays reachable as long as an order can still be withdrawn from or returned.
  const shopOff = await requireShopOrAfterSale(member);
  if (shopOff) return shopOff;
  const { store } = member;
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "order");
  const w = words.page;
  const statuses = adminText(lang, "common").orderStatus;
  // The admin's own locale for the dates the page wrote in English (D312); money and times keep the store's.
  const adminLocale = ADMIN_LANG_FACTS[lang].locale;
  if (!z.uuid().safeParse(orderId).success) notFound();
  const [order, events, downloads, emails, customer, fromWishlists, weekly, attribution, returns, treatment, documents, privacy, archiveFacts, tagChoices] = await Promise.all([
    getOrderAdmin(store.id, orderId),
    getOrderEvents(store.id, orderId),
    getOrderDownloads(store.id, orderId),
    listEmails({ storeId: store.id, orderId }),
    customerSummary(store.id, orderId),
    listCartAdds(store.id, { orderId }),
    deliveryOfOrder(store.id, orderId),
    // Whose friend it is, when a referral link led to it (D131).
    orderAttribution(store.id, orderId),
    // The withdrawals and returns made on it, and where it stands in the 14 days (D153).
    orderReturnsOverview(store.id, orderId),
    // How VAT was charged and why (D157): staff see the whole of it, VIES's name and address included.
    getOrderTreatment(store.id, orderId),
    // Its invoice and credit notes, or why it has none (D159).
    getOrderDocuments(store.id, orderId),
    // Whether its personal data was restricted or made anonymous (D162).
    orderPrivacy(store.id, orderId),
    // What stops it being archived, in words (D173).
    archiveFactsFor(db(), store.id, [orderId]),
    // The store's tags in use, as suggestions.
    tagSuggestions(store.id),
  ]);
  // Whether its items can be changed now, and if not why, in words (D174 2.2: copied, unpaid, sent and the rest included).
  const editability = order ? await orderEditability(store.id, orderId) : null;
  if (!order) notFound();
  // The orders this order's returns were exchanged for (D239): "Exchanged: order {M}" on the Returns card.
  const exchangedFor = returns ? await exchangeOrdersOfReturns(store.id, returns.returns.map((r) => r.id)) : {};
  const canWrite = memberCan(member, "orders:write");
  // The hold, the parcels' stored tracking, the switches of the customer emails and who recorded the receipt (wave 3, D238): stored rows, no carrier call.
  const [hold, parcelTracking, notifyStates, receipt, paymentFacts, held] = await Promise.all([
    orderHold(store.id, orderId),
    parcelTrackingFor(store.id, orderId),
    notificationStates(store.id).catch(() => ({}) as Record<string, boolean>),
    deliverySourceOf(store.id, orderId),
    // How it was paid, Stripe's risk outcome and its disputes (D288): stored rows, no Stripe call.
    orderPaymentFacts(store.id, orderId),
    // A card held to be charged later (D289): what is held and until when.
    orderCapture(store.id, orderId),
  ]);
  const notificationsHref = `/admin/${store.slug}/settings/notifications`;
  // The *Notify the customer* box follows the email's switch (2.2): off, it is drawn off with a link there, and the sender ignores a `notify` anyway.
  const notifyOff = (id: string) => (notifyStates[id] === false ? `${notificationsHref}/${notificationPath(id)}` : null);
  const trackingOf = new Map(parcelTracking.map((t) => [t.shipmentId, t]));
  const archiveFacts1 = archiveFacts.get(orderId);
  const archiveBlocked = order.archivedAt || !archiveFacts1 ? null : archiveBlock(archiveFacts1);
  // Money taken outside Kaizen is refunded by being recorded: the owner, or staff when the owner allows it.
  const outsideAllowed = order.paidOutside ? await mayRecordOutsidePayment(member) : true;
  // Recording money taken outside Kaizen for a change (D174, D173's rule): the owner, or staff when the owner allows it.
  const mayRecordOutside = canWrite ? await mayRecordOutsidePayment(member) : false;
  const fulfilment = order.fulfilment;
  // The parcels that stand: an undone one (D174 follow-up) stays listed for the history and counts nowhere.
  const sentParcels = liveShipments(order.shipments).length;
  const awaitingEdit = order.edits.find((e) => e.status === "awaiting_payment") ?? null;
  const parcelRows = fulfilment.lines
    .filter((l) => l.physical)
    .map((l) => ({ lineId: l.lineId, title: l.title, sku: l.sku, ordered: l.quantity, sent: l.shipped, withdrawn: l.withdrawn, toSend: l.toSend, closed: l.closed, backordered: Math.min(l.backordered, l.toSend), backorderDays: l.backorderDays }));
  // A carrier is booked only for units still to send, and never while a change waits for the customer's payment (D174 2.1, 2.2).
  // A held card (D289) is captured before a carrier is booked: the booking card waits for it.
  const bookable = fulfilment.unitsToSend > 0 && !awaitingEdit && canWrite && order.status !== "authorized";
  // Posten / Bring (D134): ready when the store's agreement is complete; the parcel's weight is guessed from its products.
  const [bring, porterbuddy, helthjem, estimatedGrams] = await Promise.all([getCarrier(store.id, "bring"), getCarrier(store.id, "porterbuddy"), getCarrier(store.id, "helthjem"), estimateWeightGrams(store.id, order.id)]);
  const locale = store.markets[0]?.locale ?? order.locale;
  const money = (minor: number) => formatMoney(minor, order.currency, locale);
  // Bonus credits on an order (D130) are in the order's own currency; null for an order with none and for copied history.
  const bonusCurrency = order.currency;
  const bonus = order.copied ? null : order.bonus;
  const when = (iso: string) =>
    new Date(iso).toLocaleString(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const paid = order.status === "paid" || order.status === "fulfilled" || order.status === "closed";
  // A card held to be charged when the order is sent (D289): it is sent (or handed over) as a paid one is, and the first parcel captures it.
  const sendable = paid || held?.mode === "when_sent";
  // A weekly delivery (D102) waits for payment until it is sent: sending charges its card.
  const toCharge = weekly !== null && order.status === "pending_payment";
  const cancelledAfterPayment = order.status === "cancelled" && order.paidMinor > 0;
  // Where each line's units were taken from, and where a restock goes by default (wave 3, D172): read from the order's own stock movements.
  const physicalLines = order.lines.filter((l) => l.variantId && l.delivery === "physical");
  const [stockByVariant, stockLocations] = physicalLines.length > 0 && !order.copied ? await Promise.all([orderStockHistory(db(), store.id, order.id, [...new Set(physicalLines.map((l) => l.variantId!))]), listLocations(store.id)]) : [new Map<string, { taken: { locationId: string; quantity: number }[]; returned: { locationId: string; quantity: number }[] }>(), []];
  const locationNames: Record<string, string> = Object.fromEntries(stockLocations.map((l) => [l.id, l.name]));
  const activeLocations = stockLocations.filter((l) => l.active);
  const restockable = order.lines
    .filter((l) => l.variantId && l.delivery === "physical" && l.restockable > 0)
    .map((l) => {
      const history = stockByVariant.get(l.variantId!);
      return { id: l.id, title: l.title, left: l.restockable, putBack: putBackWords(history?.taken ?? [], history?.returned ?? [], stockLocations) };
    });
  // Units sold on backorder on a paid order that is not sent: the order waits for stock (wave 3, D172).
  const owedUnits = order.status === "paid" ? order.lines.reduce((sum, l) => sum + (l.backorder?.units ?? 0), 0) : 0;
  const digits = minorUnitDigits(order.currency);
  const typedAmount = (minor: number) => (minor / 10 ** digits).toFixed(digits).replace(".", ",");
  const ids = { storeSlug: store.slug, orderId: order.id };
  const address = order.shippingAddress;

  // History: the order's events and its emails, newest first.
  const history: { at: string; node: ReactNode }[] = [
    ...events.map((event) => ({ at: event.createdAt, node: <EventLine event={event} money={money} currency={order.currency} base={`/admin/${store.slug}`} locationNames={locationNames} words={words} /> })),
    ...emails.map((email) => ({
      at: email.createdAt,
      node: (
        <>
          {w.email}{" "}
          <Link href={`/admin/${store.slug}/emails/${email.id}`} className="underline">
            {email.subject}
          </Link>
          {email.status !== "sent" && (
            <span className="text-muted"> ({email.status === "logged" ? w.notSentNoEmail : email.status})</span>
          )}
        </>
      ),
    })),
  ].sort((a, b) => b.at.localeCompare(a.at));

  return (
    <AdminTextScope texts={adminTexts(lang, ["order", "drafts", "privacy", "builder"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <PageHeader
          back={{ href: `/admin/${store.slug}/orders`, label: w.back }}
          title={<>{fillWords(w.title, { number: order.number })}</>}
          description={<>{cancelledAfterPayment ? w.cancelledRefunded : toCharge ? w.toCharge : order.awaitingBank ? w.awaitingBank : statuses[order.status]}{fulfilment.state === "partly_sent" && countWords(fulfilment.unitsToSend, w.partlySent)}{awaitingEdit && w.changeAwaiting}{order.edits.some((e) => e.status === "applied") && w.edited}{fillWords(w.placed, { when: when(order.placedAt), market: order.marketCode })}{order.archivedAt && w.archived}{order.copied && w.copied}{order.source === "draft" && (<>{" · "}{w.staffMade}{order.draft?.number && (<>{w.fromDraft}<Link href={`/admin/${store.slug}/orders/drafts/${order.draft.id}`} className="underline">{order.draft.number}</Link></>)}{order.madeBy?.email && fillWords(w.by, { email: order.madeBy.email })}</>)}{order.exchange && (<>{" · "}{w.exchangeFor}{" "}<Link href={`/admin/${store.slug}/returns/${order.exchange.returnId}`} className="underline">{order.exchange.returnNumber}</Link>{w.ofOrder}<Link href={`/admin/${store.slug}/orders/${order.exchange.originalOrderId}`} className="underline">#{order.exchange.originalOrderNumber}</Link></>)}{order.subscriptionId && (<>{" · "}<Link href={`/admin/${store.slug}/subscriptions/${order.subscriptionId}`} className="underline">{w.partOfSubscription}</Link></>)}</>}
        />
        {(paid || canWrite || memberCan(member, "owner")) && (
          <div className="flex flex-wrap items-start gap-2">
            {canWrite && (
              <ArchiveButton
                archived={Boolean(order.archivedAt)}
                blocked={archiveBlocked ? words.archiveReasons[archiveBlocked] : null}
                archive={archiveOrderAction.bind(null, store.slug, order.id)}
                unarchive={unarchiveOrderAction.bind(null, store.slug, order.id)}
              />
            )}
            {/* The order file of this one order (D165): the owner's, because it can hold the buyer's personal data. */}
            {memberCan(member, "owner") && (
              <Link
                href={`/admin/${store.slug}/orders/export?numbers=${encodeURIComponent(order.number)}`}
                className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm"
              >
                {w.exportOrder}
              </Link>
            )}
            {paid && order.ships && !order.copied && (
              <Link
                href={`/admin/${store.slug}/orders/${order.id}/packing-slip`}
                target="_blank"
                className="inline-flex min-h-10 items-center rounded-pill border border-edge px-4 text-sm"
              >
                {order.gift ? w.printGiftSlip : w.packingSlip}
              </Link>
            )}
            {paid && order.email && <ResendButton {...ids} />}
          </div>
        )}
      </div>
      <OrderPrivacyBanner privacy={privacy} />
      {/* A fulfilment hold (D238): set by a rule or a person; nothing is sent or handed over until it is released. */}
      {!order.copied && (
        <HoldPanel
          hold={hold}
          base={`/admin/${store.slug}`}
          when={when}
          words={words.hold}
          release={canWrite && hold ? releaseHoldAction.bind(null, store.slug, order.id) : null}
          holdAction={canWrite && !hold && order.status === "paid" && order.ships ? holdOrderAction.bind(null, store.slug, order.id) : null}
        />
      )}
      {customer && (
        <CustomerBar customer={storeCustomerBar(store.slug, customer, locale, adminText(lang, "customers").bar)} words={adminText(lang, "customers")} />
      )}
      {owedUnits > 0 && (
        <p role="status" className="rounded-md border border-line bg-sunken p-3 text-sm">
          <span className="font-medium">{w.waitingForStock}</span> {countWords(owedUnits, w.owedText)}{" "}
          <Link href={`/admin/${store.slug}/inventory`} className="underline underline-offset-2">
            {w.inventoryPage}
          </Link>
          .
        </p>
      )}
      {events.some((e) => e.type === "stock.short") && (
        <p role="alert" className="rounded-md border border-danger-text bg-card p-3 text-sm">
          {w.stockShort}
        </p>
      )}

      <div className="grid gap-6 md:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="items" className={card}>
            <h2 id="items" className="mb-3 text-title text-ink">{w.items}</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[28rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 font-medium">{w.product}</th>
                    <th scope="col" className="py-2 font-medium">{w.sku}</th>
                    <th scope="col" className="py-2 text-right font-medium">{w.qty}</th>
                    <th scope="col" className="py-2 text-right font-medium">{w.total}</th>
                  </tr>
                </thead>
                <tbody>
                  {order.lines.map((line) => (
                    <tr key={line.id} className="border-b border-line">
                      <td className="py-2">
                        {line.title}
                        {line.delivery === "digital" && line.variantId && <span className="block text-xs text-muted">{w.digital}</span>}
                        {line.custom && <span className="block text-xs text-muted">{w.customItem}</span>}
                        {!line.custom && line.listPriceMinor !== null && line.listPriceMinor !== line.unitPriceMinor && (
                          <span className="block text-xs text-muted">{fillWords(w.customPrice, { price: money(line.unitPriceMinor), list: money(line.listPriceMinor) })}</span>
                        )}
                        {line.booking && (
                          <span className="block text-xs">
                            {bookingWhen(line.booking, "en-GB", t("en"))}
                            {line.booking.status !== "confirmed" && ` · ${line.booking.status === "held" ? w.heldUntilPaid : w.notBooked}`}
                          </span>
                        )}
                        {line.backorder && (
                          <span className="block text-xs font-medium">
                            {countWords(line.backorder.days, w.backordered, { units: line.backorder.units, qty: line.quantity })}
                          </span>
                        )}
                        {line.components.length > 0 && <span className="block text-xs text-muted">{fillWords(w.includes, { items: componentsText(line.components) })}</span>}
                        {takenFrom(line.variantId, stockByVariant, stockLocations) && <span className="block text-xs text-muted">{fillWords(w.takenFrom, { places: takenFrom(line.variantId, stockByVariant, stockLocations) })}</span>}
                        {line.restocked > 0 && <span className="block text-xs text-muted">{fillWords(w.restocked, { n: line.restocked })}</span>}
                        {fromWishlists
                          .filter((add) => line.variantId && add.variantId === line.variantId)
                          .slice(0, 1)
                          .map((add) => (
                            <span key={add.id} className="block text-xs text-muted">
                              {w.fromWishlist}{" "}
                              {add.wishlist.id ? (
                                <Link href={`/admin/${store.slug}/wishlists/${add.wishlist.id}`} className="underline">
                                  {add.wishlist.name}
                                </Link>
                              ) : (
                                add.wishlist.name
                              )}
                            </span>
                          ))}
                      </td>
                      <td className="py-2 font-mono text-xs">{line.sku}</td>
                      <td className="py-2 text-right">{line.quantity}</td>
                      <td className="py-2 text-right">{money(line.unitPriceMinor * line.quantity)}{line.gift && <span className="block text-xs text-muted">{w.freeGift}</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 flex flex-col gap-1 text-sm">
              <div className="flex justify-between"><dt>{w.subtotal}</dt><dd>{money(order.subtotalMinor)}</dd></div>
              {order.ships && <div className="flex justify-between"><dt>{w.shipping}{order.delivery && <span className="text-muted"> ({order.delivery.label})</span>}</dt><dd>{money(order.shippingMinor)}</dd></div>}
              {order.discountMinor > 0 && (
                <div className="flex justify-between">
                  <dt>
                    {w.discount}
                    {order.campaignDiscountMinor > 0 && order.campaignLabel && (
                      <span className="text-xs text-muted">
                        {" "}
                        (<Link href={`/admin/${store.slug}/campaigns`} className="underline">{order.campaignLabel}</Link>, −{money(order.campaignDiscountMinor)})
                      </span>
                    )}
                    {order.memberDiscountMinor > 0 && order.memberLabel && (
                      <span className="text-xs text-muted">
                        {" "}
                        ({order.memberLabel}
                        {order.memberPercent ? ` ${percentText(order.memberPercent)} %` : ""}, −{money(order.memberDiscountMinor)})
                      </span>
                    )}
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
              {order.staffDiscountMinor > 0 && (
                <div className="flex justify-between">
                  <dt>
                    {order.staffDiscountLabel ?? w.discount} <span className="text-xs text-muted">{w.staffDiscount}</span>
                  </dt>
                  <dd>−{money(order.staffDiscountMinor)}</dd>
                </div>
              )}
              <ReferralDiscountRow minor={order.copied ? 0 : order.referralDiscountMinor} currency={order.currency} locale={locale} words={words.referral} />
              <BonusUsedRow bonus={bonus} currency={bonusCurrency} locale={locale} words={words.bonus} />
              <VatReliefRow kind={order.vatKind} reliefMinor={order.vatReliefMinor} money={money} />
              <div className="flex justify-between font-medium"><dt>{w.total}</dt><dd>{money(order.totalMinor)}</dd></div>
              <div className="flex justify-between text-muted"><dt>{order.vatKind === "reverse_charge" ? w.vatReverse : w.vatIncluded}</dt><dd>{money(order.taxMinor)}</dd></div>
              {order.balanceMinor > 0 && (
                <div className="flex justify-between"><dt>{w.payAtAppointment}</dt><dd>{money(order.balanceMinor)}</dd></div>
              )}
              <BonusEarnedRow bonus={bonus} currency={bonusCurrency} locale={locale} words={words.bonus} />
              {order.company && (
                <div className="flex justify-between text-muted"><dt>{w.totalExVat}</dt><dd>{money(order.totalMinor - order.taxMinor)}</dd></div>
              )}
              {order.refundedMinor > 0 && (
                <>
                  <div className="flex justify-between border-t border-line pt-1"><dt>{w.refunded}</dt><dd>−{money(order.refundedMinor)}</dd></div>
                  <div className="flex justify-between font-medium"><dt>{w.kept}</dt><dd>{money(order.paidMinor - order.refundedMinor)}</dd></div>
                </>
              )}
            </dl>
            {order.paidOutside && (
              <p className="mt-3 rounded-md border border-line bg-sunken p-3 text-sm">
                {fillWords(w.paidOutside, { method: words.manualMethods[order.paidOutside.method].toLowerCase(), when: when(order.paidOutside.recordedAt) })}
              </p>
            )}
          </section>

          {editability && (
            <OrderEditCard
              editHref={`/admin/${store.slug}/orders/${order.id}/edit`}
              words={adminText(lang, "drafts")}
              canWrite={canWrite}
              blockText={editability.text}
              edits={order.edits}
              money={money}
              when={when}
              hasEmail={Boolean(order.email)}
              mayRecordOutside={mayRecordOutside}
              awaitingActions={
                canWrite && awaitingEdit
                  ? {
                      resend: resendOrderEditAction.bind(null, store.slug, awaitingEdit.id),
                      cancel: cancelOrderEditAction.bind(null, store.slug, awaitingEdit.id),
                      paidOutside: recordWaitingEditPaidOutsideAction.bind(null, store.slug, awaitingEdit.id),
                    }
                  : null
              }
            />
          )}

          {!order.copied && (
            <VatTreatmentPanel
              treatment={treatment}
              kind={order.vatKind}
              reliefMinor={order.vatReliefMinor}
              shippingReliefMinor={order.shippingReliefMinor}
              currency={order.currency}
              locale={locale}
              typedCompany={order.company?.name ?? null}
            />
          )}

          {held && (
            <CaptureCard
              heldLabel={formatMoney(held.amountMinor, held.currency, locale)}
              heldTyped={typedAmount(held.amountMinor)}
              currency={held.currency}
              deadline={dueWords(new Date(held.captureBefore), store.timeZone)}
              whenSent={held.mode === "when_sent" && order.ships}
              hasEmail={Boolean(order.email)}
              capture={canWrite ? captureOrderAction.bind(null, store.slug, order.id) : null}
              release={canWrite ? releaseCardAction.bind(null, store.slug, order.id) : null}
            />
          )}

          {!order.copied && <OrderAttributionCard attribution={attribution} storeSlug={store.slug} locale={locale} words={words.referral} />}

          {order.paymentTerms && (
            // Bought on payment terms (D293): what is owed and by when; money that arrived outside Kaizena Flow is recorded here.
            <section aria-labelledby="payment-terms" className={card} data-payment-terms={order.paymentTerms.state}>
              <h2 id="payment-terms" className="mb-1 text-title text-ink">
                {fillWords(w.termsTitle, { terms: words.termsLengths[order.paymentTerms.terms] })}
              </h2>
              <p className="mb-3 text-sm text-muted">
                {order.paymentTerms.state === "paid"
                  ? fillWords(w.termsPaid, { when: when(order.paymentTerms.paidAt!) })
                  : order.paymentTerms.state === "cancelled"
                    ? w.termsCancelled
                    : fillWords(w.termsDue, { state: words.termsStates[order.paymentTerms.state], amount: money(order.balanceMinor), day: dayWords(order.paymentTerms.dueOn, adminLocale) })}
              </p>
              {order.balanceMinor > 0 && order.paymentTerms.state !== "cancelled" && !order.paymentTerms.paidAt && mayRecordOutside && (
                <TermsPaidForm {...ids} amountLabel={money(order.balanceMinor)} today={todayIn(store.timeZone)} />
              )}
            </section>
          )}

          {order.balanceMinor > 0 && order.status !== "cancelled" && !order.paymentTerms && (
            <section aria-labelledby="balance" className={card}>
              <h2 id="balance" className="mb-1 text-title text-ink">{w.payAtAppointment}</h2>
              <p className="mb-3 text-sm text-muted">{fillWords(w.balanceText, { amount: money(order.balanceMinor) })}</p>
              <BalanceForm {...ids} amountLabel={money(order.balanceMinor)} />
            </section>
          )}

          {/* Collected at the store's place, or delivered by its own driver (D237): handed over, never sent as a parcel here. */}
          {sendable && order.ships && order.deliveryMethod !== "ship" && (
            <section aria-labelledby="handover" className={card}>
              <h2 id="handover" className="mb-3 text-title text-ink">{order.deliveryMethod === "pickup" ? w.pickup : w.localDelivery}</h2>
              {order.shipments.length > 0 && (
                <ShipmentList
                  shipments={order.shipments}
                  base={`/admin/${store.slug}/orders/${order.id}`}
                  when={when}
                  emailAgain={null}
                  words={words.parcels}
                  undo={canWrite && !order.copied && (order.status === "paid" || order.status === "fulfilled") ? (shipmentId) => undoShipmentAction.bind(null, store.slug, order.id, shipmentId) : null}
                  receiptRecorded={Boolean(returns?.deliveredOn)}
                />
              )}
              {order.deliveryMethod === "pickup" ? (
                <PickupPanel
                  delivery={order.deliveryKept?.kind === "pickup" ? order.deliveryKept : null}
                  readyAt={order.readyForPickupAt}
                  state={{ status: order.status, copied: order.copied, unitsToSend: fulfilment.unitsToSend, waitingUnits: owedUnits, editPending: Boolean(awaitingEdit), basis: fulfilment.basis, deliveredOn: returns?.deliveredOn ?? null }}
                  canWrite={canWrite}
                  today={todayIn(store.timeZone)}
                  when={when}
                  ready={readyForPickupAction.bind(null, store.slug, order.id)}
                  collected={collectedAction.bind(null, store.slug, order.id)}
                  words={words.handover}
                />
              ) : (
                <LocalDeliveryPanel
                  delivery={order.deliveryKept?.kind === "local" ? order.deliveryKept : null}
                  note={order.deliveryNote}
                  phone={address.phone || order.billingAddress.phone || null}
                  takenOutAt={liveShipments(order.shipments).find((s) => s.method === "local")?.createdAt ?? null}
                  state={{ status: order.status, copied: order.copied, unitsToSend: fulfilment.unitsToSend, waitingUnits: owedUnits, editPending: Boolean(awaitingEdit), basis: fulfilment.basis, deliveredOn: returns?.deliveredOn ?? null }}
                  canWrite={canWrite}
                  today={todayIn(store.timeZone)}
                  when={when}
                  out={outForDeliveryAction.bind(null, store.slug, order.id)}
                  delivered={markDeliveredAction.bind(null, store.slug, order.id)}
                  words={words.handover}
                />
              )}
            </section>
          )}

          {(sendable || toCharge) && order.ships && order.deliveryMethod === "ship" && (
            <section aria-labelledby="sending" className={card}>
              <h2 id="sending" className="mb-3 text-title text-ink">
                {fulfilment.state === "partly_sent" ? w.partlySentTitle : sentParcels > 0 ? w.sentTitle : toCharge ? w.sendAndCharge : w.sendTheOrder}
              </h2>
              {weekly && toCharge && (
                <div className="mb-4 flex flex-col gap-1 text-sm">
                  <p>{fillWords(w.boxDelivery, { date: formatDeliveryDate(weekly.date, locale), amount: money(order.totalMinor), card: weekly.cardLabel ? ` (${weekly.cardLabel})` : "" })}</p>
                  {weekly.lastFailure && <p role="alert" className="text-danger-text">{fillWords(w.lastTry, { problem: weekly.lastFailure })}</p>}
                </div>
              )}
              <ShipmentList
                shipments={order.shipments}
                base={`/admin/${store.slug}/orders/${order.id}`}
                when={when}
                emailAgain={canWrite && order.email ? (shipmentId) => resendShippedAction.bind(null, store.slug, order.id, shipmentId) : null}
                undo={canWrite && !order.copied && (order.status === "paid" || order.status === "fulfilled") ? (shipmentId) => undoShipmentAction.bind(null, store.slug, order.id, shipmentId) : null}
                receiptRecorded={Boolean(returns?.deliveredOn)}
                words={words.parcels}
                status={(s) =>
                  s.trackingNumber && !s.undone && (trackedCarrier(s) || trackingOf.has(s.id)) ? (
                    <ParcelStatus
                      tracking={trackingOf.get(s.id)}
                      carrierName={s.carrier || w.theCarrier}
                      when={when}
                      words={words.tracking}
                      checkNow={trackingOf.get(s.id)?.followed ? checkParcelNowAction.bind(null, store.slug, order.id, s.id) : null}
                    />
                  ) : null
                }
              />
              {receipt && (
                <p className="mb-4 text-sm text-muted">
                  {receipt.source === "carrier"
                    ? fillWords(w.receiptCarrier, { when: when(receipt.at) })
                    : receipt.source === "handover"
                      ? fillWords(w.receiptHandover, { when: when(receipt.at) })
                      : fillWords(w.receiptStaff, { when: when(receipt.at) })}
                </p>
              )}
              {bring?.complete && order.status !== "pending_payment" && !order.copied && bookable && (
                <details open={sentParcels === 0} className="mb-4 rounded-md border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium">{fillWords(w.bookWith, { carrier: "Posten / Bring" })}</summary>
                  <div className="mt-3">
                    <BringBooking
                      storeSlug={store.slug}
                      orderId={order.id}
                      estimatedGrams={estimatedGrams}
                      test={bring.environment === "test"}
                      hasEmail={Boolean(order.email)}
                      chosen={order.delivery?.carrier === "bring" ? order.delivery : null}
                      rows={parcelRows}
                      notifyOff={notifyOff("order.sent")}
                    />
                  </div>
                </details>
              )}
              {porterbuddy?.complete && order.delivery?.carrier === "porterbuddy" && order.delivery.window && order.status !== "pending_payment" && !order.copied && bookable && (
                <details open={sentParcels === 0} className="mb-4 rounded-md border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium">{fillWords(w.bookWith, { carrier: "Porterbuddy" })}</summary>
                  <div className="mt-3">
                    <ChosenDeliveryBooking
                      carrierName="Porterbuddy"
                      chosenText={fillWords(w.deliveryWindow, { window: formatWindow(order.delivery.window, adminLocale, store.timeZone) })}
                      estimatedGrams={estimatedGrams}
                      test={porterbuddy.environment === "test"}
                      hasEmail={Boolean(order.email)}
                      book={porterbuddyBookAction.bind(null, store.slug, order.id)}
                      rows={parcelRows}
                      notifyOff={notifyOff("order.sent")}
                    />
                  </div>
                </details>
              )}
              {helthjem?.complete && order.delivery?.carrier === "helthjem" && order.status !== "pending_payment" && !order.copied && bookable && (
                <details open={sentParcels === 0} className="mb-4 rounded-md border border-line p-4">
                  <summary className="cursor-pointer text-sm font-medium">{fillWords(w.bookWith, { carrier: "Helthjem" })}</summary>
                  <div className="mt-3">
                    <ChosenDeliveryBooking
                      carrierName="Helthjem"
                      chosenText={`${order.delivery.label}${order.delivery.pickupPoint ? fillWords(w.at, { point: pickupPointLine(order.delivery.pickupPoint) }) : ""}`}
                      estimatedGrams={estimatedGrams}
                      test={helthjem.environment === "test"}
                      hasEmail={Boolean(order.email)}
                      book={helthjemBookAction.bind(null, store.slug, order.id)}
                      rows={parcelRows}
                      notifyOff={notifyOff("order.sent")}
                    />
                  </div>
                </details>
              )}
              {!canWrite ? null : awaitingEdit ? (
                <p className="text-sm text-muted">{w.changeWaitsSend}</p>
              ) : fulfilment.unitsToSend === 0 && !toCharge ? (
                <p className="text-sm text-muted">
                  {fulfilment.state === "withdrawn"
                    ? w.allWithdrawn
                    : fulfilment.state === "closed"
                      ? w.restClosed
                      : w.nothingLeft}
                </p>
              ) : (
                <SendParcelForm
                  rows={parcelRows}
                  basis={fulfilment.basis}
                  carriers={CARRIERS.map(({ id, name }) => ({ id, name }))}
                  hasEmail={Boolean(order.email)}
                  whole={weekly !== null}
                  submitLabel={toCharge ? w.chargeAndSend : held ? w.captureAndSend : sentParcels > 0 ? w.sendAnother : w.sendThis}
                  send={sendOrderAction.bind(null, store.slug, order.id)}
                  notifyOff={notifyOff("order.sent")}
                />
              )}
            </section>
          )}

          {(paid || cancelledAfterPayment) && (order.refundableMinor > 0 || restockable.length > 0) && (
            <section aria-labelledby="refund" className={card}>
              <h2 id="refund" className="mb-1 text-title text-ink">{w.refund}</h2>
              <p className="mb-3 text-sm text-muted">
                {fillWords(w.paidSoFar, { amount: money(order.paidMinor) })}
                {order.refundedMinor > 0 && fillWords(w.refundedSoFar, { amount: money(order.refundedMinor) })}.{" "}
                {order.paidOutside ? w.refundOutside : w.refundStripe}
              </p>
              {awaitingEdit && (
                <p role="note" className="mb-3 rounded-md border border-line bg-sunken p-3 text-sm">
                  {w.changeWaitsRefund}
                </p>
              )}
              <BonusRefundNote bonus={bonus} currency={bonusCurrency} locale={locale} refund={{ refundedMinor: order.refundedMinor, totalMinor: order.totalMinor }} words={words.bonus} />
              <RefundForm
                {...ids}
                refundable={typedAmount(order.refundableMinor)}
                refundableLabel={money(order.refundableMinor)}
                lines={restockable}
                locations={activeLocations.map((l) => ({ id: l.id, name: l.name }))}
                hasEmail={Boolean(order.email)}
                canRefund={order.canRefund && order.refundableMinor > 0}
                outside={order.paidOutside ? { allowed: outsideAllowed } : null}
                unitsToSend={order.status === "paid" ? fulfilment.unitsToSend : 0}
                notifyOff={notifyOff("order.refunded")}
              />
              {order.refunds.length > 0 && (
                <ul className="mt-4 flex flex-col gap-1 border-t border-line pt-3 text-sm">
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

          {((order.status === "paid" && sentParcels === 0) || toCharge) && (
            <section aria-labelledby="cancel" className={card}>
              <h2 id="cancel" className="mb-1 text-title text-ink">{w.cancelTitle}</h2>
              {order.subscriptionId && (
                <p className="mb-2 text-sm text-muted">{w.cancelSubscription}</p>
              )}
              <CancelForm {...ids} amountLabel={money(order.refundableMinor)} hasEmail={Boolean(order.email)} unpaid={toCharge} outside={Boolean(order.paidOutside)} notifyOff={notifyOff("order.cancelled")} />
            </section>
          )}

          <DocumentsCard
            words={adminText(lang, "invoices")}
            base={`/admin/${store.slug}`}
            documents={documents}
            canWrite={memberCan(member, "orders:write")}
            sendAgain={(type, id) => sendDocumentAgainAction.bind(null, store.slug, type, id)}
            locale={locale}
          />

          {returns && !order.copied && (
            <OrderReturnsCard
              words={adminText(lang, "returns")}
              base={`/admin/${store.slug}`}
              overview={returns}
              withdrawalPage={storeHref(store.slug, marketPath(store.slug, order.marketCode, "/withdraw"))}
              timeZone={store.timeZone}
              today={todayIn(store.timeZone)}
              partlySent={fulfilment.state === "partly_sent"}
              exchanges={exchangedFor}
              actions={{
                markDelivered: markDeliveredAction.bind(null, store.slug, orderId),
                registerWithdrawal: registerWithdrawalAction.bind(null, store.slug, orderId),
              }}
            />
          )}

          <section aria-labelledby="history" className={card}>
            <h2 id="history" className="mb-3 text-title text-ink">{w.history}</h2>
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

          {/* What the shopper was shown about the terms when they ordered (wave 1, 1e): the record, and each text as it was. */}
          <Suspense fallback={null}>
            <OrderTermsCard store={store} orderId={orderId} zone="Europe/Oslo" locale={adminLocale} words={words.terms} />
          </Suspense>

          <StaffFieldsSection store={store} entity="order" id={orderId} save={saveOrderFieldsAction.bind(null, store.slug, orderId)} />
        </div>

        <div className="flex flex-col gap-6">
          <PaymentCard
            payments={paymentFacts.payments}
            disputes={paymentFacts.disputes}
            money={(minor, currency) => formatMoney(minor, currency, locale)}
            due={(iso) => dueWords(new Date(iso), store.timeZone)}
            words={words.payment}
          />
          <TagsCard tags={order.tags} suggestions={tagChoices.map((t) => t.label)} canWrite={canWrite} change={changeTagsAction.bind(null, store.slug, order.id)} />
          {order.gift && <GiftCard gift={order.gift} slipHref={paid && order.ships && !order.copied ? `/admin/${store.slug}/orders/${order.id}/packing-slip` : null} words={words.gift} />}
          <section aria-labelledby="customer" className={`${card} text-sm`}>
            <h2 id="customer" className="mb-2 text-title text-ink">
              {customer ? (
                <Link href={`/admin/${store.slug}/customers/${customer.key}`} className="underline">
                  {customer.name || w.customer}
                </Link>
              ) : (
                w.customer
              )}
            </h2>
            {order.email ? (
              <a href={`mailto:${order.email}`} className="break-all underline">{order.email}</a>
            ) : (
              <p className="text-muted">{w.notKnownYet}</p>
            )}
            {(address.phone || order.billingAddress.phone) && <p>{address.phone || order.billingAddress.phone}</p>}
            {order.company && (
              <p className="mt-2">
                {order.company.name}
                <span className="block text-muted">{fillWords(w.organisationNumber, { number: order.company.number })}</span>
              </p>
            )}
            {order.companyPurchase.location && <p className="mt-1">{fillWords(w.forLocation, { location: order.companyPurchase.location })}</p>}
            {order.companyPurchase.poNumber && <p className="mt-1">{fillWords(w.poNumber, { po: order.companyPurchase.poNumber })}</p>}
            {order.checkoutAnswers.length > 0 && (
              // The store's own questions at checkout (D357): what the buyer answered, as placed.
              <>
                <h3 className="mt-3 mb-1 text-body-strong text-ink">{w.checkoutAnswers}</h3>
                <dl className="flex flex-col gap-1" data-checkout-answers>
                  {order.checkoutAnswers.map((a) => (
                    <div key={a.fieldId}>
                      <dt className="text-muted">{a.label}</dt>
                      <dd>{answerText(a, w.answerYes, w.answerNo)}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}
            {order.companyPurchase.approval && order.status === "pending_payment" && (
              <p className="mt-1 text-warning-text">{w.approval[order.companyPurchase.approval]}</p>
            )}
            {order.ships && order.deliveryMethod === "pickup" && (
              <>
                <h3 className="mt-3 mb-1 text-body-strong text-ink">{w.collectsAt}</h3>
                <p>{order.deliveryKept?.kind === "pickup" ? order.deliveryKept.name : w.oneOfYourPlaces}</p>
              </>
            )}
            {order.ships && order.deliveryMethod !== "pickup" && (
              <>
                <h3 className="mt-3 mb-1 text-body-strong text-ink">{order.deliveryMethod === "local" ? w.deliverTo : w.shipTo}</h3>
                <AddressBlock address={address} unknown={w.notKnownYet} />
                {(order.deliveryKept?.kind === "method" || order.deliveryKept?.kind === "flat") && (
                  <p className="mt-2">
                    <span className="text-muted">{w.chosenDelivery}</span> {order.deliveryKept.label}
                    {order.deliveryKept.kind === "method" && order.deliveryKept.zone && <span className="text-muted"> ({order.deliveryKept.zone.name})</span>}
                  </p>
                )}
                {order.deliveryMismatchAt && order.deliveryKept?.kind !== "carrier" && (
                  <p role="note" className="mt-2 rounded-md bg-warning-soft px-3 py-2 text-warning-text">
                    {fillWords(w.mismatchKept, { priced: order.deliveryKept && "postalCode" in order.deliveryKept && order.deliveryKept.postalCode ? order.deliveryKept.postalCode : w.anotherCode, address: address.postalCode || w.another })}
                  </p>
                )}
                {order.delivery && (
                  <p className="mt-2">
                    <span className="text-muted">{w.chosenDelivery}</span> {order.delivery.label}
                    {order.delivery.pickupPoint && <span className="block">{fillWords(w.pickupAt, { point: pickupPointLine(order.delivery.pickupPoint) })}</span>}
                    {order.delivery.window && <span className="block">{fillWords(w.windowLine, { window: formatWindow(order.delivery.window, adminLocale, store.timeZone) })}</span>}
                    {address.postalCode && order.delivery.postalCode && address.postalCode.replace(/\s/g, "") !== order.delivery.postalCode && (
                      <span role="note" className="mt-1 block rounded-md bg-warning-soft px-3 py-2 text-warning-text">
                        {fillWords(w.mismatchQuote, { quoted: order.delivery.postalCode, address: address.postalCode })}
                      </span>
                    )}
                  </p>
                )}
              </>
            )}
            {order.status !== "pending_payment" && (
              <details className="mt-3">
                <summary className="cursor-pointer underline">{w.changeContact}</summary>
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
              <h2 id="downloads" className="mb-2 text-title text-ink">{w.downloads}</h2>
              <p className="mb-2 text-muted">{fillWords(w.consent, { when: when(order.digitalConsentAt) })}</p>
              {downloads.length === 0 ? (
                <p className="text-muted">{w.linksLater}</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {downloads.map((file) => (
                    <li key={file.token}>
                      {file.name}:{" "}
                      <span className="text-muted">
                        {file.used === 0 ? w.notDownloaded : fillWords(w.downloaded, { n: file.used })}
                        {file.left !== null && fillWords(w.left, { n: file.left })}
                        {file.gone && w.linkGone}
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
    </AdminTextScope>
  );
}

/** Where a line's units were taken from, in words (the order's `sale` movements); empty when nothing is recorded (an older order, a download). */
function takenFrom(variantId: string | null, byVariant: Map<string, { taken: { locationId: string; quantity: number }[] }>, locations: { id: string; name: string; active: boolean }[]): string {
  const history = variantId ? byVariant.get(variantId) : undefined;
  return history ? takenFromWords(history.taken, locations) : "";
}

function EventLine({ event, money, currency, base, locationNames, words }: { event: OrderEvent; money: (minor: number) => string; currency: string; base: string; locationNames: Record<string, string>; words: OrderMessages }) {
  const w = words.page;
  const label = words.events[event.type] ?? event.type;
  const data = event.data as Record<string, unknown>;
  // A withdrawal or return's own steps (D153), in words, with a link to the return.
  if (isReturnEvent(event.type)) {
    return (
      <>
        {eventSentence(event.type, data, currency)}
        {typeof data.returnId === "string" && typeof data.number === "string" && (
          <>
            {" · "}
            <Link href={`${base}/returns/${data.returnId}`} className="underline">
              {data.number}
            </Link>
          </>
        )}
      </>
    );
  }
  // Draft orders and the wave 3 operations (D173), in words.
  // Disputes (D288), in words.
  const dispute = disputeEventText(event.type, data, money);
  if (dispute !== null) return <>{dispute}</>;
  // A held card and its capture (D289), in words.
  const captureLine = captureEventText(event.type, data, money);
  if (captureLine !== null) return <>{captureLine}</>;
  const ops = opsEventText(event.type, data, money);
  if (ops !== null) return <>{ops}</>;
  // Parcels and changes of the order (D174), in words.
  const parcel = fulfilmentEventText(event.type, data, money);
  if (parcel !== null) return <>{parcel}</>;
  if (event.type === "note.added") {
    return (
      <>
        <span className="font-medium">{w.note}</span>
        {fillWords(w.noteBy, { by: String(data.by ?? w.staff) })}{" "}
        <span className="whitespace-pre-wrap">{String(data.note ?? "")}</span>
      </>
    );
  }
  if (event.type === "order.refunded" || event.type === "order.restocked") {
    const restocked = (data.restocked as { sku: string; quantity: number; locationId?: string }[] | undefined) ?? [];
    return (
      <>
        {label}
        {Number(data.amount) > 0 && ` ${money(Number(data.amount))}`}
        {data.reason ? ` · ${String(data.reason)}` : ""}
        {restocked.length > 0 && fillWords(w.backInStock, { lines: restocked.map((r) => `${r.quantity} × ${r.sku}${r.locationId && locationNames[r.locationId] ? fillWords(w.atPlace, { place: locationNames[r.locationId] }) : ""}`).join(", ") })}
      </>
    );
  }
  if (event.type === "stock.backordered") {
    const sold = (data.lines as { sku: string; quantity: number }[] | undefined) ?? [];
    return (
      <>
        {label}
        {sold.length > 0 && `: ${sold.map((r) => `${r.quantity} × ${r.sku}`).join(", ")}`}
      </>
    );
  }
  return <>{label}</>;
}

function AddressBlock({ address, unknown }: { address: Address; unknown: string }) {
  const parts = [address.name, address.line1, address.line2, `${address.postalCode ?? ""} ${address.city ?? ""}`.trim(), address.country];
  const lines = parts.filter((p): p is string => Boolean(p && p.trim()));
  if (lines.length === 0) return <p className="text-muted">{unknown}</p>;
  return (
    <address className="not-italic">
      {lines.map((line) => (
        <span key={line} className="block">{line}</span>
      ))}
    </address>
  );
}
