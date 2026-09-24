import type { Metadata } from "next";
import Link from "next/link";

import { describeDiscount, discountStatus } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth";
import { listDiscounts } from "@/server/discounts";

export const metadata: Metadata = { title: "Discounts" };

const STATUS = {
  active: "Active",
  off: "Switched off",
  scheduled: "Starts later",
  ended: "Ended",
  used_up: "Used up",
} as const;

/** The store's discount codes (D31), newest first, with how often each was used. */
export default async function DiscountsPage({ params }: PageProps<"/admin/[store]/discounts">) {
  const { store } = await requireMember((await params).store);
  const discounts = await listDiscounts(store.id);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? "NOK";
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const base = `/admin/${store.slug}/discounts`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Discounts</h1>
          <p className="text-sm text-muted">Codes shoppers type in the cart for money off or free shipping.</p>
        </div>
        <Link href={`${base}/new`} className="min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          New code
        </Link>
      </div>
      {discounts.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          No codes yet. Make one for a campaign, a newsletter or a loyal customer.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Code</th>
                <th scope="col" className="px-4 py-2 font-medium">Gives</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Used</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {discounts.map((d) => (
                <tr key={d.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/${d.id}`} className="font-mono font-medium underline-offset-2 hover:underline">
                      {d.code}
                    </Link>
                  </td>
                  <td className="px-4 py-2">
                    {describeDiscount(d, money)}
                    {d.productIds && (
                      <span className="block text-xs text-muted">
                        {d.productIds.length} {d.productIds.length === 1 ? "product" : "products"}
                      </span>
                    )}
                  </td>
                  <td className="hidden px-4 py-2 sm:table-cell">
                    {d.used}
                    {d.usageLimit !== null && ` of ${d.usageLimit}`}
                    {Object.entries(d.given).map(([currency, minor]) => (
                      <span key={currency} className="block text-xs text-muted">
                        {formatMoney(minor, currency, locale)} given
                      </span>
                    ))}
                  </td>
                  <td className="px-4 py-2">{STATUS[discountStatus(d, d.used)]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
