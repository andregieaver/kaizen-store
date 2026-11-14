import { AdminLink } from "../ui/link";
import { MoreMenu } from "./order-folds";

import { ordersEn, type OrdersMessages } from "@/lib/admin-messages/orders.en";
import { builtInHref, viewHref } from "@/lib/order-list-admin";
import { BUILT_IN_VIEWS, type OrderListParams } from "@/lib/order-list";

export type ViewLink = { id: string; title: string };


/**
 * The views above the list (wave 3, D173, `docs/wave-3-orders.md` 2.2.4): the built-in ones (All, To send, Waiting for stock, Unfinished checkouts, Archived), then the store's saved
 * views in their order. Links, so they work without a script and a view can be bookmarked. A built-in view is the current one when it is the only thing chosen: a state that adds
 * filters to it is no longer that view.
 */
export function ViewBar({
  base,
  params,
  views,
  openViewId,
  toSend = 0,
  words: w = ordersEn.views,
}: {
  base: string;
  params: OrderListParams;
  views: ViewLink[];
  openViewId: string | null;
  /** How many orders wait to be sent: counted on the To send tab (round 2, D597). */
  toSend?: number;
  /** The `orders` catalogue's `views` words in the account's language (D312 A4). */
  words?: OrdersMessages["views"];
}) {
  const onlyShow = (show: OrderListParams["show"]) => openViewId === null && params.show === show && noFilters(params);
  // Round 2 (D597): the bare address opens on To send while something waits, so All has an address of its own.
  const hrefOf = (show: OrderListParams["show"]) => {
    const href = builtInHref(base, params, show);
    return show === null && href === base ? `${base}?show=all` : href;
  };
  const first = (["to-send", null] as const).flatMap((show) => BUILT_IN_VIEWS.filter((view) => view.show === show));
  const rest = BUILT_IN_VIEWS.filter((view) => view.show !== "to-send" && view.show !== null);
  const restOpen = rest.find((view) => onlyShow(view.show)) ?? null;
  const savedOpen = views.find((view) => view.id === openViewId) ?? null;
  return (
    <nav aria-label={w.label} className="flex flex-wrap items-center gap-2">
      <div className="flex gap-0.5 rounded-pill bg-card p-[3px] dark:ring-1 dark:ring-line">
        {first.map((view) => (
          <AdminLink key={view.label} href={hrefOf(view.show)} aria-current={onlyShow(view.show) ? "page" : undefined} className={pill}>
            {w.builtIn[view.show ?? "all"]}
            {view.show === "to-send" && toSend > 0 && (
              <span className="inline-flex min-w-5 items-center justify-center rounded-pill bg-warning-solid px-1.5 text-[11px] leading-5 text-ink tabular-nums">{toSend}</span>
            )}
          </AdminLink>
        ))}
        {(restOpen || savedOpen) && (
          <span aria-current="page" className={`${pill} bg-inverse text-inverse-ink`}>
            {restOpen ? w.builtIn[restOpen.show ?? "all"] : savedOpen?.title}
          </span>
        )}
      </div>
      <MoreMenu label={w.moreViews}>
        {rest.map((view) => (
          <AdminLink key={view.label} href={hrefOf(view.show)} aria-current={onlyShow(view.show) ? "page" : undefined} className={menuItem}>
            {w.builtIn[view.show ?? "all"]}
          </AdminLink>
        ))}
        {views.length > 0 && <span className="my-1 h-px bg-line" aria-hidden="true" />}
        {views.map((view) => (
          <AdminLink key={view.id} href={viewHref(base, view.id)} aria-current={openViewId === view.id ? "page" : undefined} className={menuItem}>
            {view.title}
          </AdminLink>
        ))}
      </MoreMenu>
    </nav>
  );
}

const pill = "inline-flex h-9 items-center gap-2 rounded-pill px-4 text-sm text-ink-2 hover:text-ink aria-[current=page]:bg-inverse aria-[current=page]:text-inverse-ink";
const menuItem = "flex min-h-10 items-center rounded-panel px-3 text-sm text-ink hover:bg-sunken aria-[current=page]:font-medium aria-[current=page]:bg-sunken";

/** Whether the state holds no filter besides the built-in view itself (a search, a tag, a date range or a payment choice make it a different list). */
function noFilters(params: OrderListParams): boolean {
  return (
    params.q === "" && params.pay.length === 0 && params.ship.length === 0 && params.status.length === 0 && params.tag.length === 0 &&
    !params.from && !params.to && !params.range && !params.market && !params.source && !params.gift && params.archived === "no"
  );
}
