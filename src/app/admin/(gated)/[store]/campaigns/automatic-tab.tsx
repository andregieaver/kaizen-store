import type { ReactNode } from "react";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { adminDate } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { campaignStatus, describeCampaign } from "@/lib/campaigns";
import { SALE_KEYS } from "@/lib/campaign-offers";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import { listCampaigns } from "@/server/campaigns";
import type { Store } from "@/server/stores";
import { Button, ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, RowActions, RowFact, RowLead } from "@/components/admin/ui";
import { QuietActionForm } from "@/components/admin/quiet-action-form";

import { deleteCampaignAction, setCampaignActiveAction } from "./actions";

const STATUS_SIGNAL = { active: "positive", off: "neutral", scheduled: "insight", ended: "neutral" } as const;

/**
 * The Automatic tab of Discounts (ecosystem plan E3.7, D718): the store's campaigns (D114), offers without a code for a time, what each
 * has given, and the ready sales (round 10, D633). It was the Campaigns page at `/campaigns`, which now leads here; each offer's own pages
 * stay under that address. The header's sentence and its action are the tab's.
 */
export async function automaticTab(store: Store, lang: AdminLang): Promise<{ lead: ReactNode; action: ReactNode; body: ReactNode }> {
  const all = adminText(lang, "discounts");
  const w = all.campaigns;
  const campaigns = await listCampaigns(store.id);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const base = `/admin/${store.slug}/campaigns`;
  const running = campaigns.filter((c) => campaignStatus(c) === "active").length;
  // Whole amounts in the main currency, as a person says them ("800 kr"), for the ready sales.
  const big = (major: number) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: mainCurrency(store), maximumFractionDigits: 0, currencyDisplay: "narrowSymbol" }).format(major);

  const lead = (
    <span key="lead">
      <span className="text-ink">{running === 0 ? w.leadNone : countWords(running, w.leadSome)}</span>
      {w.leadRest}
    </span>
  );
  const action = (
    <ButtonLink kind="secondary" href={`${base}/new`}>
      {w.writeOwn}
    </ButtonLink>
  );
  const body = (
    <>
      {campaigns.length > 0 && (
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
                    sub={c.startsAt || c.endsAt ? (c.endsAt ? fillWords(w.to, { date: adminDate(store, c.endsAt, "dayTime", lang) }) : w.toNoEnd) : undefined}
                  >
                    {c.startsAt || c.endsAt ? (c.startsAt ? fillWords(w.from, { date: adminDate(store, c.startsAt, "dayTime", lang) }) : w.fromNow) : w.noDates}
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
                    <QuietActionForm action={setCampaignActiveAction.bind(null, store.slug, c.id, !c.active)}>
                      <Button type="submit" kind="quiet" size="dense">
                        {c.active ? w.switchOff : w.switchOn}
                        <span className="sr-only"> {c.name}</span>
                      </Button>
                    </QuietActionForm>
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
      <section aria-labelledby="ready-sales" className="flex flex-col gap-3">
        <h2 id="ready-sales" className="text-title text-ink">
          {w.salesTitle}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3">
          {SALE_KEYS.map((key, i) => {
            const words = w.sales[key];
            const fill = { amount: big(key === "gift" ? 1000 : 800), zero: big(0) };
            return (
              <li key={key} className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
                <span aria-hidden className="text-2xl tracking-tight text-ink">{fillWords(words.big, fill)}</span>
                <span className="text-body text-ink">{fillWords(words.title, fill)}</span>
                <span className="text-caption text-ink-2">{fillWords(words.sub, fill)}</span>
                <ButtonLink
                  href={`${base}/new?sale=${key}`}
                  kind={i === 0 && running === 0 ? "main" : "secondary"}
                  size="dense"
                  className="mt-auto self-start"
                >
                  {w.makeIt}
                  <span className="sr-only"> {fillWords(words.title, fill)}</span>
                </ButtonLink>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
  return { lead, action, body };
}
