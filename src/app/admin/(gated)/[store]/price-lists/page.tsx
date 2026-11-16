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
/** Lists most shops make (round 25), each filling the form with its name and percentage; nothing is saved until Make price list. */
const READY = { retailers: 20, wholesale: 35, staff: 30 } as const;
type ReadyKey = keyof typeof READY;

export default async function PriceListsPage({ params, searchParams }: PageProps<"/admin/[store]/price-lists">) {
  const gated = await requirePermission((await params).store, "customers:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const words = adminText(adminLangOf(gated.account.adminLocale), "customers").priceLists;
  const lists = await listPriceLists(store.id);
  const base = `/admin/${store.slug}`;
  const asked = (await searchParams).ready;
  const ready = typeof asked === "string" && asked in READY ? (asked as ReadyKey) : null;

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={words.title} description={lists.length === 0 ? words.noneLead : words.description} />

      {lists.length === 0 ? (
        // Round 25 (D693): with none yet, the lists most shops make, each filling the form below; Write your own goes straight to it.
        <section aria-labelledby="ready" className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="ready" className="text-body-strong text-ink">{words.readyTitle}</h2>
            <a href="#new-list" className="inline-flex min-h-10 items-center rounded-pill border border-edge bg-card px-4 text-sm hover:bg-sunken">{words.writeOwn}</a>
          </div>
          <ul className="grid gap-3 sm:grid-cols-3">
            {(Object.keys(READY) as ReadyKey[]).map((key, i) => (
              <li key={key} className={`flex flex-col gap-1.5 p-4 ${CARD_CLASS}`}>
                <span className="self-start rounded bg-sunken px-2 py-0.5 font-mono text-caption">−{READY[key]} %</span>
                <span className="text-body text-ink">{words.ready[key].name}</span>
                <span className="text-caption text-ink-2">{words.ready[key].sub}</span>
                <Link
                  href={`?ready=${key}#new-list`}
                  className={`mt-1 inline-flex min-h-10 items-center self-start rounded-pill px-4 text-sm font-medium ${i === 0 ? "bg-brand text-brand-ink" : "border border-edge bg-card text-ink"}`}
                >
                  {words.makeIt}
                </Link>
              </li>
            ))}
          </ul>
        </section>
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

      <div id="new-list" className="scroll-mt-4">
      <Card title={words.newList} className="flex max-w-xl flex-col gap-3" compact>
        <ActionForm key={ready ?? "own"} action={savePriceListAction.bind(null, store.slug, null)} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.name}
            <input name="name" required maxLength={80} placeholder={words.namePlaceholder} defaultValue={ready ? words.ready[ready].name : undefined} className={control} />
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            {words.percent}
            <input name="percent" inputMode="numeric" pattern="[0-9]{1,2}" placeholder="20" defaultValue={ready ? String(READY[ready]) : undefined} className={`${control} w-32`} />
            <span className="font-normal text-muted">{words.percentHint}</span>
          </label>
          <div>
            <SubmitButton>{words.make}</SubmitButton>
          </div>
        </ActionForm>
        {lists.length === 0 && <p className="text-caption text-muted">{words.description}</p>}
      </Card>
      </div>
    </div>
  );
}
