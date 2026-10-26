import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { forWhomLine, pricingLine } from "@/lib/price-lists";
import { listCompanies } from "@/server/companies";
import { listTiers } from "@/server/customer-tiers";
import { listProductChoices } from "@/server/discounts";
import { requirePermission } from "@/server/permissions";
import { findVariants, getPriceList, listCurrencies, listPrices, listTargets } from "@/server/price-lists";
import { listTerms } from "@/server/taxonomy";
import { Card, PageHeader } from "@/components/admin/ui";

import { deletePriceListAction, saveAssignmentsAction, savePriceListAction, savePricesAction, saveScopeAction } from "../actions";

export const metadata: Metadata = { title: "Price list" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";
const tickBox = "flex max-h-64 flex-col gap-1 overflow-y-auto rounded-panel border border-line p-3 text-sm";

type VariantRow = { variantId: string; title: string; options: Record<string, string>; sku: string; amounts: Map<string, string> };

/** One price list (D321): its settings, who it is for, what its percentage reaches and its fixed prices. */
export default async function PriceListPage({ params, searchParams }: PageProps<"/admin/[store]/price-lists/[listId]">) {
  const { store: slug, listId } = await params;
  const gated = await requirePermission(slug, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const words = adminText(adminLangOf(gated.account.adminLocale), "customers").priceLists;
  if (!z.uuid().safeParse(listId).success) notFound();
  const list = await getPriceList(store.id, listId);
  if (!list) notFound();
  const find = String((await searchParams).find ?? "").slice(0, 80);
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const [targets, tiers, companies, products, terms, currencies, prices, found] = await Promise.all([
    listTargets(store.id, list.id),
    listTiers(store.id),
    listCompanies(store.id),
    listProductChoices(store.id, locale),
    listTerms({ storeId: store.id, contentType: "product" }),
    listCurrencies(store.id),
    listPrices(store.id, list.id, locale),
    findVariants(store.id, locale, find),
  ]);
  const categories = terms.filter((term) => term.kind === "category");
  const base = `/admin/${store.slug}`;

  // The variants priced, then those found that are not yet, one row each with an amount per currency.
  const rows = new Map<string, VariantRow>();
  for (const price of prices) {
    const row = rows.get(price.variantId) ?? { variantId: price.variantId, title: price.title, options: price.options, sku: price.sku, amounts: new Map() };
    row.amounts.set(price.currency, price.amount);
    rows.set(price.variantId, row);
  }
  const fresh = found.filter((variant) => !rows.has(variant.variantId));
  const priced = [...rows.values()];
  const shown = [...priced, ...fresh.map((variant) => ({ ...variant, amounts: new Map<string, string>() }))];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `${base}/price-lists`, label: words.back }}
        title={<>{list.name}</>}
        description={list.active ? fillWords(words.summary, { pricing: pricingLine(list, words), forWhom: forWhomLine(list, words) }) : words.summaryOff}
      />

      <Card title={words.settings} className="flex flex-col gap-3">
        <ActionForm action={savePriceListAction.bind(null, store.slug, list.id)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.name}
            <input name="name" required maxLength={80} defaultValue={list.name} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.percent}
            <input name="percent" inputMode="numeric" pattern="[0-9]{1,2}" defaultValue={list.percent ?? ""} className={`${control} w-32`} />
            <span className="font-normal text-muted">{words.percentHint}</span>
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="active" defaultChecked={list.active} className="size-4" />
            {words.switchedOn}
          </label>
          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="exclusive" defaultChecked={list.exclusive} className="mt-0.5 size-4" />
            <span>
              {words.exclusive}
              <span className="block text-muted">{words.exclusiveHint}</span>
            </span>
          </label>
          <p className="text-sm text-muted">{words.kept}</p>
          <div>
            <SubmitButton>{words.save}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card title={words.who} description={words.whoHint} className="flex flex-col gap-3">
        <ActionForm action={saveAssignmentsAction.bind(null, store.slug, list.id)} className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{words.groups}</legend>
            {tiers.length === 0 ? (
              <p className="text-sm text-muted">{words.noGroups}</p>
            ) : (
              <div className={tickBox}>
                {tiers.map((tier) => (
                  <label key={tier.id} className="flex items-center gap-2">
                    <input type="checkbox" name="tier" value={tier.id} defaultChecked={targets.tierIds.includes(tier.id)} className="size-4" />
                    {tier.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <fieldset className="flex flex-col gap-2">
            <legend className="text-sm font-medium">{words.companies}</legend>
            {companies.length === 0 ? (
              <p className="text-sm text-muted">{words.noCompanies}</p>
            ) : (
              <div className={tickBox}>
                {companies.map((company) => (
                  <label key={company.id} className="flex items-center gap-2">
                    <input type="checkbox" name="company" value={company.id} defaultChecked={targets.companyIds.includes(company.id)} className="size-4" />
                    {company.name}
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div>
            <SubmitButton variant="secondary">{words.saveWho}</SubmitButton>
          </div>
        </ActionForm>
      </Card>

      {(list.percent !== null || list.exclusive) && (
        <Card title={words.scope} description={words.scopeHint} className="flex flex-col gap-3">
          <ActionForm action={saveScopeAction.bind(null, store.slug, list.id)} className="flex flex-col gap-4">
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{words.categories}</legend>
              {categories.length === 0 ? (
                <p className="text-sm text-muted">{words.noCategories}</p>
              ) : (
                <div className={tickBox}>
                  {categories.map((term) => (
                    <label key={term.id} className="flex items-center gap-2">
                      <input type="checkbox" name="term" value={term.id} defaultChecked={targets.termIds.includes(term.id)} className="size-4" />
                      {term.name}
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
            <fieldset className="flex flex-col gap-2">
              <legend className="text-sm font-medium">{words.products}</legend>
              <div className={tickBox}>
                {products.map((product) => (
                  <label key={product.id} className="flex items-center gap-2">
                    <input type="checkbox" name="product" value={product.id} defaultChecked={targets.productIds.includes(product.id)} className="size-4" />
                    {product.title}
                  </label>
                ))}
              </div>
            </fieldset>
            <div>
              <SubmitButton variant="secondary">{words.saveScope}</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      <Card title={words.prices} description={words.pricesHint} className="flex flex-col gap-3">
        <form method="get" className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.find}
            <input type="search" name="find" defaultValue={find} maxLength={80} className={`${control} min-w-64`} />
          </label>
          <button type="submit" className="min-h-10 rounded-pill border border-edge bg-card px-4 text-sm">
            {words.findButton}
          </button>
        </form>
        {find !== "" && found.length === 0 && <p className="text-sm text-muted">{words.nothingFound}</p>}
        {shown.length === 0 ? (
          <p className="text-sm text-muted">{words.noPrices}</p>
        ) : (
          <ActionForm action={savePricesAction.bind(null, store.slug, list.id)} className="flex flex-col gap-3">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line">
                    <th scope="col" className="py-2 pr-4 font-medium">{words.variant}</th>
                    {currencies.map((currency) => (
                      <th key={currency} scope="col" className="py-2 pr-4 font-medium">{currency}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((row, index) => {
                    const label = [row.title, ...Object.values(row.options)].join(" · ");
                    return (
                      <tr key={row.variantId} className={`border-b border-line last:border-0 ${index === priced.length && priced.length > 0 ? "border-t-2 border-t-edge" : ""}`}>
                        <th scope="row" className="py-2 pr-4 font-normal">
                          {label}
                          <span className="block text-xs text-muted">{row.sku}{index >= priced.length ? ` · ${words.found}` : ""}</span>
                        </th>
                        {currencies.map((currency) => (
                          <td key={currency} className="py-2 pr-4">
                            <input
                              name={`price:${row.variantId}:${currency}`}
                              defaultValue={row.amounts.get(currency) ?? ""}
                              inputMode="decimal"
                              maxLength={20}
                              aria-label={`${label}, ${currency}`}
                              className={`${control} w-28 tabular-nums`}
                            />
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div>
              <SubmitButton>{words.savePrices}</SubmitButton>
            </div>
          </ActionForm>
        )}
        <p className="text-sm text-muted">{words.alsoGoods}</p>
      </Card>

      <Card title={words.delete} description={words.deleteHint} className="flex flex-col gap-3">
        <ActionForm action={deletePriceListAction.bind(null, store.slug, list.id)}>
          <SubmitButton variant="secondary">{words.deleteButton}</SubmitButton>
        </ActionForm>
      </Card>
    </div>
  );
}
