import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { describeDiscount, discountStatus } from "@/lib/discounts";
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

  return (
    <AdminTextScope texts={adminTexts(lang, ["discounts"])}>
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <PageHeader title={w.title} description={w.description} />
        <Link href={`${base}/new`} className="min-h-10 rounded-pill bg-brand px-4 py-2 text-sm font-medium text-brand-ink">
          {w.newCode}
        </Link>
      </div>
      {discounts.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>{w.empty}</p>
      ) : (
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
    </div>
    </AdminTextScope>
  );
}
