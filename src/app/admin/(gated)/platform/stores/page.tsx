import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { formatBps, priceLabel, SUBSCRIPTION_LABELS } from "@/lib/plans";
import { listStoreBilling } from "@/server/billing";
import { requirePlatformAdmin } from "@/server/auth";

export const metadata: Metadata = { title: "Stores" };

/** Every store with its plan, subscription and fee. */
export default async function PlatformStoresPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const stores = await listStoreBilling();
  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold">Stores</h1>
        <p className="text-sm text-muted">
          Each store&apos;s plan with Kaizen and its fee per sale. Open a store to start, change or
          cancel its plan, or give it its own fee.
        </p>
      </div>
      <div className="overflow-x-auto rounded-lg border border-border bg-background">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-muted">
              <th scope="col" className="px-4 py-2 font-normal">Store</th>
              <th scope="col" className="px-4 py-2 font-normal">Plan</th>
              <th scope="col" className="px-4 py-2 font-normal">Status</th>
              <th scope="col" className="px-4 py-2 font-normal">Next invoice</th>
              <th scope="col" className="px-4 py-2 text-right font-normal">Fee per sale</th>
            </tr>
          </thead>
          <tbody>
            {stores.map((store) => (
              <tr key={store.storeId} className="border-b border-border last:border-0">
                <td className="px-4 py-2">
                  <Link href={`/admin/platform/stores/${store.slug}`} className="font-medium underline">
                    {store.name}
                  </Link>
                  <span className="block text-muted">{store.ownerEmail ?? store.slug}</span>
                </td>
                <td className="px-4 py-2">
                  {store.planName ?? <span className="text-muted">No plan</span>}
                  {store.price && (
                    <span className="block text-muted">
                      {priceLabel(store.price.amountMinor, store.price.currency, store.price.interval)}
                    </span>
                  )}
                </td>
                <td className="px-4 py-2">
                  {store.status ? (SUBSCRIPTION_LABELS[store.status] ?? store.status) : "–"}
                  {store.cancelAtPeriodEnd && <span className="block text-muted">Ends at period end</span>}
                  {store.mode === "test" && <span className="block text-muted">Test mode</span>}
                </td>
                <td className="px-4 py-2">
                  {store.currentPeriodEnd && !store.cancelAtPeriodEnd && store.status !== "canceled"
                    ? store.currentPeriodEnd.slice(0, 10)
                    : "–"}
                </td>
                <td className="px-4 py-2 text-right">
                  {formatBps(store.feeBps)}
                  {store.saleFeeBpsOverride !== null && <span className="block text-muted">own fee</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
