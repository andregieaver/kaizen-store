import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePermission } from "@/server/permissions";
import { forWhomLine, pricingLine } from "@/lib/price-lists";
import { listPriceLists } from "@/server/price-lists";
import { Card, CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { savePriceListAction } from "./actions";

export const metadata: Metadata = { title: "Price lists" };

const control = "min-h-10 rounded-md border border-line bg-card px-3 font-normal";

/**
 * Price lists (wave 6 unit C1, D321): prices of their own for customer groups and companies, a percentage off the market price, fixed prices,
 * or both. A buyer pays the lowest their lists give, never above the market price (`commerce.buyer_price()`).
 */
export default async function PriceListsPage({ params }: PageProps<"/admin/[store]/price-lists">) {
  const gated = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const words = adminText(adminLangOf(gated.account.adminLocale), "customers").priceLists;
  const lists = await listPriceLists(store.id);
  const base = `/admin/${store.slug}`;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={words.title} description={words.description} />

      {lists.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>{words.none}</p>
      ) : (
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.list}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.pricing}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.forWhom}</th>
                <th scope="col" className="px-4 py-2 font-medium">{words.columns.status}</th>
              </tr>
            </thead>
            <tbody>
              {lists.map((list) => (
                <tr key={list.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2">
                    <Link href={`${base}/price-lists/${list.id}`} className="font-medium underline-offset-2 hover:underline">
                      {list.name}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{pricingLine(list, words)}</td>
                  <td className="px-4 py-2">{forWhomLine(list, words)}</td>
                  <td className="px-4 py-2">
                    {list.active ? words.active : words.switchedOff}
                    {list.exclusive && <span className="block text-xs text-muted">{words.exclusiveShort}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Card title={words.newList} className="flex max-w-xl flex-col gap-3" compact>
        <ActionForm action={savePriceListAction.bind(null, store.slug, null)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.name}
            <input name="name" required maxLength={80} placeholder={words.namePlaceholder} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.percent}
            <input name="percent" inputMode="numeric" pattern="[0-9]{1,2}" placeholder="20" className={`${control} w-32`} />
            <span className="font-normal text-muted">{words.percentHint}</span>
          </label>
          <div>
            <SubmitButton>{words.make}</SubmitButton>
          </div>
        </ActionForm>
      </Card>
    </div>
  );
}
