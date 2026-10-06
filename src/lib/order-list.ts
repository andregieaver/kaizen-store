/**
 * The Orders page's state is its address (wave 3, run 2, D173, `docs/wave-3-orders.md` 2.2): a bookmark and the back button work, a saved view is the same
 * parameters, and the server reads them through ONE parser, `parseOrderListParams()`, which drops every unknown key and ignores every invalid value (never an error
 * page, never raw text into SQL). `orderListQuery()` writes them back, and `orderListQuery(parseOrderListParams(x))` is stable. The parameters become SQL only in
 * `orderListWhere()` (`src/server/order-list-sql.ts`), which is why everything the rules say about meaning is here: which statements are about real sales,
 * what a built-in view expands to, how a relative date range becomes the store's days, how the cursor is made. Pure: no server import, no zod.
 */
import { tagKey } from "./order-tags";
import { normaliseSearch } from "./order-search";
import { ORDERS_COUNT_CAP, ORDERS_PAGE_SIZE, VIEWS_MAX, VIEW_TITLE_MAX } from "./order-limits";

export { ORDERS_COUNT_CAP, ORDERS_PAGE_SIZE, VIEWS_MAX, VIEW_TITLE_MAX };

// ---------------------------------------------------------------------------------------------------------------------
// The vocabulary
// ---------------------------------------------------------------------------------------------------------------------

export const PAY_FILTERS = ["paid", "partially_refunded", "refunded", "balance_due", "unpaid"] as const;
export type PayFilter = (typeof PAY_FILTERS)[number];

export const SHIP_FILTERS = ["to_send", "sent", "waiting", "no_shipping"] as const;
export type ShipFilter = (typeof SHIP_FILTERS)[number];

/** The order's own status (`orders.status`); an unfinished checkout is `pending_payment` and is the `unpaid` payment filter's, not a status. */
export const STATUS_FILTERS = ["paid", "fulfilled", "cancelled", "closed"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];

export const SOURCE_FILTERS = ["checkout", "draft", "copied"] as const;
export type SourceFilter = (typeof SOURCE_FILTERS)[number];

export const RANGE_FILTERS = ["7d", "30d", "90d", "this_month", "last_month"] as const;
export type RangeFilter = (typeof RANGE_FILTERS)[number];

export const SORT_KEYS = ["placed_desc", "placed_asc", "total_desc", "total_asc"] as const;
export type SortKey = (typeof SORT_KEYS)[number];
export const SORTS: Record<SortKey, { field: "placed" | "total"; direction: "asc" | "desc" }> = {
  placed_desc: { field: "placed", direction: "desc" },
  placed_asc: { field: "placed", direction: "asc" },
  total_desc: { field: "total", direction: "desc" },
  total_asc: { field: "total", direction: "asc" },
};

export const ARCHIVED_FILTERS = ["no", "yes", "all"] as const;
export type ArchivedFilter = (typeof ARCHIVED_FILTERS)[number];

/** The built-in views that are a `show` value. *All* is the absence of one. The old `?show=` addresses keep working. */
export const SHOW_VIEWS = ["to-send", "waiting", "unpaid", "archived"] as const;
export type ShowView = (typeof SHOW_VIEWS)[number];

/** Columns of the list: *Order* is always first and not listed; the others are shown or hidden, in this fixed order. */
export const ORDER_COLUMNS = ["placed", "customer", "market", "payment", "fulfilment", "items", "total", "tags", "source"] as const;
export type OrderColumn = (typeof ORDER_COLUMNS)[number];
export const DEFAULT_COLUMNS: readonly OrderColumn[] = ["placed", "customer", "payment", "fulfilment", "items", "total", "tags"];
export const COLUMN_LABELS: Record<OrderColumn, string> = {
  placed: "Placed",
  customer: "Customer",
  market: "Market",
  payment: "Payment",
  fulfilment: "Fulfilment",
  items: "Items",
  total: "Total",
  tags: "Tags",
  source: "Source",
};

/** The keys of the address, in the order they are written. Nothing else is read. */
export const ORDER_LIST_KEYS = [
  "q", "show", "view", "pay", "ship", "status", "tag", "from", "to", "range", "market", "source", "gift", "archived", "sort", "after", "cols",
] as const;
export type OrderListKey = (typeof ORDER_LIST_KEYS)[number];

