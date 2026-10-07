import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/db/client";
import {
  cursorFor,
  readViewRecord,
  resolveOrderListParams,
  type OrderListInput,
  type OrderListKey,
  type OrderListParams,
  readOrderListParams,
} from "@/lib/order-list";
import { payCellOf, shipCellOf, type OrderListItem, type OrderStatusValue } from "@/lib/order-list-row";
import { ORDERS_COUNT_CAP, ORDERS_PAGE_SIZE } from "@/lib/order-limits";
import { searchWords } from "@/lib/order-search";
import { minorUnitDigits } from "@/lib/money";

import {
  CAPTURED_SQL,
  PHYSICAL_SQL,
  REFUNDED_SQL,
  keysetAfter,
  orderListOrderBy,
  orderListOrderByReversed,
  orderListWhere,
  totalKey,
  valueFactors,
  type OrderListContext,
} from "./order-list-sql";
import { tagsForOrders } from "./order-tags";
import { getOrderView } from "./order-views";

type Row = Record<string, unknown>;

/**
 * The Orders page's reads (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2). The page's state is its address, read by ONE parser (`parseOrderListParams()` and
 * `readOrderListParams()`), made into SQL by ONE builder (`orderListWhere()`); this file runs the statements: a page of rows (keyset paging on the sort key and the id,
 * 50 a page), a bounded count, the page before, and "every order that matches" for a bulk action, which is never a list the browser sent. Every statement names the store.
 */

/** The store's own days and markets, read once for a request. */
export async function loadOrderListContext(storeId: string): Promise<OrderListContext> {
  const [row] = await db().execute<Row>(sql`
    select s.time_zone, (now() at time zone s.time_zone)::date::text as today,
      coalesce((select array_agg(m.code order by m.code) from commerce.markets m where m.store_id = s.id), '{}') as markets
    from commerce.stores s where s.id = ${storeId}::uuid
  `);
  const currencies = await db().execute<Row>(sql`select currency, rate from commerce.store_currencies where store_id = ${storeId}::uuid`);
  return {
    timeZone: String(row?.time_zone ?? "Europe/Oslo"),
    today: String(row?.today ?? new Date().toISOString().slice(0, 10)),
    marketCodes: ((row?.markets ?? []) as string[]).map((code) => String(code).trim()),
    totalFactors: valueFactors(currencies.map((c) => ({ currency: String(c.currency).trim(), rate: c.rate === null || c.rate === undefined ? null : Number(c.rate), digits: minorUnitDigits(String(c.currency).trim()) }))),
  };
}

export type ResolvedList = {
  params: OrderListParams;
  context: OrderListContext;
  /** The saved view that was opened, when the address names one the store has. */
  view: { id: string; title: string } | null;
  /** The keys of the address, or of the view, that no longer mean anything: the page says "Some of this view's settings no longer apply". */
  ignored: OrderListKey[];
  /** The search had more words than are used. */
  truncatedSearch: boolean;
};

/**
 * The state of the list from its address. A saved view in the address (`view=`) is the store's own: its parameters are read again by the one parser (so a market that went
 * or a key that no longer exists is dropped, and reported), applied first, and the address overrides them. A view id that is not this store's finds nothing. A market that is not one of the store's is ignored.
 */
export async function resolveOrderList(storeId: string, input: OrderListInput): Promise<ResolvedList> {
  const [context, address] = [await loadOrderListContext(storeId), readOrderListParams(input)];
  const ignored: OrderListKey[] = [...address.ignored];
  let view: ResolvedList["view"] = null;
  let viewPresent: Partial<OrderListParams> | null = null;
  let viewColumns: OrderListParams["cols"] = null;
  if (address.present.view) {
    const found = await getOrderView(storeId, address.present.view);
    if (found) {
      view = { id: found.id, title: found.title };
      const read = readViewRecord(found.params);
      viewPresent = read.present;
      ignored.push(...read.ignored);
      viewColumns = found.columns && found.columns.length > 0 ? readOrderListParams({ cols: found.columns.join(",") }).present.cols ?? null : null;
    } else ignored.push("view");
  }
  const merged = resolveOrderListParams(address.present, viewPresent ? { ...viewPresent, cols: viewPresent.cols ?? viewColumns ?? undefined } : null);
  const params: OrderListParams = view ? { ...merged, view: view.id } : { ...merged, view: null };
  if (params.market && !context.marketCodes.includes(params.market)) {
    ignored.push("market");
    params.market = null;
  }
  return { params, context, view, ignored: [...new Set(ignored)], truncatedSearch: searchWords(params.q).truncated };
}

