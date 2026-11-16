import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { describeDiscount, discountStatus } from "@/lib/discounts";
import { OFFER_KEYS, OFFERS } from "@/lib/discount-offers";
import { formatMoney } from "@/lib/money";
import { mainCurrency } from "@/lib/markets";
import { requirePermission } from "@/server/permissions";
import { listDiscounts } from "@/server/discounts";
import { ButtonLink, Card, CARD_CLASS, Chip, List, ListRow, PageHeader, RowActions, RowFact, RowLead } from "@/components/admin/ui";

import { deleteDiscountAction } from "./actions";

export const metadata: Metadata = { title: "Coupons" };

const STATUS_SIGNAL = { active: "positive", off: "neutral", scheduled: "insight", ended: "neutral", used_up: "warning" } as const;

/** The store's discount codes (D31), newest first, with how often each was used. */
export default async function DiscountsPage({ params }: PageProps<"/admin/[store]/discounts">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const lang = adminLangOf(account.adminLocale);
  const all = adminText(lang, "discounts");
  const w = all.codes;
  const discounts = await listDiscounts(store.id);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const currencyOf = (marketCode: string) => store.markets.find((m) => m.code === marketCode)?.currency ?? mainCurrency(store);
  const money = (minor: number, marketCode: string) => formatMoney(minor, currencyOf(marketCode), locale);
  const base = `/admin/${store.slug}/discounts`;
  const live = discounts.filter((d) => discountStatus(d, d.used) === "active").length;

  return (
    <AdminTextScope texts={adminTexts(lang, ["discounts"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        meta={[
          <span key="lead">
            <span className="text-ink">{live === 0 ? w.leadNone : countWords(live, w.leadSome)}</span>
            {w.leadRest}
          </span>,
        ]}
        actions={
          <ButtonLink kind="secondary" href={`${base}/new`}>
            {w.writeOwn}
          </ButtonLink>
        }
      />
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
    </div>
    </AdminTextScope>
  );
}
