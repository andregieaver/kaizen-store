import type { ReactNode } from "react";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { describeDiscount, discountStatus } from "@/lib/discounts";
import { OFFER_KEYS, OFFERS } from "@/lib/discount-offers";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import { DISCOUNTS_WORDS } from "@/lib/admin-words/discounts";
import { listDiscounts } from "@/server/discounts";
import type { Store } from "@/server/stores";
import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, RowActions, RowFact, RowLead } from "@/components/admin/ui";

import { deleteDiscountAction } from "./actions";

const STATUS_SIGNAL = { active: "positive", off: "neutral", scheduled: "insight", ended: "neutral", used_up: "warning" } as const;

/**
 * The Codes tab of Discounts (ecosystem plan E3.7, D718): the store's discount codes (D31), newest first, with how often each was used,
 * and the ready offers (round 9, D630). It was the Coupons page; only its home changed. The header's sentence and its action are the tab's.
 */
export async function codesTab(store: Store, lang: AdminLang): Promise<{ lead: ReactNode; action: ReactNode; body: ReactNode }> {
  const all = DISCOUNTS_WORDS[lang];
  const w = all.codes;
  const discounts = await listDiscounts(store.id);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const base = `/admin/${store.slug}/discounts`;
  const live = discounts.filter((d) => discountStatus(d, d.used) === "active").length;

  const lead = (
    <span key="lead">
      <span className="text-ink">{live === 0 ? w.leadNone : countWords(live, w.leadSome)}</span>
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
      {discounts.length > 0 && (
        <Card compact>
          <List label={w.title}>
            {discounts.map((d) => {
              const status = discountStatus(d, d.used);
              return (
                <ListRow key={d.id}>
                  <RowLead
                    title={<span className="font-mono">{d.code}</span>}
                    href={`${base}/${d.id}`}
                    sub={
                      <>
                        {describeDiscount(d, money, all.describe)}
                        {d.productIds && countWords(d.productIds.length, w.products)}
                      </>
                    }
                  />
                  <RowFact
                    className="hidden sm:block"
                    sub={Object.entries(d.given)
                      .map(([currency, minor]) => fillWords(w.given, { amount: formatMoney(minor, currency, locale) }))
                      .join(", ")}
                  >
                    {d.usageLimit !== null ? fillWords(w.usedOf, { n: d.used, limit: d.usageLimit }) : fillWords(w.used, { n: d.used })}
                  </RowFact>
                  <Chip signal={STATUS_SIGNAL[status]} dot>
                    {all.status[status]}
                  </Chip>
                  <RowActions>
                    <ButtonLink href={`${base}/${d.id}`} kind="quiet" size="dense">
                      {w.edit}<span className="sr-only"> {d.code}</span>
                    </ButtonLink>
                    <DeleteDiscountButton action={deleteDiscountAction.bind(null, store.slug, d.id)} code={d.code} used={d.used} compact />
                  </RowActions>
                </ListRow>
              );
            })}
          </List>
        </Card>
      )}
      <section aria-labelledby="ready-offers" className="flex flex-col gap-3">
        <h2 id="ready-offers" className="text-title text-ink">
          {w.offersTitle}
        </h2>
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(min(16rem,100%),1fr))] gap-3">
          {OFFER_KEYS.map((key, i) => {
            const offer = OFFERS[key];
            const words = w.offers[key];
            const fill = {
              amount: formatMoney((offer.amountMajor ?? 0) * 100, mainCurrency(store), locale),
              least: formatMoney((offer.minSubtotalMajor ?? 0) * 100, mainCurrency(store), locale),
            };
            const taken = discounts.some((d) => d.code.toUpperCase() === offer.code);
            return (
              <li key={key} className={`flex flex-col gap-2 p-5 ${CARD_CLASS}`}>
                <span className="self-start rounded-md bg-canvas px-2.5 py-1 font-mono text-body text-ink">{offer.code}</span>
                <span className="text-body text-ink">{fillWords(words.title, fill)}</span>
                <span className="text-caption text-ink-2">{fillWords(words.sub, fill)}</span>
                {!taken && (
                  <ButtonLink
                    href={`${base}/new?offer=${key}`}
                    kind={i === 0 && discounts.length === 0 ? "main" : "secondary"}
                    size="dense"
                    className="mt-auto self-start"
                  >
                    {w.makeIt}
                    <span className="sr-only"> {offer.code}</span>
                  </ButtonLink>
                )}
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
  return { lead, action, body };
}