export type OrderListPage = {
  rows: OrderListItem[];
  /** How many orders match, up to the cap; `capped` when there are more than that (the page says "10,000+"). */
  count: number;
  capped: boolean;
  /** The cursor of the next page, or null on the last. */
  nextCursor: string | null;
  /** Whether there is a page before this one, and the cursor that opens it (null: the first page, which has no cursor). */
  hasPrevious: boolean;
  previousCursor: string | null;
};

const selectRow = (context: Pick<OrderListContext, "totalFactors">) => sql`
  o.id, o.number, o.status, o.placed_at, o.placed_at::text as placed_key, o.total_minor, ${totalKey(context)} as total_key, o.currency, o.market_code,
  o.copied_from is not null as copied, o.archived_at is not null as archived, o.source, d.number as draft_number, o.is_gift,
  (o.restricted_at is not null or o.anonymised_at is not null) as erased, o.email,
  coalesce(nullif(o.shipping_address ->> 'name', ''), nullif(o.billing_address ->> 'name', '')) as name,
  (select coalesce(sum(l.quantity), 0)::int from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id) as items,
  (case when o.status = 'paid' and o.copied_from is null then (select coalesce(sum(least(l.backorder_quantity, commerce.line_to_send(l.id))), 0)::int from commerce.order_lines l where l.store_id = o.store_id and l.order_id = o.id and l.backorder_quantity > 0) else 0 end) as owed,
  exists (select 1 from commerce.shipments sh where sh.store_id = o.store_id and sh.order_id = o.id) as has_parcel, o.edited_at is not null as edited,
  exists (select 1 from commerce.order_edits e where e.store_id = o.store_id and e.order_id = o.id and e.status = 'awaiting_payment') as edit_pending,
  ${PHYSICAL_SQL} as physical, ${CAPTURED_SQL} as captured, ${REFUNDED_SQL} as refunded, o.balance_minor
`;

function toItem(row: Row, tags: ReadonlyMap<string, { key: string; label: string }[]>): OrderListItem {
  const erased = Boolean(row.erased);
  const status = row.status as OrderStatusValue;
  const copied = Boolean(row.copied);
  const owed = Number(row.owed ?? 0);
  return {
    id: String(row.id),
    number: String(row.number),
    status,
    placedAt: new Date(String(row.placed_at)).toISOString(),
    totalMinor: Number(row.total_minor),
    currency: String(row.currency),
    marketCode: String(row.market_code).trim(),
    copied,
    archived: Boolean(row.archived),
    source: row.source === "draft" ? "draft" : "checkout",
    draftNumber: row.draft_number ? String(row.draft_number) : null,
    gift: Boolean(row.is_gift),
    erased,
    // An erased person is never shown (D162): the number, the date, the status and the total are what is left of the order's face.
    email: erased || !row.email ? null : String(row.email),
    name: erased || !row.name ? null : String(row.name),
    items: Number(row.items),
    owed,
    tags: tags.get(String(row.id)) ?? [],
    pay: payCellOf({ status, copied, capturedMinor: Number(row.captured), refundedMinor: Number(row.refunded), balanceMinor: Number(row.balance_minor ?? 0) }),
    ship: shipCellOf({ status, copied, physical: Boolean(row.physical), backorderUnits: owed, partlySent: Boolean(row.has_parcel) }),
    balanceMinor: Number(row.balance_minor ?? 0),
    edited: Boolean(row.edited),
    editPending: Boolean(row.edit_pending),
  };
}

