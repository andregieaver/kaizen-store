import type { Metadata } from "next";
import Link from "next/link";

import { PickListView } from "@/components/admin/orders/pick-list-view";
import { PrintButton } from "@/components/admin/print-button";
import { PICK_LIST_MAX } from "@/lib/fulfilment-limits";
import { parsePickParams, PICK_BY, PICK_SORTS, type PickBy, type PickSort } from "@/lib/pick-list";
import { requirePermission } from "@/server/permissions";
import { pickListData } from "@/server/pick-list";

export const metadata: Metadata = { title: "Pick list" };

const one = (value: string | string[] | undefined): string | null => (Array.isArray(value) ? value.join(",") : (value ?? null));

const BY_WORDS: Record<PickBy, string> = { product: "By product", order: "By order" };
const SORT_WORDS: Record<PickSort, string> = { sku: "SKU", title: "Title", quantity: "Most units first" };

/**
 * The pick list of the orders ticked on the orders page (wave 3, run 3, D174, `docs/wave-3-fulfilment.md` 2.3): at most 100, the units still to send summed by product or
 * listed by order, no prices, names or addresses. `orders:read`; it changes nothing. Ids that are not this store's orders are listed as not found and nothing of them is read.
 */
export default async function PickListPage({ params, searchParams }: PageProps<"/admin/[store]/orders/pick-list">) {
  const { store: slug } = await params;
  const { store } = await requirePermission(slug, "orders:read");
  const query = await searchParams;
  const parsed = parsePickParams({ ids: one(query.ids), by: one(query.by), sort: one(query.sort) });
  const back = (
    <Link href={`/admin/${store.slug}/orders`} className="text-sm underline underline-offset-2">
      Back to the orders
    </Link>
  );
  if (!parsed.ok) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Pick list</h1>
        <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-sm">
          {parsed.problem === "none" ? "Tick the orders to pick on the orders page, then choose Print pick list." : `A pick list takes at most ${PICK_LIST_MAX} orders. Tick fewer.`}
        </p>
        {back}
      </div>
    );
  }
  const data = await pickListData(store.id, parsed.ids, { by: parsed.by, sort: parsed.sort });
  if (!data.ok) {
    return (
      <div className="flex flex-col gap-3">
        <h1 className="text-2xl font-semibold">Pick list</h1>
        <p role="alert" className="rounded-lg border border-border bg-surface p-4 text-sm">
          {data.problem === "too_many" ? `A pick list takes at most ${PICK_LIST_MAX} orders. Tick fewer.` : "Tick the orders to pick on the orders page."}
        </p>
        {back}
      </div>
    );
  }
  const href = (change: { by?: PickBy; sort?: PickSort }) => {
    const next = new URLSearchParams({ ids: parsed.ids.join(","), by: change.by ?? parsed.by, sort: change.sort ?? parsed.sort });
    return `/admin/${store.slug}/orders/pick-list?${next.toString()}`;
  };
  const choice = (active: boolean) => `rounded-md border px-3 py-1.5 text-sm ${active ? "border-foreground bg-foreground text-background" : "border-border bg-background"}`;
  return (
    <div className="flex flex-col gap-4">
      {/* Only the list itself is printed. */}
      <style>{"@media print { body > *:not(main), header, nav { display: none !important } main { padding: 0 !important } }"}</style>
      <div className="flex flex-col gap-3 print:hidden">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold">Pick list</h1>
          {data.list.orderCount > 0 && <PrintButton label="Print the pick list" />}
        </div>
        <nav aria-label="How the list is laid out" className="flex flex-wrap items-center gap-2">
          {PICK_BY.map((by) => (
            <Link key={by} href={href({ by })} aria-current={parsed.by === by ? "page" : undefined} className={choice(parsed.by === by)}>
              {BY_WORDS[by]}
            </Link>
          ))}
          <span className="ml-2 text-sm text-muted">Sort:</span>
          {PICK_SORTS.map((sort) => (
            <Link key={sort} href={href({ sort })} aria-current={parsed.sort === sort ? "page" : undefined} className={choice(parsed.sort === sort)}>
              {SORT_WORDS[sort]}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-muted">What is still to send of the orders you ticked. It changes nothing: mark the orders as sent when they are packed.</p>
        {back}
      </div>
      <PickListView list={data.list} />
    </div>
  );
}
