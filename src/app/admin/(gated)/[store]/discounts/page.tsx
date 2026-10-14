import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { describeDiscount, discountStatus } from "@/lib/discounts";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import { requirePermission } from "@/server/permissions";
import { listDiscounts } from "@/server/discounts";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";

import { deleteDiscountAction } from "./actions";

export const metadata: Metadata = { title: "Coupons" };

const STATUS = {
  active: "Active",
  off: "Switched off",
  scheduled: "Starts later",
  ended: "Ended",
  used_up: "Used up",
} as const;

const STATUS_SIGNAL = { active: "positive", off: "neutral", scheduled: "insight", ended: "neutral", used_up: "warning" } as const;

/** The store's discount codes (D31), newest first, with how often each was used. */
export default async function DiscountsPage({ params }: PageProps<"/admin/[store]/discounts">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const discounts = await listDiscounts(store.id);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const base = `/admin/${store.slug}/discounts`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title="Coupons" description={<>Codes shoppers type in the cart or at checkout for money off or free shipping.</>} />
        <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
          New coupon
        </Link>
      </div>
      {discounts.length === 0 ? (
        <p className="rounded-panel border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
          No codes yet. Make one for a campaign, a newsletter or a loyal customer.
        </p>
      ) : (
        <Card compact>
          <List label="Coupons">
            {discounts.map((d) => {
              const status = discountStatus(d, d.used);
              return (
                <ListRow key={d.id}>
                  <RowLead
                    title={<span className="font-mono">{d.code}</span>}
                    href={`${base}/${d.id}`}
                    sub={
                      <>
                        {describeDiscount(d, money)}
                        {d.productIds && ` · ${d.productIds.length} ${d.productIds.length === 1 ? "product" : "products"}`}
                      </>
                    }
                  />
                  <RowFact
                    className="hidden sm:block"
                    sub={Object.entries(d.given)
                      .map(([currency, minor]) => `${formatMoney(minor, currency, locale)} given`)
                      .join(", ")}
                  >
                    Used {d.used}
                    {d.usageLimit !== null && ` of ${d.usageLimit}`}
                  </RowFact>
                  <Chip signal={STATUS_SIGNAL[status]} dot>
                    {STATUS[status]}
                  </Chip>
                  <RowActions>
                    <ButtonLink href={`${base}/${d.id}`} kind="quiet" size="dense">
                      Edit<span className="sr-only"> {d.code}</span>
                    </ButtonLink>
                    <DeleteDiscountButton action={deleteDiscountAction.bind(null, store.slug, d.id)} code={d.code} used={d.used} compact />
                  </RowActions>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}
    </div>
  );
}
