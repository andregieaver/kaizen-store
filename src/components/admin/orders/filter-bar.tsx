import Link from "next/link";

import { field, hint, primary, secondary } from "@/components/admin/data/ui";
import { clearHref, plainState } from "@/lib/order-list-admin";
import {
  COLUMN_LABELS,
  expandShow,
  describeFilters,
  ORDER_COLUMNS,
  PAY_FILTERS,
  RANGE_FILTERS,
  RANGE_LABELS,
  SHIP_FILTERS,
  SORT_KEYS,
  SOURCE_FILTERS,
  SOURCE_LABELS,
  STATUS_FILTERS,
  columnsOf,
  hasFilters,
  type OrderListParams,
  type SortKey,
} from "@/lib/order-list";

const SORT_LABELS: Record<SortKey, string> = {
  placed_desc: "Newest first",
  placed_asc: "Oldest first",
  total_desc: "Highest total first",
  total_asc: "Lowest total first",
};
const PAY_LABELS: Record<(typeof PAY_FILTERS)[number], string> = {
  paid: "Paid",
  partially_refunded: "Partially refunded",
  refunded: "Refunded",
  balance_due: "Balance due at the venue",
  unpaid: "Unpaid (unfinished checkouts)",
};
const SHIP_LABELS: Record<(typeof SHIP_FILTERS)[number], string> = {
  to_send: "To send",
  partly_sent: "Partly sent",
  edit_pending: "Change awaiting payment",
  sent: "Sent",
  waiting: "Waiting for stock",
  no_shipping: "Nothing to ship",
};
const STATUS_LABELS: Record<(typeof STATUS_FILTERS)[number], string> = {
  paid: "Paid, not sent",
  fulfilled: "Sent",
  cancelled: "Cancelled",
  closed: "Closed",
};

