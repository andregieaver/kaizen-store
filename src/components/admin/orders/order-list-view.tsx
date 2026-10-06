import Link from "next/link";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { matchingText, pageHref, stateQuery } from "@/lib/order-list-admin";
import { columnsOf, hasFilters, type OrderListParams } from "@/lib/order-list";

import { FilterBar } from "./filter-bar";
import { OrderTable, type OrderTableProps, type OrderTableRow } from "./order-table";
import { ViewBar, type ViewLink } from "./view-bar";
import { ViewTools, type ViewToolActions } from "./view-tools";

/**
 * The body of the Orders page (wave 3, D173, `docs/wave-3-orders.md` 2.2): the views, the search and filters, the filters that are on, the count, the table with its bulk bar and the
 * pages. Presentational: the page reads the list (`listOrdersPage()`) and passes it with the bound actions, so a test draws it from fixtures. The count and the paging links say
 * what the list holds; there are no page numbers (the list is paged by a cursor, so a boundary never loses or repeats an order).
 */
export function OrderListView({
  slug,
  params,
  rows,
  count,
  capped,
  hasPrevious,
  previousCursor,
  nextCursor,
  views,
  openView,
  ignoredInView,
  truncatedSearch,
  markets,
  tagSuggestions,
  canWrite,
  bulk,
  viewActions,
}: {
  slug: string;
  params: OrderListParams;
  rows: OrderTableRow[];
  count: number;
  capped: boolean;
  hasPrevious: boolean;
  previousCursor: string | null;
  nextCursor: string | null;
  views: ViewLink[];
  openView: ViewLink | null;
  /** Some of the open view's settings no longer mean anything (a market that went, a tag that is gone). */
  ignoredInView: boolean;
  truncatedSearch: boolean;
  markets: { code: string; name: string }[];
  tagSuggestions: string[];
  canWrite: boolean;
  bulk: OrderTableProps["bulk"];
  viewActions: ViewToolActions | null;
}) {
  const base = `/admin/${slug}/orders`;
  const filtered = hasFilters(params);
  return (
    <div className="flex flex-col gap-4">
      <ViewBar base={base} params={params} views={views} openViewId={openView?.id ?? null} />
      {openView && ignoredInView && (
        <p role="status" className="rounded-lg border border-border bg-surface p-3 text-sm">
          Some of the view “{openView.title}” settings no longer apply, so the list shows the rest.
        </p>
      )}
      <FilterBar base={base} params={params} markets={markets} tagSuggestions={tagSuggestions} />
      {truncatedSearch && <p className={hint}>Only the first 5 words of the search are used.</p>}
      {canWrite && viewActions && <ViewTools views={views} query={stateQuery(params)} actions={viewActions} />}

      <p className="text-sm text-muted" aria-live="polite">
        {matchingText(count, capped)}
        {params.archived === "all" ? " including archived" : ""}
      </p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-border bg-surface p-8 text-sm">
          <p>
            {params.q !== ""
              ? `No order matches “${params.q}”${filtered && params.q !== "" && (params.pay.length || params.ship.length || params.tag.length || params.status.length || params.range || params.from || params.to) ? " with these filters" : ""}.`
              : params.show === "unpaid" || params.pay.includes("unpaid")
                ? "No unfinished checkouts."
                : params.show === "waiting"
                  ? "No order is waiting for stock: nothing paid and not sent was sold on backorder."
                  : params.show === "to-send"
                    ? "Nothing to send: every paid order with something to ship has been sent."
                    : params.show === "archived"
                      ? "No archived orders."
                      : filtered
                        ? "No order matches these filters."
                        : "No orders yet. They appear here as soon as they are paid."}
          </p>
          {filtered ? (
            <Link href={base} className={secondary}>
              Clear the search and filters
            </Link>
          ) : (
            <Link href={`/admin/${slug}/orders/drafts/new`} className={primary}>
              Make a draft order
            </Link>
          )}
        </div>
      ) : (
        <OrderTable
          slug={slug}
          rows={rows}
          columns={columnsOf(params)}
          matching={count}
          capped={capped}
          matchingQuery={stateQuery(params)}
          canWrite={canWrite}
          suggestions={tagSuggestions}
          bulk={bulk}
        />
      )}

      {(hasPrevious || nextCursor) && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-4 text-sm">
          {hasPrevious && (
            <Link href={pageHref(base, params, previousCursor)} rel="prev" className="underline underline-offset-2">
              {previousCursor ? "Previous 50 orders" : "Back to the first page"}
            </Link>
          )}
          {nextCursor && (
            <Link href={pageHref(base, params, nextCursor)} rel="next" className="underline underline-offset-2">
              Next 50 orders
            </Link>
          )}
        </nav>
      )}

    </div>
  );
}