/** The state of the list. Every field has a default, so a parsed address is always complete. */
export type OrderListParams = {
  /** The search text, normalised (at most 100 characters); `""` for none. */
  q: string;
  show: ShowView | null;
  /** A saved view's id; the server applies its parameters first and the address overrides them (`resolveOrderListParams()`). */
  view: string | null;
  pay: PayFilter[];
  ship: ShipFilter[];
  status: StatusFilter[];
  /** Tag KEYS (case-folded): all must be on the order. */
  tag: string[];
  /** The store's own days, `YYYY-MM-DD`, inclusive. */
  from: string | null;
  to: string | null;
  /** Relative; ignored when `from` or `to` is set. */
  range: RangeFilter | null;
  /** A country code (upper case); the server checks it is one of the store's markets. */
  market: string | null;
  source: SourceFilter | null;
  gift: boolean;
  archived: ArchivedFilter;
  sort: SortKey;
  /** An opaque cursor for the next page (`decodeCursor()` says whether it is one). */
  after: string | null;
  /** Visible columns; null is the default set. */
  cols: OrderColumn[] | null;
};

export const DEFAULT_ORDER_LIST: OrderListParams = {
  q: "",
  show: null,
  view: null,
  pay: [],
  ship: [],
  status: [],
  tag: [],
  from: null,
  to: null,
  range: null,
  market: null,
  source: null,
  gift: false,
  archived: "no",
  sort: "placed_desc",
  after: null,
  cols: null,
};

// ---------------------------------------------------------------------------------------------------------------------
// Reading an address
// ---------------------------------------------------------------------------------------------------------------------

/** What Next gives a page (`searchParams`), a `URLSearchParams`, or a saved view's stored record (strings). */
export type OrderListInput = URLSearchParams | Record<string, string | string[] | undefined | null>;

