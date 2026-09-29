import type { Metadata } from "next";
import Link from "next/link";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { campaignStatus, describeCampaign } from "@/lib/campaigns";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { requireMember } from "@/server/auth";
import { listCampaigns } from "@/server/campaigns";

import { deleteCampaignAction, setCampaignActiveAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS = {
  active: "Running now",
  off: "Switched off",
  scheduled: "Starts later",
  ended: "Ended",
} as const;

const KIND_WORD = { percent: "Percentage off", multi_buy: "Buy more, pay for fewer", gift: "Free product" } as const;

/** The store's campaigns (D114): offers without a code, for a time, and what each has given. */
export default async function CampaignsPage({ params }: PageProps<"/admin/[store]/campaigns">) {
  const { store } = await requireMember((await params).store);
  const campaigns = await listCampaigns(store.id);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const base = `/admin/${store.slug}/campaigns`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Campaigns</h1>
          <p className="max-w-2xl text-sm text-muted">
            Offers that need no code: a percentage off, buy more and pay for fewer (3 for 2), or a free product when the basket comes to an amount. They
            can be for the whole store, some products, or a category or tag, and start and stop by themselves.
          </p>
        </div>
        <Link href={`${base}/new`} className="min-h-10 rounded-md bg-foreground px-4 py-2 text-sm font-medium text-background">
          New campaign
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-background p-8 text-center text-sm text-muted">
          No campaigns yet. Try 3 for 2 on a category, or a free product above a basket amount.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className="px-4 py-2 font-medium">Campaign</th>
                <th scope="col" className="px-4 py-2 font-medium">Gives</th>
                <th scope="col" className="hidden px-4 py-2 font-medium md:table-cell">When</th>
                <th scope="col" className="hidden px-4 py-2 font-medium sm:table-cell">Orders</th>
                <th scope="col" className="px-4 py-2 font-medium">Status</th>
                <th scope="col" className="px-4 py-2 font-medium">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => {
                const status = campaignStatus(c);
                const reach = c.productIds.length + c.termIds.length;
                return (
                  <tr key={c.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-2">
                      <Link href={`${base}/${c.id}`} className="font-medium underline-offset-2 hover:underline">
                        {c.name}
                      </Link>
                      <span className="block text-xs text-muted">{KIND_WORD[c.kind]}</span>
                    </td>
                    <td className="px-4 py-2">
                      {describeCampaign(c, money)}
                      {c.kind === "gift" && c.giftTitle && (
                        <span className="block text-xs text-muted">
                          {c.giftQuantity > 1 && `${c.giftQuantity} × `}
                          {c.giftTitle}
                        </span>
                      )}
                      <span className="block text-xs text-muted">
                        {reach === 0
                          ? c.kind === "gift"
                            ? "Counts everything"
                            : "Everything"
                          : [
                              c.productIds.length > 0 && `${c.productIds.length} ${c.productIds.length === 1 ? "product" : "products"}`,
                              c.termIds.length > 0 && `${c.termIds.length} ${c.termIds.length === 1 ? "category or tag" : "categories and tags"}`,
                            ]
                              .filter(Boolean)
                              .join(", ")}
                      </span>
                    </td>
                    <td className="hidden px-4 py-2 md:table-cell">
                      {c.startsAt || c.endsAt ? (
                        <>
                          {c.startsAt ? when.format(new Date(c.startsAt)) : "Now"}
                          <span className="block text-xs text-muted">to {c.endsAt ? when.format(new Date(c.endsAt)) : "no end"}</span>
                        </>
                      ) : (
                        <span className="text-muted">No dates</span>
                      )}
                    </td>
                    <td className="hidden px-4 py-2 sm:table-cell">
                      {c.orders}
                      {c.usageLimit !== null && ` of ${c.usageLimit}`}
                      {Object.entries(c.given).map(([currency, minor]) => (
                        <span key={currency} className="block text-xs text-muted">
                          {formatMoney(minor, currency, locale)} given
                        </span>
                      ))}
                    </td>
                    <td className="px-4 py-2">
                      {c.usageLimit !== null && c.orders >= c.usageLimit && status === "active" ? "Used up" : STATUS[status]}
                      {c.tierIds.length > 0 && <span className="block text-xs text-muted">For {c.tierIds.length === 1 ? "a customer group" : `${c.tierIds.length} customer groups`}</span>}
                      {c.stacks && <span className="block text-xs text-muted">Adds on top</span>}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex items-center justify-end gap-1">
                        <form action={setCampaignActiveAction.bind(null, store.slug, c.id, !c.active)}>
                          <button type="submit" className="flex min-h-10 items-center rounded-md px-3 hover:bg-surface">
                            {c.active ? "Switch off" : "Switch on"}
                            <span className="sr-only"> {c.name}</span>
                          </button>
                        </form>
                        <Link href={`${base}/${c.id}`} className="flex min-h-10 items-center rounded-md px-3 hover:bg-surface">
                          Edit<span className="sr-only"> {c.name}</span>
                        </Link>
                        <DeleteDiscountButton
                          action={deleteCampaignAction.bind(null, store.slug, c.id)}
                          code={c.name}
                          compact
                          question={`Delete the campaign ${c.name}? Shoppers no longer get it.${c.orders > 0 ? ` The ${c.orders} ${c.orders === 1 ? "order" : "orders"} that got something from it keep it.` : ""}`}
                        />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
