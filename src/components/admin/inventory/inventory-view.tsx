import Link from "next/link";

import { card, field, hint, primary, secondary } from "@/components/admin/data/ui";
import { STATUS_CHOICES, STATUS_WORDS, figureText, listHref, type ListQuery } from "@/lib/inventory-admin";
import type { InventoryPage } from "@/server/inventory";

import { InventoryTable, type InventoryTools } from "./inventory-table";

/**
 * The Inventory page's body (wave 3, D172, `docs/wave-3-inventory.md` 2.2): the counts of what needs a look (each a link that sets the filter), the filter
 * (a plain GET form, so it works without a script), the list and the next page. Presentational: the page gives what `inventoryPage()` read for the store
 * and the bound actions. A store with no goods that are shipped gets a sentence and a way to add a product, never an empty table.
 */
export function InventoryView({
  slug,
  page,
  query,
  canWrite,
  tools,
}: {
  slug: string;
  page: InventoryPage;
  query: ListQuery;
  canWrite: boolean;
  tools: InventoryTools;
}) {
  const base = `/admin/${slug}/inventory`;
  const applied = page.applied;
  const filtered = applied.search !== "" || applied.locationId !== null || applied.status !== "all";
  const counts: { id: "low" | "out" | "owed" | "negative"; label: string; n: number; link: Partial<ListQuery> | null }[] = [
    { id: "low", label: "At or below the low-stock level", n: page.counts.low, link: { status: "low" } },
    { id: "out", label: "Sold out", n: page.counts.out, link: { status: "out" } },
    { id: "owed", label: "Units owed on backorder", n: page.counts.owed, link: { status: "backorder" } },
    { id: "negative", label: "Below zero", n: page.counts.negative, link: { status: "negative" } },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label="What needs a look" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map((c) => (
          <div key={c.id} className={`${card} flex flex-col gap-1`}>
            <span className={hint}>{c.label}</span>
            <span className="text-2xl font-semibold tabular-nums">{figureText(c.n)}</span>
            {c.link && c.n > 0 && (
              <Link href={listHref(base, { ...c.link, location: applied.locationId })} className="text-xs underline underline-offset-2">
                Show them
              </Link>
            )}
          </div>
        ))}
      </section>

      <form method="get" action={base} className={`${card} flex flex-wrap items-end gap-3`} role="search" aria-label="Filter the list">
        <div className="flex flex-col gap-1">
          <label htmlFor="inventory-q" className="text-sm font-medium">
            Search
          </label>
          <input id="inventory-q" type="search" name="q" defaultValue={applied.search} placeholder="Title, handle or SKU" className={`${field} w-64`} />
        </div>
        {page.locations.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="inventory-location" className="text-sm font-medium">
              Location
            </label>
            <select id="inventory-location" name="location" defaultValue={applied.locationId ?? ""} className={field}>
              <option value="">All active locations</option>
              {page.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.active ? "" : " (inactive)"}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="inventory-status" className="text-sm font-medium">
            Show
          </label>
          <select id="inventory-status" name="status" defaultValue={applied.status} className={field}>
            {STATUS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {STATUS_WORDS[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={primary}>
          Filter
        </button>
        {filtered && (
          <Link href={base} className={secondary}>
            Clear the filter
          </Link>
        )}
      </form>

      {applied.locationId && (
        <p className={hint}>
          The figures are those of {page.locations.find((l) => l.id === applied.locationId)?.name ?? "the location"} alone.
        </p>
      )}

      {page.rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">
          {filtered ? (
            "No variant matches this filter."
          ) : (
            <>
              No goods that are shipped yet. Stock is kept for each variant of a product that is shipped;{" "}
              <Link href={`/admin/${slug}/products/new`} className="underline underline-offset-2">
                add a product
              </Link>
              .
            </>
          )}
        </p>
      ) : (
        <InventoryTable
          rows={page.rows}
          locations={page.locations}
          chosenLocationId={applied.locationId}
          canWrite={canWrite}
          tools={tools}
          historyBase={`${base}/history`}
          productBase={`/admin/${slug}/products`}
        />
      )}

      {(page.nextCursor || query.after) && (
        <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-sm">
          {query.after && (
            <Link href={listHref(base, { search: applied.search, location: applied.locationId, status: applied.status })} className="underline underline-offset-2">
              Back to the first page
            </Link>
          )}
          {page.nextCursor && (
            <Link href={listHref(base, { search: applied.search, location: applied.locationId, status: applied.status, after: page.nextCursor })} className="underline underline-offset-2">
              Next 50 variants
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}
