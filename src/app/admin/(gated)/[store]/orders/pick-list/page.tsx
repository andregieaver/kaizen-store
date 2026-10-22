import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { PickListView } from "@/components/admin/orders/pick-list-view";
import { PrintArea } from "@/components/admin/print-area";
import { PrintButton } from "@/components/admin/print-button";
import { PICK_LIST_MAX } from "@/lib/fulfilment-limits";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { parsePickParams, PICK_BY, PICK_SORTS, type PickBy, type PickSort } from "@/lib/pick-list";
import { requirePermission } from "@/server/permissions";
import { pickListData } from "@/server/pick-list";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Pick list" };

const one = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value.join(",") : (value ?? null));


/**
 * The pick list of the orders ticked on the orders page (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3): at most 100, the units still to send summed by product or
 * listed by order, no prices, names or addresses. `orders:read`; it changes nothing. Ids that are not this store's orders are listed as not found and nothing of them is read.
 */
export default async function PickListPage({ params, searchParams }: PageProps<"/admin/[store]/orders/pick-list">) {
  const { store: slug } = await params;
  const gated = await requirePermission(slug, "orders:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const w = adminText(adminLangOf(gated.account.adminLocale), "orders").pick;
  const query = await searchParams;
  const parsed = parsePickParams({ ids: one(query.ids), by: one(query.by), sort: one(query.sort) });
  const back = (
    <Link href={`/admin/${store.slug}/orders`} className="text-sm underline underline-offset-2">
      {w.back}
    </Link>
  );
  if (!parsed.ok) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={w.title} />
        <p role="alert" className="rounded-panel bg-sunken p-4 text-sm">
          {parsed.problem === "none" ? w.tickFirst : fillWords(w.atMost, { max: PICK_LIST_MAX })}
        </p>
        {back}
      </div>
    );
  }
  const data = await pickListData(store.id, parsed.ids, { by: parsed.by, sort: parsed.sort });
  if (!data.ok) {
    return (
      <div className="flex flex-col gap-3">
        <PageHeader title={w.title} />
        <p role="alert" className="rounded-panel bg-sunken p-4 text-sm">
          {data.problem === "too_many" ? fillWords(w.atMost, { max: PICK_LIST_MAX }) : w.tickOnPage}
        </p>
        {back}
      </div>
    );
  }
  const href = (change: { by?: PickBy; sort?: PickSort }) => {
    const next = new URLSearchParams({ ids: parsed.ids.join(","), by: change.by ?? parsed.by, sort: change.sort ?? parsed.sort });
    return `/admin/${store.slug}/orders/pick-list?${next.toString()}`;
  };
  const choice = (active: boolean) => `rounded-md border px-3 py-1.5 text-sm ${active ? "border-brand bg-brand text-brand-ink" : "border-line bg-card"}`;
  return (
    <PrintArea className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <PageHeader title={w.title} />
          {data.list.orderCount > 0 && <PrintButton label={w.print} />}
        </div>
        <nav aria-label={w.layout} className="flex flex-wrap items-center gap-2">
          {PICK_BY.map((by) => (
            <Link key={by} href={href({ by })} aria-current={parsed.by === by ? "page" : undefined} className={choice(parsed.by === by)}>
              {w.by[by]}
            </Link>
          ))}
          <span className="ml-2 text-sm text-muted">{w.sortLabel}</span>
          {PICK_SORTS.map((sort) => (
            <Link key={sort} href={href({ sort })} aria-current={parsed.sort === sort ? "page" : undefined} className={choice(parsed.sort === sort)}>
              {w.sorts[sort]}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted">{w.intro}</p>
        {back}
      </div>
      <PickListView list={data.list} words={w} />
    </PrintArea>
  );
}
