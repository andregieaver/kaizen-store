import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { PackingSlipView } from "@/components/admin/orders/packing-slip-view";
import { PrintButton } from "@/components/admin/print-button";
import { BULK_REASON_TEXT } from "@/lib/order-bulk";
import { packingSlipData } from "@/server/packing-slips";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Packing slip" };

/**
 * A packing slip to print and put in the parcel, in the customer's language, without prices (D27). For a gift order (wave 3, D173) it also prints the buyer's message above the lines;
 * it is the same price-free page, so the gift slip is this one. Drawn only from `packingSlipData()`, which holds no price.
 */
export default async function PackingSlipPage({ params }: PageProps<"/admin/[store]/orders/[orderId]/packing-slip">) {
  const { store: slug, orderId } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  if (!z.uuid().safeParse(orderId).success) notFound();
  const set = await packingSlipData(store.id, [orderId]);
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
  return (
    <div className="flex flex-col gap-4">
      {/* Only the slip itself is printed. */}
      <style>{"@media print { body > *:not(main), header, nav { display: none !important } main { padding: 0 !important } }"}</style>
      <div className="mx-auto flex w-full max-w-2xl justify-end print:hidden">
        <PrintButton label="Print" />
      </div>
      <PackingSlipView slip={slip} storeName={store.name} seller={store.details} />
    </div>
  );
}
