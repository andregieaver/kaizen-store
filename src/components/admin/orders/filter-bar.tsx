import { SlidersHorizontal } from "lucide-react";

import { AdminLink } from "../ui/link";
import { ListSearch } from "../ui/list-search";
import { Select, TextInput } from "../ui/field";

import { hint, primary, secondary } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import type { OrdersMessages } from "@/lib/admin-messages/orders.en";
import { ORDERS_WORDS } from "@/lib/admin-words/orders";
import { clearHref, plainState } from "@/lib/order-list-admin";
import { filterChips } from "@/lib/order-list-words";
import {
  COLUMN_LABELS,
  expandShow,
  ORDER_COLUMNS,
  PAY_FILTERS,
  RANGE_FILTERS,
  SHIP_FILTERS,
  SORT_KEYS,
  SOURCE_FILTERS,
  STATUS_FILTERS,
  columnsOf,
  hasFilters,
  type OrderColumn,
  type OrderListParams,
} from "@/lib/order-list";

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
 * The search box and the filters of the Orders list (wave 3, D173, `docs/wave-3-orders.md` 2.2): one GET form (the kit's `ListSearch`, code review 1.12), so it works without a script and the address is the state (a bookmark, the
 * back button, a saved view). The form shows the state with a built-in view written out as the filters it stands for, and submits the whole of it: a saved view is not carried
 * along (its filters are in the form). Below it, a chip for each filter that is on, each a link that clears it, and *Clear all*.
 */
