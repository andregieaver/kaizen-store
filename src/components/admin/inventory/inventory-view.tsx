import Link from "next/link";

import { card, field, hint, primary, secondary } from "@/components/admin/data/ui";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { STATUS_CHOICES, listHref, type ListQuery } from "@/lib/inventory-admin";
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
  query,
  canWrite,
  tools,
  lang = "en",
}: {
  slug: string;
  page: InventoryPage;
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
  const counts: { id: "low" | "out" | "owed" | "negative"; label: string; n: number; link: Partial<ListQuery> | null }[] = [
    { id: "low", label: w.counts.low, n: page.counts.low, link: { status: "low" } },
    { id: "out", label: w.counts.out, n: page.counts.out, link: { status: "out" } },
    { id: "owed", label: w.counts.owed, n: page.counts.owed, link: { status: "backorder" } },
    { id: "negative", label: w.counts.negative, n: page.counts.negative, link: { status: "negative" } },
  ];
  return (
    <div className="flex flex-col gap-4">
      <section aria-label={w.needsLook} className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {counts.map((c) => (
          <div key={c.id} className={`${card} flex flex-col gap-1`}>
            <span className={hint}>{c.label}</span>
            <span className="text-metric text-ink tabular-nums">{figureIn(c.n, locale)}</span>
            {c.link && c.n > 0 && (
              <Link href={listHref(base, { ...c.link, location: applied.locationId })} className="text-xs underline underline-offset-2">
                {w.showThem}
              </Link>
            )}
          </div>
        ))}
      </section>

      <form method="get" action={base} className={`${card} flex flex-wrap items-end gap-3`} role="search" aria-label={w.filter}>
        <div className="flex flex-col gap-1">
          <label htmlFor="inventory-q" className="text-sm font-medium">
            {w.search}
          </label>
          <input id="inventory-q" type="search" name="q" defaultValue={applied.search} placeholder={w.searchPlaceholder} className={`${field} w-64`} />
        </div>
        {page.locations.length > 1 && (
          <div className="flex flex-col gap-1">
            <label htmlFor="inventory-location" className="text-sm font-medium">
              {w.location}
            </label>
            <select id="inventory-location" name="location" defaultValue={applied.locationId ?? ""} className={field}>
              <option value="">{w.allActive}</option>
              {page.locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                  {l.active ? "" : w.inactive}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="flex flex-col gap-1">
          <label htmlFor="inventory-status" className="text-sm font-medium">
            {w.show}
          </label>
          <select id="inventory-status" name="status" defaultValue={applied.status} className={field}>
            {STATUS_CHOICES.map((s) => (
              <option key={s} value={s}>
                {t.status[s]}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className={primary}>
          {w.filterButton}
        </button>
        {filtered && (
          <Link href={base} className={secondary}>
            {w.clear}
          </Link>
        )}
      </form>

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
