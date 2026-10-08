import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireShopOrAfterSale } from "@/components/admin/after-sale-gate";
import { ReturnDetailView, type ReturnDetailActions } from "@/components/admin/returns/detail-view";
import { previewData, todayIn } from "@/lib/return-admin";
import { requirePermission } from "@/server/permissions";
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
      today={todayIn(store.timeZone)}
    />
  );
}