function valuesOf(input: OrderListInput, key: string): string[] {
  if (input instanceof URLSearchParams) return input.getAll(key);
  const value = input[key];
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** The values of a multi-valued key: repeated keys and commas both split. */
const listOf = (input: OrderListInput, key: string): string[] =>
  valuesOf(input, key)
    .flatMap((v) => String(v).split(","))
    .map((v) => v.trim())
    .filter((v) => v !== "");

const oneOf = <T extends string>(input: OrderListInput, key: string, allowed: readonly T[]): T | null => {
  const value = valuesOf(input, key)[0];
  return typeof value === "string" && (allowed as readonly string[]).includes(value.trim()) ? (value.trim() as T) : null;
};

const pick = <T extends string>(input: OrderListInput, key: string, allowed: readonly T[]): T[] => {
  const out: T[] = [];
  for (const value of listOf(input, key)) if ((allowed as readonly string[]).includes(value) && !out.includes(value as T)) out.push(value as T);
  return allowed.filter((a) => out.includes(a));
};

/** A real calendar date written `YYYY-MM-DD`. */
export function isDateString(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value && Number(value.slice(0, 4)) >= 2000 && Number(value.slice(0, 4)) <= 2100;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CURSOR = /^[A-Za-z0-9_-]{1,512}$/;

export type OrderListRead = {
  /** Only the keys that were present with a valid value. */
  present: Partial<OrderListParams>;
  /** Keys that were present but had no valid value (so something in a saved view no longer applies). Unknown keys are not listed: they are simply not read. */
  ignored: OrderListKey[];
};

/** Reads an address into the keys it sets (and the keys it sets in vain). The one place that decides what a value means. */
export function readOrderListParams(input: OrderListInput): OrderListRead {
  const present: Partial<OrderListParams> = {};
  const ignored: OrderListKey[] = [];
  const has = (key: OrderListKey) => valuesOf(input, key).some((v) => String(v).trim() !== "");
  const note = (key: OrderListKey, ok: boolean) => {
    if (has(key) && !ok) ignored.push(key);
  };

  const q = normaliseSearch(valuesOf(input, "q")[0]);
  if (q !== "") present.q = q;
  note("q", q !== "");

  const show = oneOf(input, "show", SHOW_VIEWS);
  if (show) present.show = show;
  note("show", show !== null);

  const view = valuesOf(input, "view")[0]?.trim();
  if (view && UUID.test(view)) present.view = view.toLowerCase();
  note("view", Boolean(view && UUID.test(view)));

  for (const [key, allowed] of [["pay", PAY_FILTERS], ["ship", SHIP_FILTERS], ["status", STATUS_FILTERS]] as const) {
    const chosen = pick(input, key, allowed as readonly string[]);
    if (chosen.length > 0) (present as Record<string, unknown>)[key] = chosen;
    note(key, chosen.length > 0);
  }

  const tags: string[] = [];
  for (const value of listOf(input, "tag")) {
    const key = tagKey(value);
    if (key && !tags.includes(key)) tags.push(key);
  }
  if (tags.length > 0) present.tag = tags.slice(0, 20);
  note("tag", tags.length > 0);

  let from = valuesOf(input, "from")[0]?.trim() ?? "";
  let to = valuesOf(input, "to")[0]?.trim() ?? "";
  if (from !== "" && !isDateString(from)) from = "";
  if (to !== "" && !isDateString(to)) to = "";
  if (from !== "" && to !== "" && from > to) [from, to] = [to, from];
  if (from !== "") present.from = from;
  if (to !== "") present.to = to;
  note("from", from !== "");
  note("to", to !== "");

  const range = oneOf(input, "range", RANGE_FILTERS);
  // An explicit date wins over a relative range: a range is a way of saying dates.
  if (range && from === "" && to === "") present.range = range;
  note("range", range !== null);

  const market = valuesOf(input, "market")[0]?.trim().toUpperCase();
  if (market && /^[A-Z]{2}$/.test(market)) present.market = market;
  note("market", Boolean(market && /^[A-Z]{2}$/.test(market)));

  const source = oneOf(input, "source", SOURCE_FILTERS);
  if (source) present.source = source;
  note("source", source !== null);

  const gift = valuesOf(input, "gift")[0]?.trim().toLowerCase();
  if (gift === "1" || gift === "true" || gift === "yes") present.gift = true;
  note("gift", gift === "1" || gift === "true" || gift === "yes" || gift === "0" || gift === "false" || gift === "no");

  const archived = oneOf(input, "archived", ARCHIVED_FILTERS);
  if (archived) present.archived = archived;
  note("archived", archived !== null);

  const sort = oneOf(input, "sort", SORT_KEYS);
  if (sort) present.sort = sort;
  note("sort", sort !== null);

  const after = valuesOf(input, "after")[0]?.trim();
  if (after && CURSOR.test(after)) present.after = after;
  note("after", Boolean(after && CURSOR.test(after)));

  const cols = pick(input, "cols", ORDER_COLUMNS);
  if (cols.length > 0) present.cols = cols;
  note("cols", cols.length > 0);

  return { present, ignored };
}

const sameColumns = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((v, i) => v === b[i]);

/** Fills the gaps with the defaults. The default column set is `null`, however it was written (so one state has one reading). */
export const withDefaults = (present: Partial<OrderListParams>): OrderListParams => {
  const params = { ...DEFAULT_ORDER_LIST, ...present };
  if (params.cols && sameColumns(params.cols, DEFAULT_COLUMNS)) params.cols = null;
  return params;
};

/** The one parser: an address (or a saved view's record) to the complete state of the list. Unknown keys are dropped, invalid values ignored. */
export const parseOrderListParams = (input: OrderListInput): OrderListParams => withDefaults(readOrderListParams(input).present);

/**
 * A saved view's parameters under the address's: the view's are applied first, then any other parameter in the address overrides them. A relative `range` in the
 * address replaces the view's dates (and dates in the address replace its range); `after` is never a view's. Returns what the list shows.
 */
export function resolveOrderListParams(address: Partial<OrderListParams>, view: Partial<OrderListParams> | null): OrderListParams {
  const base: Partial<OrderListParams> = { ...(view ?? {}) };
  delete base.after;
  delete base.view;
  const merged: Partial<OrderListParams> = { ...base, ...address };
  if (address.range !== undefined && address.from === undefined && address.to === undefined) {
    delete merged.from;
    delete merged.to;
  }
  if ((address.from !== undefined || address.to !== undefined) && address.range === undefined) delete merged.range;
  return withDefaults(merged);
}

// ---------------------------------------------------------------------------------------------------------------------
// Writing an address
// ---------------------------------------------------------------------------------------------------------------------

/** The address of a list state: only what differs from the defaults, in a fixed order, so the same state is always the same address (no leading `?`). */
export function orderListQuery(params: OrderListParams): string {
  const q = new URLSearchParams();
  if (params.q !== "") q.set("q", params.q);
  if (params.show) q.set("show", params.show);
  if (params.view) q.set("view", params.view);
  if (params.pay.length > 0) q.set("pay", params.pay.join(","));
  if (params.ship.length > 0) q.set("ship", params.ship.join(","));
  if (params.status.length > 0) q.set("status", params.status.join(","));
  if (params.tag.length > 0) q.set("tag", params.tag.join(","));
  if (params.from) q.set("from", params.from);
  if (params.to) q.set("to", params.to);
  if (params.range && !params.from && !params.to) q.set("range", params.range);
  if (params.market) q.set("market", params.market);
  if (params.source) q.set("source", params.source);
  if (params.gift) q.set("gift", "1");
  if (params.archived !== DEFAULT_ORDER_LIST.archived) q.set("archived", params.archived);
  if (params.sort !== DEFAULT_ORDER_LIST.sort) q.set("sort", params.sort);
  if (params.after) q.set("after", params.after);
  if (params.cols && !sameColumns(params.cols, DEFAULT_COLUMNS)) q.set("cols", params.cols.join(","));
  return q.toString();
}

/** The list's link with some parameters changed (and the cursor dropped, since a changed list starts from its first page): `base` is the page's path. */
export function orderListHref(base: string, params: OrderListParams, change: Partial<OrderListParams> = {}): string {
  const next: OrderListParams = { ...params, after: null, ...change };
  const query = orderListQuery(next);
  return query === "" ? base : `${base}?${query}`;
}

/**
 * What a saved view stores: the address's parameters without the cursor and the view's own id, as the flat record of strings the parser reads again.
 * A view of the search `vip` with payment `paid` is `{ "q": "vip", "pay": "paid" }`.
 */
export function viewRecordOf(params: OrderListParams): Record<string, string> {
  const query = new URLSearchParams(orderListQuery({ ...params, after: null, view: null }));
  return Object.fromEntries(query.entries());
}

export type ViewTitleResult = { ok: true; title: string } | { ok: false; problem: "empty" | "too_long" };

/** What staff read when a view's title is refused. */
export const VIEW_TITLE_PROBLEM_TEXT = { empty: "Give the view a name.", too_long: `A view's name is at most ${VIEW_TITLE_MAX} characters.` } as const;

/**
 * A saved view's title as the database keeps it (`order_views_title`): Unicode NFC, spaces collapsed, trimmed, 1 to 40 code points. Two titles that differ only in case are one
 * title (the database's unique index folds case); the server says so when a title is taken.
 */
export function normaliseViewTitle(input: unknown): ViewTitleResult {
  if (typeof input !== "string") return { ok: false, problem: "empty" };
  const title = input.normalize("NFC").replace(/\s+/g, " ").trim();
  if (title === "") return { ok: false, problem: "empty" };
  if ([...title].length > VIEW_TITLE_MAX) return { ok: false, problem: "too_long" };
  return { ok: true, title };
}

/** A saved view's record read back: the parameters it sets and the keys that no longer mean anything (so the page can say "Some of this view's settings no longer apply"). */
export function readViewRecord(record: unknown): OrderListRead {
  if (!record || typeof record !== "object" || Array.isArray(record)) return { present: {}, ignored: [] };
  const flat: Record<string, string> = {};
  for (const key of ORDER_LIST_KEYS) {
    if (key === "after" || key === "view") continue;
    const value = (record as Record<string, unknown>)[key];
    if (typeof value === "string") flat[key] = value;
    else if (Array.isArray(value)) flat[key] = value.filter((v) => typeof v === "string").join(",");
    else if (typeof value === "boolean") flat[key] = value ? "1" : "0";
  }
  return readOrderListParams(flat);
}

// ---------------------------------------------------------------------------------------------------------------------
// What the parameters mean
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The state with `show` written out as the filters it stands for, so the SQL builder has one shape to read:
 * `to-send` is `ship=to_send`, `waiting` is `ship=waiting`, `unpaid` (unfinished checkouts) is `pay=unpaid`, `archived` is `archived=yes`.
 * A `show` adds to what is chosen; it never removes a filter.
 */
export function expandShow(params: OrderListParams): OrderListParams {
  const add = <T>(list: readonly T[], value: T): T[] => (list.includes(value) ? [...list] : [...list, value]);
  switch (params.show) {
    case "to-send":
      return { ...params, ship: add(params.ship, "to_send") };
    case "waiting":
      return { ...params, ship: add(params.ship, "waiting") };
    case "unpaid":
      return { ...params, pay: add(params.pay, "unpaid") };
    case "archived":
      return { ...params, archived: "yes" };
    default:
      return params;
  }
}

/**
 * Whether the filters say something about real sales: choosing a payment or fulfilment state, an order status, or a source other than `copied` makes copied history
 * (D129) never match (it appears in *All*, in *Archived*, with `source=copied` and in search).
 */
export function excludesCopied(params: OrderListParams): boolean {
  const p = expandShow(params);
  return p.pay.length > 0 || p.ship.length > 0 || p.status.length > 0 || p.source === "checkout" || p.source === "draft";
}

/** Unfinished checkouts: the payment filter `unpaid` (pending payment, and cancelled orders that were never paid). */
export const isUnfinishedView = (params: OrderListParams): boolean => expandShow(params).pay.includes("unpaid");

/** Whether any filter, search or non-default sort narrows or orders the list (the page offers *Clear* then). The columns do not count. */
export function hasFilters(params: OrderListParams): boolean {
  return (
    params.q !== "" || params.show !== null || params.view !== null || params.pay.length > 0 || params.ship.length > 0 || params.status.length > 0 || params.tag.length > 0 ||
    params.from !== null || params.to !== null || params.range !== null || params.market !== null || params.source !== null || params.gift || params.archived !== "no"
  );
}

/** The columns shown, in their fixed order. */
export const columnsOf = (params: Pick<OrderListParams, "cols">): readonly OrderColumn[] => params.cols ?? DEFAULT_COLUMNS;

/** The built-in views, in the order the view bar shows them (*All* is no `show`). */
export const BUILT_IN_VIEWS: readonly { show: ShowView | null; label: string }[] = [
  { show: null, label: "All" },
  { show: "to-send", label: "To send" },
  { show: "waiting", label: "Waiting for stock" },
  { show: "unpaid", label: "Unfinished checkouts" },
  { show: "archived", label: "Archived" },
];

/** What each filter chip says; the view bar and the empty state use it. */
export function describeFilters(params: OrderListParams): { key: OrderListKey; label: string }[] {
  const p = params;
  const out: { key: OrderListKey; label: string }[] = [];
  const words = (list: readonly string[]) => list.map((v) => v.replace(/_/g, " ")).join(", ");
  if (p.q !== "") out.push({ key: "q", label: `Search: ${p.q}` });
  if (p.pay.length > 0) out.push({ key: "pay", label: `Payment: ${words(p.pay)}` });
  if (p.ship.length > 0) out.push({ key: "ship", label: `Fulfilment: ${words(p.ship)}` });
  if (p.status.length > 0) out.push({ key: "status", label: `Status: ${words(p.status)}` });
  if (p.tag.length > 0) out.push({ key: "tag", label: `Tagged: ${p.tag.join(", ")}` });
  if (p.range) out.push({ key: "range", label: `Placed: ${RANGE_LABELS[p.range]}` });
  else if (p.from || p.to) out.push({ key: "from", label: `Placed: ${p.from ?? "…"} to ${p.to ?? "…"}` });
  if (p.market) out.push({ key: "market", label: `Market: ${p.market}` });
  if (p.source) out.push({ key: "source", label: `Source: ${SOURCE_LABELS[p.source]}` });
  if (p.gift) out.push({ key: "gift", label: "Gifts" });
  if (p.archived !== "no") out.push({ key: "archived", label: p.archived === "yes" ? "Archived only" : "Including archived" });
  return out;
}

export const RANGE_LABELS: Record<RangeFilter, string> = {
  "7d": "last 7 days",
  "30d": "last 30 days",
  "90d": "last 90 days",
  this_month: "this month",
  last_month: "last month",
};

export const SOURCE_LABELS: Record<SourceFilter, string> = { checkout: "Checkout", draft: "Staff-made", copied: "Copied history" };

// ---------------------------------------------------------------------------------------------------------------------
// Dates: the store's own days
// ---------------------------------------------------------------------------------------------------------------------

/** A date plus a number of days (negative for before), as a date: no time zone and no interval is involved. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The start of the next local day after `date`: the end of a range that ends on `date` (the date plus one, never an interval on a `timestamptz`, D165's rule). */
export const nextDay = (date: string): string => addDays(date, 1);

/** The first and last day of a relative range, in the store's own days, given the store's today. `7d` is the last 7 days including today. */
export function rangeDays(range: RangeFilter, today: string): { from: string; to: string } {
  switch (range) {
    case "7d":
      return { from: addDays(today, -6), to: today };
    case "30d":
      return { from: addDays(today, -29), to: today };
    case "90d":
      return { from: addDays(today, -89), to: today };
    case "this_month":
      return { from: `${today.slice(0, 7)}-01`, to: today };
    case "last_month": {
      const first = `${today.slice(0, 7)}-01`;
      return { from: `${addDays(first, -1).slice(0, 7)}-01`, to: addDays(first, -1) };
    }
  }
}

/**
 * The window a list is restricted to, in the store's days: `from` is the start of that local day, `toExclusive` the start of the day after the last one (so an
 * order at 23:30 local on the last day is inside in summer and in winter time). Null for a side that is open.
 */
export function dateWindow(params: Pick<OrderListParams, "from" | "to" | "range">, today: string): { from: string | null; toExclusive: string | null } {
  if (params.from || params.to) return { from: params.from, toExclusive: params.to ? nextDay(params.to) : null };
  if (params.range) {
    const r = rangeDays(params.range, today);
    return { from: r.from, toExclusive: nextDay(r.to) };
  }
  return { from: null, toExclusive: null };
}

// ---------------------------------------------------------------------------------------------------------------------
// The cursor: keyset paging
// ---------------------------------------------------------------------------------------------------------------------

/**
 * The cursor of the next page carries the sort, the last row's sort key and its id, so the next page is `(sort key, id)` after it: a boundary never loses or repeats an
 * order whatever happens to the list meanwhile. For `placed_*` the key is the `timestamptz` as Postgres prints it (microseconds, which a JavaScript date would cut);
 * for `total_*` it is the total in minor units. Opaque to the browser: base64url of a small JSON array.
 */
export type Cursor = { sort: SortKey; key: string; id: string };

const toBase64Url = (text: string): string => {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromBase64Url = (text: string): string => {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (text.length % 4)) % 4);
  const binary = atob(padded);
  return new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
};

export function encodeCursor(cursor: Cursor): string {
  return toBase64Url(JSON.stringify([cursor.sort, cursor.key, cursor.id]));
}

/** The cursor for the row after which the next page starts. `value` is the timestamp text or the total as a number or string. */
export const cursorFor = (sort: SortKey, value: string | number | bigint, id: string): string => encodeCursor({ sort, key: String(value), id });

/** Reads a cursor; null when it is not one, is for another sort, or does not hold what its sort needs (an invalid cursor is the first page). */
export function decodeCursor(after: string | null | undefined, sort: SortKey): Cursor | null {
  if (!after || !CURSOR.test(after)) return null;
  try {
    const parsed: unknown = JSON.parse(fromBase64Url(after));
    if (!Array.isArray(parsed) || parsed.length !== 3) return null;
    const [s, key, id] = parsed as unknown[];
    if (s !== sort || typeof key !== "string" || typeof id !== "string" || !UUID.test(id)) return null;
    if (SORTS[sort].field === "total" ? !/^\d{1,18}$/.test(key) : !/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}(:?\d{2})?)?$/.test(key)) return null;
    return { sort, key, id: id.toLowerCase() };
  } catch {
    return null;
  }
}

/** "37 orders", or "10,000+ orders" when the count hit its cap. */
export function countText(count: number): string {
  const noun = count === 1 ? "order" : "orders";
  return count > ORDERS_COUNT_CAP ? `${ORDERS_COUNT_CAP.toLocaleString("en")}+ ${noun}` : `${count.toLocaleString("en")} ${noun}`;
}
