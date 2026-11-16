import { CHIP_ITEM, CHIP_STRIP } from "@/lib/chip-strip";
import Link from "next/link";

import { field, hint } from "@/components/admin/data/ui";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { Search } from "lucide-react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { listHref, type ListQuery } from "@/lib/inventory-admin";
import { figureIn } from "@/lib/inventory-words";
import type { InventoryPage } from "@/server/inventory";

import { InventoryTable, type InventoryTools } from "./inventory-table";

/**
 * The Inventory page's body (wave 3, D172, `docs/wave-3-inventory.md` 2.2): the counts of what needs a look (each a link that sets the filter), the filter
 * (a plain GET form, so it works without a script), the list and the next page. Presentational: the page gives what `inventoryPage()` read for the store
 * and the bound actions. A store with no goods that are shipped gets a sentence and a way to add a product, never an empty table. In the admin's language
 * (`lang`, D312 A5); the table reads the same words through `useAdminText("inventory")`.
 */
export function InventoryView({
  slug,
  page,
  pictures = {},
  query,
  canWrite,
  tools,
  lang = "en",
}: {
  slug: string;
  page: InventoryPage;
  /** Each variant's picture by id (round 7, D624). */
  pictures?: Record<string, string | null>;
  query: ListQuery;
  canWrite: boolean;
  tools: InventoryTools;
  lang?: AdminLang;
}) {
  const t = adminText(lang, "inventory");
  const w = t.list;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const base = `/admin/${slug}/inventory`;
  const applied = page.applied;
  const filtered = applied.search !== "" || applied.locationId !== null || applied.status !== "all";
  const chips: { status: "all" | "out" | "low" | "backorder" | "negative"; n: number | null }[] = [
    { status: "all", n: page.counts.variants },
    { status: "out", n: page.counts.out },
    { status: "low", n: page.counts.low },
    { status: "backorder", n: null },
    ...(page.counts.negative > 0 || applied.status === "negative" ? [{ status: "negative" as const, n: page.counts.negative }] : []),
  ];
  return (
    <div className="flex flex-col gap-4">
      {/* Round 7 (D624): what needs a look in a sentence, the same as chips that set the filter, and a search (a plain GET form). */}
      <p className="max-w-3xl text-body-lg text-ink-2">
        {page.counts.out === 0 && page.counts.low === 0 ? (
          <span className="text-ink">{w.sentence.fine}</span>
        ) : (
          <span className="text-ink">
            {page.counts.out > 0
              ? `${countWords(page.counts.out, w.sentence.out)}${page.counts.low > 0 ? `${w.sentence.and}${countWords(page.counts.low, w.sentence.low)}` : ""}`
              : countWords(page.counts.low, w.sentence.lowOnly)}
            {w.sentence.end}
          </span>
        )}
        {canWrite && w.sentence.rest}
      </p>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav aria-label={w.show} className={`min-w-0 max-sm:basis-full ${CHIP_STRIP.replace("gap-2", "gap-1.5")}`}>
          {chips.map((c) => {
            const current = applied.status === c.status;
            return (
              <Link
                key={c.status}
                href={listHref(base, { status: c.status, location: applied.locationId, search: applied.search })}
                aria-current={current ? "page" : undefined}
                className={`${CHIP_ITEM} inline-flex h-9 items-center gap-1.5 rounded-pill px-3.5 text-caption ${current ? "bg-inverse text-inverse-ink" : "border border-edge bg-card text-ink hover:bg-sunken"}`}
              >
                {w.chips[c.status]} {c.n !== null && <span className={current ? "" : "text-muted"}>{figureIn(c.n, locale)}</span>}
              </Link>
            );
          })}
        </nav>
        <form method="get" action={base} role="search" aria-label={w.filter} className="flex flex-wrap items-center gap-2">
          {applied.status !== "all" && <input type="hidden" name="status" value={applied.status} />}
          {page.locations.length > 1 && (
            <select name="location" aria-label={w.location} defaultValue={applied.locationId ?? ""} className={`${field} h-10`}>
              <option value="">{w.allActive}</option>
              {page.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.active ? "" : w.inactive}
                </option>
              ))}
            </select>
          )}
          <label className="flex h-10 w-64 items-center gap-2 rounded-pill border border-edge bg-card px-3.5">
            <Search aria-hidden className="size-4 shrink-0 text-muted" />
            <input type="search" name="q" defaultValue={applied.search} aria-label={w.search} placeholder={w.find} className="min-w-0 flex-1 bg-transparent text-body text-ink outline-none" />
          </label>
          <button type="submit" className="sr-only">{w.filterButton}</button>
          {filtered && (
            <Link href={base} className="text-body text-brand-text hover:underline">
              {w.clear}
            </Link>
          )}
        </form>
      </div>

      {applied.locationId && (
        <p className={hint}>
          {fillWords(w.figuresOf, { location: page.locations.find((l) => l.id === applied.locationId)?.name ?? w.theLocation })}
        </p>
      )}

      {page.rows.length === 0 ? (
        <p className="rounded-panel bg-sunken p-6 text-center text-sm">
          {filtered ? (
            w.noMatch
          ) : (
            <>
              {w.noGoods}
              <Link href={`/admin/${slug}/products/new`} className="underline underline-offset-2">
                {w.addProduct}
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <InventoryTable
          rows={page.rows}
          pictures={pictures}
          locations={page.locations}
          chosenLocationId={applied.locationId}
          canWrite={canWrite}
          tools={tools}
          historyBase={`${base}/history`}
          productBase={`/admin/${slug}/products`}
        />
      )}

      {(page.nextCursor || query.after) && (
        <nav aria-label={w.pages} className="flex flex-wrap items-center gap-3 text-sm">
          {query.after && (
            <Link href={listHref(base, { search: applied.search, location: applied.locationId, status: applied.status })} className="underline underline-offset-2">
              {w.firstPage}
            </Link>
          )}
          {page.nextCursor && (
            <Link href={listHref(base, { search: applied.search, location: applied.locationId, status: applied.status, after: page.nextCursor })} className="underline underline-offset-2">
              {w.nextPage}
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