/** The key a cursor carries for a row: the timestamp as Postgres prints it, or the total's sort value (in hundredths of the rates' reference currency when the store sells in several, else the total itself). */
const cursorOfRow = (params: OrderListParams, row: Row): string =>
  cursorFor(params.sort, params.sort === "total_asc" || params.sort === "total_desc" ? String(row.total_key) : String(row.placed_key), String(row.id));

/** Counts the orders a list matches, up to the cap (one more than the cap says there are more). */
export async function countOrders(storeId: string, params: OrderListParams, context: OrderListContext): Promise<{ count: number; capped: boolean }> {
  const [row] = await db().execute<Row>(sql`
    select count(*)::int as n from (select 1 from commerce.orders o where ${orderListWhere(storeId, params, context)} limit ${ORDERS_COUNT_CAP + 1}) matching
  `);
  const n = Number(row?.n ?? 0);
  return { count: Math.min(n, ORDERS_COUNT_CAP), capped: n > ORDERS_COUNT_CAP };
}

/** One page of the list, its count and its neighbours. The page size is 50; the rows after `params.after`. */
export async function listOrdersPage(storeId: string, params: OrderListParams, context: OrderListContext, pageSize = ORDERS_PAGE_SIZE): Promise<OrderListPage> {
  const where = orderListWhere(storeId, params, context);
  const after = keysetAfter(params.sort, params.after, context);
  // An invalid cursor is the first page: nothing before it either.
  const paged = after !== null;
  const rows = await db().execute<Row>(sql`
    select ${selectRow(context)}
    from commerce.orders o
    left join commerce.draft_orders d on d.store_id = o.store_id and d.id = o.draft_id
    where ${where} ${after ? sql`and ${after}` : sql``}
    order by ${orderListOrderBy(params.sort, context)}
    limit ${pageSize + 1}
  `);
  const hasNext = rows.length > pageSize;
  const pageRows = rows.slice(0, pageSize);
  const tags = await tagsForOrders(storeId, pageRows.map((r) => String(r.id)));
  const items = pageRows.map((row) => toItem(row, tags));

  let hasPrevious = false;
  let previousCursor: string | null = null;
  if (paged) {
    // The page before: the rows at or before the cursor, read backwards; the row just before those starts it (none: the first page).
    const behind = keysetAfter(params.sort, params.after, context, { atOrBefore: true })!;
    const back = await db().execute<Row>(sql`
      select o.id, o.placed_at::text as placed_key, o.total_minor, ${totalKey(context)} as total_key
      from commerce.orders o
      where ${where} and ${behind}
      order by ${orderListOrderByReversed(params.sort, context)}
      limit ${pageSize + 1}
    `);
    hasPrevious = back.length > 0;
    previousCursor = back.length > pageSize ? cursorOfRow(params, back[pageSize]) : null;
  }

  const { count, capped } = await countOrders(storeId, params, context);
  return {
    rows: items,
    count,
    capped,
    nextCursor: hasNext && pageRows.length > 0 ? cursorOfRow(params, pageRows[pageRows.length - 1]) : null,
    hasPrevious,
    previousCursor,
  };
}

export type MatchingSelection = {
  /** The ids of the matching orders, at most `limit`. */
  ids: string[];
  /** More orders match than `limit`: the request is too large for a bulk action. */
  over: boolean;
};

/**
 * Every order the list's own query matches, for "select all {n} matching" (D173): the server re-runs the same query (the store, the address's parameters), never trusting a list
 * from the browser. `limit` is the action's maximum; one more than that is read, to say the selection is too large.
 */
export async function selectAllMatching(storeId: string, params: OrderListParams, context: OrderListContext, limit: number): Promise<MatchingSelection> {
  const rows = await db().execute<Row>(sql`
    select o.id from commerce.orders o
    where ${orderListWhere(storeId, { ...params, after: null }, context)}
    order by ${orderListOrderBy(params.sort, context)}
    limit ${limit + 1}
  `);
  return { ids: rows.slice(0, limit).map((r) => String(r.id)), over: rows.length > limit };
}
