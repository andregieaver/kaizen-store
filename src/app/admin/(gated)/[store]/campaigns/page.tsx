import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { campaignStatus, describeCampaign } from "@/lib/campaigns";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { requirePermission } from "@/server/permissions";
import { listCampaigns } from "@/server/campaigns";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";

import { deleteCampaignAction, setCampaignActiveAction } from "./actions";

export const metadata: Metadata = { title: "Campaigns" };

const STATUS_SIGNAL = { active: "positive", off: "neutral", scheduled: "insight", ended: "neutral" } as const;

/** The store's campaigns (D114): offers without a code, for a time, and what each has given. */
export default async function CampaignsPage({ params }: PageProps<"/admin/[store]/campaigns">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const lang = adminLangOf(account.adminLocale);
  const all = adminText(lang, "discounts");
  const w = all.campaigns;
  const campaigns = await listCampaigns(store.id);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const when = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Oslo" });
  const base = `/admin/${store.slug}/campaigns`;

  return (
    <AdminTextScope texts={adminTexts(lang, ["discounts"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={w.title} description={w.description} />
        <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
          {w.newCampaign}
        </Link>
      </div>
      {campaigns.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>{w.empty}</p>
      ) : (
        <Card compact>
          <List label={w.title}>
            {campaigns.map((c) => {
              const status = campaignStatus(c);
              const usedUp = c.usageLimit !== null && c.orders >= c.usageLimit && status === "active";
              const reach = c.productIds.length + c.termIds.length;
              const limits = [
                c.markets.length > 0 && fillWords(w.onlyIn, { countries: c.markets.map((code) => store.markets.find((m) => m.code === code)?.name ?? code).join(", ") }),
                c.perCustomerLimit !== null && countWords(c.perCustomerLimit, w.perCustomer),
                c.tierIds.length > 0 && countWords(c.tierIds.length, w.groups),
                c.stacks && w.stacks,
                !c.combinesWithCodes && w.notWithCodes,
              ].filter(Boolean);
              return (
                <ListRow key={c.id}>
                  <RowLead
                    title={c.name}
                    href={`${base}/${c.id}`}
                    sub={
                      <>
                        {w.kinds[c.kind]} · {describeCampaign(c, money, all.describe)}
                        {c.kind === "gift" && c.giftTitle && ` (${c.giftQuantity > 1 ? `${c.giftQuantity} × ` : ""}${c.giftTitle})`}
                        {" · "}
                        {reach === 0
                          ? c.kind === "gift" || c.kind === "free_shipping"
                            ? w.countsEverything
                            : w.everything
                          : [
                              c.productIds.length > 0 && countWords(c.productIds.length, w.products),
                              c.termIds.length > 0 && countWords(c.termIds.length, w.terms),
                            ]
                              .filter(Boolean)
                              .join(", ")}
                        {limits.length > 0 && <span className="block">{limits.join(" · ")}</span>}
                      </>
                    }
                  />
                  <RowFact
                    className="hidden md:block"
                    sub={c.startsAt || c.endsAt ? (c.endsAt ? fillWords(w.to, { date: when.format(new Date(c.endsAt)) }) : w.toNoEnd) : undefined}
                  >
                    {c.startsAt || c.endsAt ? (c.startsAt ? fillWords(w.from, { date: when.format(new Date(c.startsAt)) }) : w.fromNow) : w.noDates}
                  </RowFact>
                  <RowFact
                    className="hidden sm:block"
                    sub={Object.entries(c.given)
                      .map(([currency, minor]) => fillWords(all.codes.given, { amount: formatMoney(minor, currency, locale) }))
                      .join(", ")}
                  >
                    {c.usageLimit !== null ? countWords(c.orders, w.ordersOf, { limit: c.usageLimit }) : countWords(c.orders, w.orders)}
                  </RowFact>
                  <Chip signal={usedUp ? "warning" : STATUS_SIGNAL[status]} dot>
                    {usedUp ? all.status.used_up : status === "active" ? all.status.running : all.status[status]}
                  </Chip>
                  <RowActions>
                    <form action={setCampaignActiveAction.bind(null, store.slug, c.id, !c.active)}>
                      <Button type="submit" kind="quiet" size="dense">
                        {c.active ? w.switchOff : w.switchOn}
                        <span className="sr-only"> {c.name}</span>
                      </Button>
                    </form>
                    <ButtonLink href={`${base}/${c.id}`} kind="quiet" size="dense">
                      {all.codes.edit}<span className="sr-only"> {c.name}</span>
                    </ButtonLink>
                    <DeleteDiscountButton
                      action={deleteCampaignAction.bind(null, store.slug, c.id)}
                      code={c.name}
                      compact
                      question={fillWords(all.remove.campaignQuestion, { name: c.name }) + (c.orders > 0 ? countWords(c.orders, all.remove.campaignKept) : "")}
                    />
                  </RowActions>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}
    </div>
    </AdminTextScope>
  );
}
