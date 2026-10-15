import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { ReturnDetailView, type ReturnDetailActions } from "@/components/admin/returns/detail-view";
import { ExchangeCard } from "@/components/admin/returns/exchange-card";
import { LabelCard } from "@/components/admin/returns/label-card";
import type { BuilderForm } from "@/lib/exchange-form";
import { formatPriceInput } from "@/lib/product-input";
import { previewData, todayIn } from "@/lib/return-admin";
import { orderDeliveryAddress } from "@/server/exchange-admin";
import { exchangeBlockFor, exchangesOfReturn, previewExchange, type ExchangePreview } from "@/server/exchanges";
import { mayRecordOutsidePayment } from "@/server/order-settings";
import { memberCan, requirePermission } from "@/server/permissions";
import { labelOptions } from "@/server/return-labels";
import { getReturn, previewRefund } from "@/server/returns";

import {
  approveReturnAction,
  cancelReturnAction,
  closeReturnAction,
  declineReturnAction,
  declineReturnLineAction,
  inspectReturnAction,
  markInTransitAction,
  markReceivedAction,
  recalculateRefundAction,
  refundReturnAction,
  returnInstructionsAction,
  returnNoteAction,
  sendAcknowledgementAction,
} from "../actions";
import {
  cancelExchangeAction,
  exchangePaidOutsideAction,
  previewExchangeAction,
  processExchangeAction,
  proposeExchangeAction,
  recordAgreementAction,
  resendExchangeAction,
  saveExchangeDraftAction,
  searchExchangeVariantsAction,
  withdrawExchangeAction,
} from "./exchange-actions";
import { bookReturnLabelAction } from "./label-actions";

export const metadata: Metadata = { title: "Return" };

/** One withdrawal or return and everything staff do with it (D153): a thin loader over `ReturnDetailView`. */
export default async function ReturnPage({ params }: PageProps<"/admin/[store]/returns/[returnId]">) {
  const { store: slug, returnId } = await params;
  const gated = await requirePermission(slug, "orders:read");
  // While the online shop is off (D178 step 5), what was sold stays reachable as long as an order can still be withdrawn from or returned.
  const shopOff = await requireShopOrAfterSale(gated);
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!z.uuid().safeParse(returnId).success) notFound();
  const detail = await getReturn(store.id, returnId);
  if (!detail) notFound();
  // The working is read only where the refund can be made, so a finished return does not work it out.
  const preview = detail.actions.includes("refund") ? await previewRefund(store.id, returnId) : null;
  const at = [store.slug, returnId] as const;
  const canWrite = memberCan(gated, "orders:write");
  const today = todayIn(store.timeZone);

  // The exchange (D239): the return's live exchange, else its newest; why it cannot be exchanged; the builder's start (the order's address, a draft's lines).
  const [exchanges, block, label, mayRecordOutside] = await Promise.all([
    exchangesOfReturn(store.id, returnId),
    exchangeBlockFor(store.id, returnId),
    labelOptions(store.id, returnId),
    canWrite ? mayRecordOutsidePayment(gated) : Promise.resolve(false),
  ]);
  const exchange = exchanges.find((x) => ["draft", "proposed", "confirmed", "processed"].includes(x.status)) ?? exchanges[0] ?? null;
  const live = exchange && ["draft", "proposed", "confirmed", "processed"].includes(exchange.status) ? exchange : null;
  let builder: { initial: BuilderForm; initialPreview: ExchangePreview | null; hasEmail: boolean } | null = null;
  if (canWrite && block === null && (!live || live.status === "draft")) {
    const [address, start] = await Promise.all([orderDeliveryAddress(store.id, detail.orderId), previewExchange(store.id, returnId, null)]);
    const draft = live?.status === "draft" ? live : null;
    builder = {
      initial: {
        lines: (draft?.lines ?? []).map((l) => ({
          variantId: l.variantId,
          title: l.title,
          sku: l.sku,
          options: "",
          listPriceMinor: l.listPriceMinor,
          quantity: String(l.quantity),
          price: l.unitPriceMinor < l.listPriceMinor ? formatPriceInput(l.unitPriceMinor, detail.currency) : "",
        })),
        shipping: draft?.shippingKind ?? "free",
        shippingPrice: draft?.shippingKind === "set" ? formatPriceInput(draft.shippingMinor, detail.currency) : "",
        address: draft?.deliveryAddress
          ? { ...draft.deliveryAddress, phone: draft.deliveryAddress.phone ?? "" }
          : { name: address.name, street: address.street, postalCode: address.postalCode, city: address.city, country: address.country, phone: address.phone },
      },
      initialPreview: "message" in start ? null : (start as ExchangePreview),
      hasEmail: address.email,
    };
  }
  const shown = exchange && exchange.status !== "draft" ? exchange : null;
  const step = shown ? ([store.slug, returnId, shown.id] as const) : null;
  const actions: ReturnDetailActions = {
    approve: approveReturnAction.bind(null, ...at),
    decline: declineReturnAction.bind(null, ...at),
    declineLine: declineReturnLineAction.bind(null, ...at),
    instructions: returnInstructionsAction.bind(null, ...at),
    markInTransit: markInTransitAction.bind(null, ...at),
    markReceived: markReceivedAction.bind(null, ...at),
    inspect: inspectReturnAction.bind(null, ...at),
    refund: refundReturnAction.bind(null, ...at),
    close: closeReturnAction.bind(null, ...at),
    cancel: cancelReturnAction.bind(null, ...at),
    note: returnNoteAction.bind(null, ...at),
    acknowledge: sendAcknowledgementAction.bind(null, ...at),
    recalculate: recalculateRefundAction.bind(null, ...at),
  };
  return (
    <ReturnDetailView
      base={`/admin/${store.slug}`}
      detail={detail}
      preview={preview ? previewData(preview) : null}
      actions={actions}
      timeZone={store.timeZone}
      today={today}
      exchangeCard={
        <ExchangeCard
          base={`/admin/${store.slug}`}
          detail={detail}
          exchange={exchange}
          block={block}
          canWrite={canWrite}
          mayRecordOutside={mayRecordOutside}
          builder={builder}
          builderActions={
            canWrite
              ? {
                  preview: previewExchangeAction.bind(null, ...at),
                  save: saveExchangeDraftAction.bind(null, ...at),
                  propose: proposeExchangeAction.bind(null, ...at),
                  searchVariants: searchExchangeVariantsAction.bind(null, ...at),
                }
              : null
          }
          stepActions={
            step
              ? {
                  resend: resendExchangeAction.bind(null, ...step),
                  withdraw: withdrawExchangeAction.bind(null, ...step),
                  agreement: recordAgreementAction.bind(null, ...step),
                  process: processExchangeAction.bind(null, ...step),
                  paidOutside: exchangePaidOutsideAction.bind(null, ...step),
                  cancel: cancelExchangeAction.bind(null, ...step),
                }
              : null
          }
          timeZone={store.timeZone}
          today={today}
        />
      }
      labelCard={
        <LabelCard
          detail={detail}
          options={label}
          printHref={`/admin/${store.slug}/returns/${returnId}/label`}
          book={canWrite ? bookReturnLabelAction.bind(null, ...at) : null}
          canWrite={canWrite}
          timeZone={store.timeZone}
        />
      }
    />
  );
}