function Group<T extends string>({ legend, name, values, labels, checked }: { legend: string; name: string; values: readonly T[]; labels: Record<T, string>; checked: readonly string[] }) {
  return (
    <fieldset className="flex flex-col gap-1 text-sm">
      <legend className="mb-1 font-medium">{legend}</legend>
      {values.map((value) => (
        <label key={value} className="flex items-center gap-2">
          <input type="checkbox" name={name} value={value} defaultChecked={checked.includes(value)} className="size-4" />
          {labels[value]}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * The search box and the filters of the Orders list (wave 3, D173, `docs/wave-3-orders.md` 2.2): one GET form, so it works without a script and the address is the state (a bookmark, the
 * back button, a saved view). The form shows the state with a built-in view written out as the filters it stands for, and submits the whole of it: a saved view is not carried
 * along (its filters are in the form). Below it, a chip for each filter that is on, each a link that clears it, and *Clear all*.
 */
export function FilterBar({
  base,
  params,
  markets,
  tagSuggestions,
}: {
  base: string;
  params: OrderListParams;
  markets: { code: string; name: string }[];
  tagSuggestions: string[];
}) {
  const state = expandShow(plainState(params));
  const chips = describeFilters(params);
  const columns = columnsOf(params);
  const filtered = hasFilters(params);
  return (
    <div className="flex flex-col gap-3">
      <form method="get" action={base} role="search" aria-label="Search and filter the orders" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-60 flex-1 flex-col gap-1">
            <label htmlFor="orders-q" className="text-sm font-medium">
              Search
            </label>
            <input
              id="orders-q"
              type="search"
              name="q"
              defaultValue={params.q}
              maxLength={100}
              placeholder="Order number, email, name, product, SKU, tag or tracking number"
              className={`${field} w-full`}
            />
          </div>
          <button type="submit" className={primary}>
            Search
          </button>
          {filtered && (
            <Link href={base} className={secondary}>
              Clear all
            </Link>
          )}
        </div>

        <details className="rounded-lg border border-border bg-surface">
          <summary className="cursor-pointer px-4 py-2 text-sm font-medium">Filters, sorting and columns</summary>
          <div className="flex flex-col gap-4 border-t border-border p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Group legend="Payment" name="pay" values={PAY_FILTERS} labels={PAY_LABELS} checked={state.pay} />
              <Group legend="Fulfilment" name="ship" values={SHIP_FILTERS} labels={SHIP_LABELS} checked={state.ship} />
              <Group legend="Order status" name="status" values={STATUS_FILTERS} labels={STATUS_LABELS} checked={state.status} />
              <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="mb-1 font-medium">Columns</legend>
                {ORDER_COLUMNS.map((column) => (
                  <label key={column} className="flex items-center gap-2">
                    <input type="checkbox" name="cols" value={column} defaultChecked={columns.includes(column)} className="size-4" />
                    {COLUMN_LABELS[column]}
                  </label>
                ))}
                <span className={hint}>The order number is always shown first.</span>
              </fieldset>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-tag" className="text-sm font-medium">
                  Tagged <span className="font-normal text-muted">(all of them)</span>
                </label>
                <input id="orders-tag" name="tag" list="orders-tag-suggestions" defaultValue={state.tag.join(", ")} placeholder="vip, wholesale" autoComplete="off" className={field} />
                <datalist id="orders-tag-suggestions">
                  {tagSuggestions.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-range" className="text-sm font-medium">
                  Placed
                </label>
                <select id="orders-range" name="range" defaultValue={state.range ?? ""} className={field}>
                  <option value="">Any time</option>
                  {RANGE_FILTERS.map((range) => (
                    <option key={range} value={range}>
                      {RANGE_LABELS[range][0].toUpperCase() + RANGE_LABELS[range].slice(1)}
                    </option>
                  ))}
                </select>
                <span className={hint}>Or choose days below; days win over this.</span>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-from" className="text-sm font-medium">
                  From day
                </label>
                <input id="orders-from" type="date" name="from" defaultValue={state.from ?? ""} className={field} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-to" className="text-sm font-medium">
                  To day <span className="font-normal text-muted">(inclusive)</span>
                </label>
                <input id="orders-to" type="date" name="to" defaultValue={state.to ?? ""} className={field} />
              </div>
              {markets.length > 1 && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="orders-market" className="text-sm font-medium">
                    Market
                  </label>
                  <select id="orders-market" name="market" defaultValue={state.market ?? ""} className={field}>
                    <option value="">All markets</option>
                    {markets.map((market) => (
                      <option key={market.code} value={market.code}>
                        {market.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-source" className="text-sm font-medium">
                  Made by
                </label>
                <select id="orders-source" name="source" defaultValue={state.source ?? ""} className={field}>
                  <option value="">Anyone</option>
                  {SOURCE_FILTERS.map((source) => (
                    <option key={source} value={source}>
                      {SOURCE_LABELS[source]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-archived" className="text-sm font-medium">
                  Archived
                </label>
                <select id="orders-archived" name="archived" defaultValue={state.archived} className={field}>
                  <option value="no">Not archived</option>
                  <option value="yes">Only archived</option>
                  <option value="all">Both</option>
                </select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-sort" className="text-sm font-medium">
                  Sort
                </label>
                <select id="orders-sort" name="sort" defaultValue={state.sort} className={field}>
                  {SORT_KEYS.map((sort) => (
                    <option key={sort} value={sort}>
                      {SORT_LABELS[sort]}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="gift" value="1" defaultChecked={state.gift} className="size-4" />
              Gift orders only
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={primary}>
                Apply
              </button>
              <p className={hint}>Copied history never matches a payment, fulfilment or status filter: it is still in All, Archived and a search.</p>
            </div>
          </div>
        </details>
      </form>

      {chips.length > 0 && (
        <ul aria-label="Filters that are on" className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <Link href={clearHref(base, params, chip.key)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-surface px-3 text-xs hover:bg-background" aria-label={`Remove filter: ${chip.label}`}>
                {chip.label}
                <span aria-hidden="true">×</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
