import Link from "next/link";

import { builtInHref, viewHref } from "@/lib/order-list-admin";
import { BUILT_IN_VIEWS, type OrderListParams } from "@/lib/order-list";

export type ViewLink = { id: string; title: string };

const tab = "rounded-md px-3 py-1.5 text-sm text-muted hover:text-foreground aria-[current=page]:bg-background aria-[current=page]:font-semibold aria-[current=page]:text-foreground";

/**
 * The views above the list (wave 3, D173, `docs/wave-3-orders.md` 2.2.4): the built-in ones (All, To send, Waiting for stock, Unfinished checkouts, Archived), then the store's saved
 * views in their order. Links, so they work without a script and a view can be bookmarked. A built-in view is the current one when it is the only thing chosen: a state that adds
 * filters to it is no longer that view.
 */
export function ViewBar({ base, params, views, openViewId }: { base: string; params: OrderListParams; views: ViewLink[]; openViewId: string | null }) {
  const onlyShow = (show: OrderListParams["show"]) => openViewId === null && params.show === show && noFilters(params);
  return (
    <nav aria-label="Order views" className="flex flex-wrap items-center gap-1 border-b border-border pb-2">
      {BUILT_IN_VIEWS.map((view) => (
        <Link key={view.label} href={builtInHref(base, params, view.show)} aria-current={onlyShow(view.show) ? "page" : undefined} className={tab}>
          {view.label}
        </Link>
      ))}
      {views.length > 0 && <span className="mx-1 h-5 w-px bg-border" aria-hidden="true" />}
      {views.map((view) => (
        <Link key={view.id} href={viewHref(base, view.id)} aria-current={openViewId === view.id ? "page" : undefined} className={tab}>
          {view.title}
        </Link>
      ))}
    </nav>
  );
}

/** Whether the state holds no filter besides the built-in view itself (a search, a tag, a date range or a payment choice make it a different list). */
function noFilters(params: OrderListParams): boolean {
  return (
    params.q === "" && params.pay.length === 0 && params.ship.length === 0 && params.status.length === 0 && params.tag.length === 0 &&
    !params.from && !params.to && !params.range && !params.market && !params.source && !params.gift && params.archived === "no"
  );
}
