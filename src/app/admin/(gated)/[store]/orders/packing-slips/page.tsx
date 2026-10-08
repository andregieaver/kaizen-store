import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { PackingSlipView } from "@/components/admin/orders/packing-slip-view";
import { PrintArea } from "@/components/admin/print-area";
import { PrintButton } from "@/components/admin/print-button";
import { BULK_PRINT_MAX, BULK_REASON_TEXT, BULK_REQUEST_TEXT } from "@/lib/order-bulk";
import { packingSlipData } from "@/server/packing-slips";
import { requirePermission } from "@/server/permissions";

export const metadata: Metadata = { title: "Packing slips" };

/** The ids of the address: comma separated, at most one more than the limit is read (so "too many" can be said). */
function idsOf(value: string | string[] | undefined): string[] {
  const text = Array.isArray(value) ? value.join(",") : (value ?? "");
  return text
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
    .slice(0, BULK_PRINT_MAX + 1);
}

/**
 * Packing slips for several orders in one document (wave 3, D173, `docs/wave-3-orders.md` 2.5): at most 100, each on its own printed page and in its own order's language, without prices.
 * Each slip holds what is still to send (D174: a partly sent order's remainder). Orders already sent or withdrawn, with nothing to ship, copied history and ids that
 * are not this store's are left out, with the reason at the top (not printed). It changes no state.
 */
export default async function PackingSlipsPage({ params, searchParams }: PageProps<"/admin/[store]/orders/packing-slips">) {
  const { store: slug } = await params;
  const gated = await requirePermission(slug, "orders:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const ids = idsOf((await searchParams).ids);
  const set = await packingSlipData(store.id, ids);
  if (!set.ok) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Packing slips</h1>
        <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-sm">
          {set.problem === "empty" ? "Choose the orders to print on the orders page." : BULK_REQUEST_TEXT.too_many.replace(/ \(100 to print\)/, "")}
        </p>
        <Link href={`/admin/${store.slug}/orders`} className="text-sm underline underline-offset-2">
          Back to the orders
        </Link>
      </div>
    );
  }
  return (
    <PrintArea className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Packing slips</h1>
          {set.slips.length > 0 && <PrintButton label={`Print ${set.slips.length} ${set.slips.length === 1 ? "slip" : "slips"}`} />}
        </div>
        <p className="text-sm text-muted">
          {set.slips.length} {set.slips.length === 1 ? "slip" : "slips"} ready, each order on its own page and in its own language. A slip has no prices. This page prints only the slips.
        </p>
        {set.skipped.length > 0 && (
          <section aria-label="Orders left out" className="rounded-lg border border-border bg-surface p-4 text-sm">
            <p className="font-medium">
              {set.skipped.length} {set.skipped.length === 1 ? "order was" : "orders were"} left out:
            </p>
            <ul className="mt-1 flex flex-col gap-1">
              {set.skipped.map((s, i) => (
                <li key={`${i}-${s.id}`}>
                  {s.number ? `#${s.number}` : "An order that was not found"}: {BULK_REASON_TEXT[s.reason]}
                </li>
              ))}
            </ul>
          </section>
        )}
        <Link href={`/admin/${store.slug}/orders`} className="text-sm underline underline-offset-2">
          Back to the orders
        </Link>
      </div>
      {set.slips.map((slip, index) => (
        <PackingSlipView key={slip.orderId} slip={slip} storeName={store.name} seller={store.details} breakAfter={index < set.slips.length - 1} />
      ))}
    </PrintArea>
  );
}
