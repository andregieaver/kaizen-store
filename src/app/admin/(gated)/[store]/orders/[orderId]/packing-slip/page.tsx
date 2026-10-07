import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PackingSlipView } from "@/components/admin/orders/packing-slip-view";
import { PrintArea } from "@/components/admin/print-area";
import { PrintButton } from "@/components/admin/print-button";
import { BULK_REASON_TEXT } from "@/lib/order-bulk";
import { packingSlipData, parcelSlipData, type PackingSlip } from "@/server/packing-slips";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Packing slip" };

/**
 * A packing slip to print and put in the parcel, in the customer's language, without prices (D27). For a gift order (wave 3, D173) it also prints the buyer's message above the lines;
 * it is the same price-free page, so the gift slip is this one. Drawn only from `packingSlipData()`, which holds no price.
 *
 * Sending in parts (D174, `docs/wave-3-fulfilment.md` 2.3): the order's slip prints what is still to send (every item, under *All items (already sent)*, when nothing is
 * left: a reprint); `?shipment={id}` prints that parcel's items, with "more follows" when units remain. A parcel of another order or store is a 404.
 */
export default async function PackingSlipPage({ params, searchParams }: PageProps<"/admin/[store]/orders/[orderId]/packing-slip">) {
  const { store: slug, orderId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(orderId).success) notFound();
  const shipment = (await searchParams).shipment;
  if (shipment !== undefined) {
    if (typeof shipment !== "string" || !z.uuid().safeParse(shipment).success) notFound();
    const parcel = await parcelSlipData(store.id, orderId, shipment);
    if (!parcel) notFound();
    return <SlipPage slip={parcel} storeName={store.name} seller={store.details} />;
  }
  const set = await packingSlipData(store.id, [orderId], { reprint: true });
  if (!set.ok) notFound();
  const slip = set.slips[0];
  if (!slip) {
    const skipped = set.skipped[0];
    if (!skipped || skipped.reason === "not_found") notFound();
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Packing slip</h1>
        <p className="rounded-lg border border-border bg-surface p-4 text-sm">There is no slip for this order: {BULK_REASON_TEXT[skipped.reason].replace(/^It /, "it ").replace(/\.$/, "")}.</p>
        <Link href={`/admin/${store.slug}/orders/${orderId}`} className="text-sm underline underline-offset-2">
          Back to the order
        </Link>
      </div>
    );
  }
  return <SlipPage slip={slip} storeName={store.name} seller={store.details} />;
}

function SlipPage({ slip, storeName, seller }: { slip: PackingSlip; storeName: string; seller: Parameters<typeof PackingSlipView>[0]["seller"] }) {
  return (
    <PrintArea className="flex flex-col gap-4">
      <div className="mx-auto flex w-full max-w-2xl justify-end print:hidden">
        <PrintButton label="Print" />
      </div>
      <PackingSlipView slip={slip} storeName={storeName} seller={seller} />
    </PrintArea>
  );
}
