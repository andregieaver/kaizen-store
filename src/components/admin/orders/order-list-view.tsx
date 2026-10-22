import Link from "next/link";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { ordersEn, type OrdersMessages } from "@/lib/admin-messages/orders.en";
import { pageHref, stateQuery } from "@/lib/order-list-admin";
import { matchingWords } from "@/lib/order-list-words";
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
  words = ordersEn,
  statusWords,
  locale = "en",
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
  /** The `orders` catalogue in the account's language (D312 A4), and its number format. */
  words?: OrdersMessages;
  statusWords?: OrderTableProps["statusWords"];
  locale?: string;
}) {
  const w = words.list;
  const base = `/admin/${slug}/orders`;
  const filtered = hasFilters(params);
  return (
    <div className="flex flex-col gap-4">
      <ViewBar base={base} params={params} views={views} openViewId={openView?.id ?? null} words={words.views} />
      {openView && ignoredInView && (
        <p role="status" className="rounded-panel bg-sunken p-3 text-sm">
          {fillWords(words.views.ignored, { title: openView.title })}
        </p>
      )}
      <FilterBar base={base} params={params} markets={markets} tagSuggestions={tagSuggestions} words={words.filters} columnWords={words.table.columns} />
      {truncatedSearch && <p className={hint}>{w.truncated}</p>}
      {canWrite && viewActions && <ViewTools views={views} query={stateQuery(params)} actions={viewActions} words={words.saved} />}

      <p className="text-sm text-muted" aria-live="polite">
        {matchingWords(count, capped, w, locale)}
        {params.archived === "all" ? w.includingArchived : ""}
      </p>

      {rows.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-panel bg-sunken p-8 text-sm">
          <p>
            {params.q !== ""
              ? fillWords(w.noMatch, {
                  q: params.q,
                  filters: filtered && params.q !== "" && (params.pay.length || params.ship.length || params.tag.length || params.status.length || params.range || params.from || params.to) ? w.withFilters : "",
                })
              : params.show === "unpaid" || params.pay.includes("unpaid")
                ? w.noUnfinished
                : params.show === "waiting"
                  ? w.noWaiting
                  : params.show === "to-send"
                    ? w.noToSend
                    : params.show === "archived"
                      ? w.noArchived
                      : filtered
                        ? w.noFilterMatch
                        : w.none}
          </p>
          {filtered ? (
            <Link href={base} className={secondary}>
              {w.clear}
            </Link>
          ) : (
            <Link href={`/admin/${slug}/orders/drafts/new`} className={primary}>
              {words.page.makeDraft}
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
          words={words}
          statusWords={statusWords}
          locale={locale}
        />
      )}

      {(hasPrevious || nextCursor) && (
        <nav aria-label={w.pages} className="flex flex-wrap items-center gap-4 text-sm">
          {hasPrevious && (
            <Link href={pageHref(base, params, previousCursor)} rel="prev" className="underline underline-offset-2">
              {previousCursor ? w.previous : w.first}
            </Link>
          )}
          {nextCursor && (
            <Link href={pageHref(base, params, nextCursor)} rel="next" className="underline underline-offset-2">
              {w.next}
            </Link>
          )}
        </nav>
      )}

    </div>
  );
}
