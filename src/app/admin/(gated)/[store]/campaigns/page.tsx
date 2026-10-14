import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { campaignStatus, describeCampaign } from "@/lib/campaigns";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { requirePermission } from "@/server/permissions";
import { listCampaigns } from "@/server/campaigns";
import { Button, ButtonLink, Card, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";

import { deleteCampaignAction, setCampaignActiveAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS = {
  active: "Running now",
  off: "Switched off",
  scheduled: "Starts later",
  ended: "Ended",
} as const;

const STATUS_SIGNAL = { active: "positive", off: "neutral", scheduled: "insight", ended: "neutral" } as const;

const KIND_WORD = { percent: "Percentage off", multi_buy: "Buy more, pay for fewer", gift: "Free product" } as const;

/** The store's campaigns (D114): offers without a code, for a time, and what each has given. */
export default async function CampaignsPage({ params }: PageProps<"/admin/[store]/campaigns">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const campaigns = await listCampaigns(store.id);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const when = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const base = `/admin/${store.slug}/campaigns`;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader
          title="Campaigns"
          description={<>Offers that need no code: a percentage off, buy more and pay for fewer (3 for 2), or a free product when the basket comes to an amount. They can be for the whole store, some products, or a category or tag, and start and stop by themselves.</>}
        />
        <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
          New campaign
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line bg-card p-8 text-center text-sm text-muted">
          No campaigns yet. Try 3 for 2 on a category, or a free product above a basket amount.
        </p>
      ) : (
        <Card compact>
          <List label="Campaigns">
            {campaigns.map((c) => {
              const status = campaignStatus(c);
              const usedUp = c.usageLimit !== null && c.orders >= c.usageLimit && status === "active";
              const reach = c.productIds.length + c.termIds.length;
              const limits = [
                c.markets.length > 0 && `Only in ${c.markets.map((code) => store.markets.find((m) => m.code === code)?.name ?? code).join(", ")}`,
                c.perCustomerLimit !== null && `${c.perCustomerLimit === 1 ? "Once" : `${c.perCustomerLimit} orders`} per customer`,
                c.tierIds.length > 0 && `For ${c.tierIds.length === 1 ? "a customer group" : `${c.tierIds.length} customer groups`}`,
                c.stacks && "Adds on top",
              ].filter(Boolean);
              return (
                <ListRow key={c.id}>
                  <RowLead
                    title={c.name}
                    href={`${base}/${c.id}`}
                    sub={
                      <>
                        {KIND_WORD[c.kind]} · {describeCampaign(c, money)}
                        {c.kind === "gift" && c.giftTitle && ` (${c.giftQuantity > 1 ? `${c.giftQuantity} × ` : ""}${c.giftTitle})`}
                        {" · "}
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
                        {limits.length > 0 && <span className="block">{limits.join(" · ")}</span>}
                      </>
                    }
                  />
                  <RowFact className="hidden md:block" sub={c.startsAt || c.endsAt ? `to ${c.endsAt ? when.format(new Date(c.endsAt)) : "no end"}` : undefined}>
                    {c.startsAt || c.endsAt ? (c.startsAt ? `From ${when.format(new Date(c.startsAt))}` : "From now") : "No dates"}
                  </RowFact>
                  <RowFact
                    className="hidden sm:block"
                    sub={Object.entries(c.given)
                      .map(([currency, minor]) => `${formatMoney(minor, currency, locale)} given`)
                      .join(", ")}
                  >
                    {c.orders === 1 ? "1 order" : `${c.orders} orders`}
                    {c.usageLimit !== null && ` of ${c.usageLimit}`}
                  </RowFact>
                  <Chip signal={usedUp ? "warning" : STATUS_SIGNAL[status]} dot>
                    {usedUp ? "Used up" : STATUS[status]}
                  </Chip>
                  <RowActions>
                    <form action={setCampaignActiveAction.bind(null, store.slug, c.id, !c.active)}>
                      <Button type="submit" kind="quiet" size="dense">
                        {c.active ? "Switch off" : "Switch on"}
                        <span className="sr-only"> {c.name}</span>
                      </Button>
                    </form>
                    <ButtonLink href={`${base}/${c.id}`} kind="quiet" size="dense">
                      Edit<span className="sr-only"> {c.name}</span>
                    </ButtonLink>
                    <DeleteDiscountButton
                      action={deleteCampaignAction.bind(null, store.slug, c.id)}
                      code={c.name}
                      compact
                      question={`Delete the campaign ${c.name}? Shoppers no longer get it.${c.orders > 0 ? ` The ${c.orders} ${c.orders === 1 ? "order" : "orders"} that got something from it keep it.` : ""}`}
                    />
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
