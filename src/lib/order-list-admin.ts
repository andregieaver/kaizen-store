/**
 * What the Orders page's screens need besides the parameters themselves (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2). Pure: no server import, so the view tests and the
 * client table read the same words and addresses. The list's state is its address (`src/lib/order-list.ts`); every link the screen draws is the address of a changed state, built
 * by `orderListHref()` from the state with the saved view taken out, because a state read from a view is already written out in full (an address that kept `view=` and dropped a
 * filter would bring the filter back from the view).
 */
import { BULK_MAX } from "./order-bulk";
import {
  DEFAULT_ORDER_LIST,
  expandShow,
  orderListHref,
  orderListQuery,
  type OrderListKey,
  type OrderListParams,
} from "./order-list";
import { formatMoney } from "./money";
import { ORDERS_COUNT_CAP } from "./order-limits";

/** The state with its saved view and cursor taken out: what every link of the page is made from. */
export const plainState = (params: OrderListParams): OrderListParams => ({ ...params, view: null, after: null });

/** What clearing one filter chip changes. */
export function chipChange(key: OrderListKey): Partial<OrderListParams> {
  switch (key) {
    case "q":
      return { q: "" };
    case "pay":
      return { pay: [], show: null };
    case "ship":
      return { ship: [], show: null };
    case "status":
      return { status: [] };
    case "tag":
      return { tag: [] };
    case "range":
      return { range: null };
    case "from":
    case "to":
      return { from: null, to: null, range: null };
    case "market":
      return { market: null };
    case "source":
      return { source: null };
    case "gift":
      return { gift: false };
    case "archived":
      return { archived: "no", show: null };
    default:
      return {};
  }
}

/** The address of the list with a filter cleared. A built-in view that stands for the filter (`show=to-send` for `ship`) is written out first, so clearing it really clears it. */
export function clearHref(base: string, params: OrderListParams, key: OrderListKey): string {
  const state = expandShow(plainState(params));
  return orderListHref(base, { ...state, show: null }, chipChange(key));
}

/** The address of a built-in view (*All*, *To send*, …): the list with nothing else chosen but the columns and the sort the person had. */
export function builtInHref(base: string, params: OrderListParams, show: OrderListParams["show"]): string {
  return orderListHref(base, { ...DEFAULT_ORDER_LIST, cols: params.cols, sort: params.sort }, { show });
}

/** The address of a saved view. */
export const viewHref = (base: string, id: string): string => `${base}?${new URLSearchParams({ view: id }).toString()}`;

/** The address of the page of the list that starts after a cursor (null: the first page). */
export const pageHref = (base: string, params: OrderListParams, after: string | null): string => orderListHref(base, plainState(params), { after });

/** The state's query without the cursor, for a server action that must read the list again ("select all matching", "save as view"): the server parses it again, it is never trusted. */
export const stateQuery = (params: OrderListParams): string => orderListQuery(plainState(params));

/** What the selection bar offers beside the ticked rows: the banner under the header box. */
export type SelectionBanner =
  | { kind: "none" }
  /** Every row of the page is ticked and more orders match, but the batch limit is not passed: offer to select them all. */
  | { kind: "offer"; matching: number }
  /** Every row of the page is ticked and more orders match than one batch can take. */
  | { kind: "too_many"; matching: number }
  | { kind: "all_matching"; matching: number };

export function selectionBanner(input: { pageRows: number; ticked: number; matching: number; capped: boolean; allMatching: boolean }): SelectionBanner {
  if (input.allMatching) return { kind: "all_matching", matching: input.matching };
  if (input.pageRows === 0 || input.ticked < input.pageRows) return { kind: "none" };
  if (input.matching <= input.pageRows && !input.capped) return { kind: "none" };
  if (input.capped || input.matching > BULK_MAX) return { kind: "too_many", matching: input.matching };
  return { kind: "offer", matching: input.matching };
}

/** "37 orders", or "10,000+ orders" when the count reached its cap. */
export function matchingText(count: number, capped: boolean): string {
  const noun = count === 1 && !capped ? "order" : "orders";
  return capped ? `${ORDERS_COUNT_CAP.toLocaleString("en")}+ ${noun}` : `${count.toLocaleString("en")} ${noun}`;
}

/** The packing slips of ticked orders: one document, at most 100, never more than the page. */
export const printHref = (slug: string, ids: readonly string[]): string => `/admin/${slug}/orders/packing-slips?ids=${ids.join(",")}`;
/** The pick list of the ticked orders (D174): what is still to send of them, by product. */
export const pickListHref = (slug: string, ids: readonly string[]): string => `/admin/${slug}/orders/pick-list?ids=${ids.join(",")}`;

/** A list row with the words the screen draws: the date in the store's own time zone and the total in the order's own currency (no sum across currencies is ever made on the page). */
export function tableRowsOf<T extends { placedAt: string; totalMinor: number; currency: string }>(
  rows: readonly T[],
  options: { locale: string; timeZone: string },
): (T & { placedText: string; totalText: string })[] {
  return rows.map((row) => ({
    ...row,
    placedText: new Date(row.placedAt).toLocaleString(options.locale, { dateStyle: "medium", timeStyle: "short", timeZone: options.timeZone }),
    totalText: formatMoney(row.totalMinor, row.currency, options.locale),
  }));
}
