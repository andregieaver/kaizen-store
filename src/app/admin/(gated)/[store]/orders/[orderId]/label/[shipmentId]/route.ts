import { z } from "zod";

import { requireMember } from "@/server/auth";
import { carrierLabel } from "@/server/carrier-label";

/** The PDF label of a shipment booked with Posten / Bring (D134) or Porterbuddy (D137), fetched with the store's own agreement for its staff only. */
export async function GET(_request: Request, { params }: RouteContext<"/admin/[store]/orders/[orderId]/label/[shipmentId]">) {
  const { store: slug, orderId, shipmentId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(shipmentId).success) return new Response("Not found", { status: 404 });
  const pdf = await carrierLabel(store.id, orderId, shipmentId);
  if (!pdf) return new Response("The label is not available from the carrier right now.", { status: 404 });
  return new Response(pdf.buffer as ArrayBuffer, {
    headers: { "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="label-${shipmentId.slice(0, 8)}.pdf"`, "Cache-Control": "private, no-store" },
  });
}