export function FilterBar({
  base,
  params,
  markets,
  tagSuggestions,
  words: w,
  columnWords = COLUMN_LABELS,
}: {
  base: string;
  params: OrderListParams;
  markets: { code: string; name: string }[];
  tagSuggestions: string[];
  /** The `orders` catalogue's `filters` words in the account's language (D312 A4). */
  words: OrdersMessages["filters"];
  /** The columns' names, the table's (`OrdersMessages["table"]["columns"]`). */
  columnWords?: Record<OrderColumn, string>;
}) {
  const state = expandShow(plainState(params));
  // English (the catalogue itself, as the server hands it) names the codes as they are written: `partially refunded`.
  const chips = filterChips(params, w, w === ORDERS_WORDS.en.filters);
  const columns = columnsOf(params);
  const filtered = hasFilters(params);
  return (
    <div className="flex flex-col gap-3">
      {/* Round 3 (D603): one bar, the search and its Filters together; the filters open as a panel under it. */}
      <ListSearch
        action={base}
        id="orders-q"
        value={params.q}
        maxLength={100}
        placeholder={w.searchPlaceholder}
        formLabel={w.formLabel}
        words={{ label: w.search, button: w.searchButton }}
        aside={
          filtered &&
          chips.length > 0 && (
            <AdminLink href={base} className={secondary}>
              {w.clearAll}
            </AdminLink>
          )
        }
        tools={
            <details className="group">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-pill bg-sunken px-3.5 text-caption text-ink group-open:bg-ink group-open:text-card [&::-webkit-details-marker]:hidden">
                <SlidersHorizontal aria-hidden className="size-3.5" />
                {w.more}
                {chips.length > 0 && <span className="tabular-nums">· {chips.length}</span>}
              </summary>
              <div className="absolute inset-x-0 top-full z-30 mt-2 max-w-full overflow-x-auto rounded-panel border border-line bg-card shadow-[var(--shadow-float)]">
          <div className="flex flex-col gap-4 p-4">
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Group legend={w.payment} name="pay" values={PAY_FILTERS} labels={w.pay} checked={state.pay} />
              <Group legend={w.fulfilment} name="ship" values={SHIP_FILTERS} labels={w.ship} checked={state.ship} />
              <Group legend={w.status} name="status" values={STATUS_FILTERS} labels={w.statuses} checked={state.status} />
              <fieldset className="flex flex-col gap-1 text-sm">
                <legend className="mb-1 font-medium">{w.columns}</legend>
                {ORDER_COLUMNS.map((column) => (
                  <label key={column} className="flex items-center gap-2">
                    <input type="checkbox" name="cols" value={column} defaultChecked={columns.includes(column)} className="size-4" />
                    {columnWords[column]}
                  </label>
                ))}
                <span className={hint}>{w.orderFirst}</span>
              </fieldset>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-tag" className="text-sm font-medium">
                  {w.tagged} <span className="font-normal text-muted">{w.allOfThem}</span>
                </label>
                <TextInput id="orders-tag" name="tag" list="orders-tag-suggestions" defaultValue={state.tag.join(", ")} placeholder={w.tagPlaceholder} autoComplete="off" />
                <datalist id="orders-tag-suggestions">
                  {tagSuggestions.map((label) => (
                    <option key={label} value={label} />
                  ))}
                </datalist>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-range" className="text-sm font-medium">
                  {w.placed}
                </label>
                <Select id="orders-range" name="range" defaultValue={state.range ?? ""}>
                  <option value="">{w.anyTime}</option>
                  {RANGE_FILTERS.map((range) => (
                    <option key={range} value={range}>
                      {w.ranges[range][0].toUpperCase() + w.ranges[range].slice(1)}
                    </option>
                  ))}
                </Select>
                <span className={hint}>{w.daysWin}</span>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-from" className="text-sm font-medium">
                  {w.fromDay}
                </label>
                <TextInput id="orders-from" type="date" name="from" defaultValue={state.from ?? ""} />
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-to" className="text-sm font-medium">
                  {w.toDay} <span className="font-normal text-muted">{w.inclusive}</span>
                </label>
                <TextInput id="orders-to" type="date" name="to" defaultValue={state.to ?? ""} />
              </div>
              {markets.length > 1 && (
                <div className="flex flex-col gap-1">
                  <label htmlFor="orders-market" className="text-sm font-medium">
                    {w.market}
                  </label>
                  <Select id="orders-market" name="market" defaultValue={state.market ?? ""}>
                    <option value="">{w.allMarkets}</option>
                    {markets.map((market) => (
                      <option key={market.code} value={market.code}>
                        {market.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-source" className="text-sm font-medium">
                  {w.madeBy}
                </label>
                <Select id="orders-source" name="source" defaultValue={state.source ?? ""}>
                  <option value="">{w.anyone}</option>
                  {SOURCE_FILTERS.map((source) => (
                    <option key={source} value={source}>
                      {w.sources[source]}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-archived" className="text-sm font-medium">
                  {w.archived}
                </label>
                <Select id="orders-archived" name="archived" defaultValue={state.archived}>
                  <option value="no">{w.notArchived}</option>
                  <option value="yes">{w.onlyArchived}</option>
                  <option value="all">{w.both}</option>
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="orders-sort" className="text-sm font-medium">
                  {w.sort}
                </label>
                <Select id="orders-sort" name="sort" defaultValue={state.sort}>
                  {SORT_KEYS.map((sort) => (
                    <option key={sort} value={sort}>
                      {w.sorts[sort]}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" name="gift" value="1" defaultChecked={state.gift} className="size-4" />
              {w.giftsOnly}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <button type="submit" className={primary}>
                {w.apply}
              </button>
              <p className={hint}>{w.copiedNote}</p>
            </div>
          </div>
              </div>
            </details>
        }
      />

      {chips.length > 0 && (
        <ul aria-label={w.chipsLabel} className="flex flex-wrap gap-2">
          {chips.map((chip) => (
            <li key={chip.key}>
              <AdminLink href={clearHref(base, params, chip.key)} className="inline-flex min-h-8 items-center gap-1 rounded-full border border-line bg-sunken px-3 text-xs hover:bg-card" aria-label={fillWords(w.removeChip, { label: chip.label })}>
                {chip.label}
                <span aria-hidden="true">×</span>
              </AdminLink>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
