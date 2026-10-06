import Link from "next/link";

import { card, field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { momentText } from "@/lib/data-admin";
import { INVENTORY_RETENTION_MONTHS, MOVEMENT_REASONS, reasonWord } from "@/lib/inventory";
import { deltaText, figureText, historyHref, type HistoryQuery } from "@/lib/inventory-admin";
import type { HistoryRow } from "@/server/inventory";

/**
 * The stock history (wave 3, D172, `docs/wave-3-inventory.md` 2.2): every change of a level, newest first, with the location, the change and the new
 * figure, the reason and who or what made it (a staff member, an order or return, a file, the AI manager, the system). The filter is a plain GET form;
 * the next page is a link with the id to start after. A movement holds no personal data: the staff member's name is read for display only. Presentational.
 */
export function HistoryView({
  slug,
  rows,
  nextCursor,
  query,
  locations,
  timeZone,
}: {
  slug: string;
  rows: HistoryRow[];
  nextCursor: string | null;
  query: HistoryQuery;
  locations: { id: string; name: string; active: boolean }[];
  timeZone: string;
}) {
  const base = `/admin/${slug}/inventory/history`;
  const filtered = Boolean(query.sku || query.variant || query.location || query.reason || query.from || query.to);
  const keep = { sku: query.sku, variant: query.variant, location: query.location, reason: query.reason, from: query.from, to: query.to };
  return (
    <div className="flex flex-col gap-4">
      <form method="get" action={base} className={`${card} flex flex-wrap items-end gap-3`} role="search" aria-label="Filter the history">
        {query.variant && <input type="hidden" name="variant" value={query.variant} />}
        <div className="flex flex-col gap-1">
          <label htmlFor="history-sku" className="text-sm font-medium">
            SKU
          </label>
          <input id="history-sku" name="sku" defaultValue={query.sku} className={`${field} w-48 font-mono`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-location" className="text-sm font-medium">
            Location
          </label>
          <select id="history-location" name="location" defaultValue={query.location ?? ""} className={field}>
            <option value="">All locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.active ? "" : " (inactive)"}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-reason" className="text-sm font-medium">
            Reason
          </label>
          <select id="history-reason" name="reason" defaultValue={query.reason ?? ""} className={field}>
            <option value="">Any reason</option>
            {MOVEMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonWord(r)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-from" className="text-sm font-medium">
            From
          </label>
          <input id="history-from" type="date" name="from" defaultValue={query.from ?? ""} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-to" className="text-sm font-medium">
            To
          </label>
          <input id="history-to" type="date" name="to" defaultValue={query.to ?? ""} className={field} />
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
      {query.variant && <p className={hint}>Showing the changes of one variant.</p>}

      {rows.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">{filtered ? "No change matches this filter." : "No change of stock has been recorded yet."}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">Changes of stock levels, newest first</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  When
                </th>
                <th scope="col" className={th}>
                  Variant
                </th>
                <th scope="col" className={th}>
                  Location
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Change
                </th>
                <th scope="col" className={`${th} text-right`}>
                  New on hand
                </th>
                <th scope="col" className={th}>
                  Reason
                </th>
                <th scope="col" className={th}>
                  By
                </th>
                <th scope="col" className={th}>
                  Note
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{momentText(r.createdAt, timeZone)}</td>
                  <td className={td}>
                    {r.productId ? (
                      <Link href={`/admin/${slug}/products/${r.productId}`} className="font-medium underline-offset-2 hover:underline">
                        {r.title}
                      </Link>
                    ) : (
                      <span className="font-medium">{r.title}</span>
                    )}
                    {Object.values(r.options).length > 0 && <span className={`${hint} block`}>{Object.values(r.options).join(" / ")}</span>}
                    <Link href={historyHref(base, { variant: r.variantId })} className={`${hint} block font-mono underline-offset-2 hover:underline`}>
                      {r.sku}
                    </Link>
                  </td>
                  <td className={td}>{r.location}</td>
                  <td className={`${td} text-right tabular-nums`}>{deltaText(r.delta)}</td>
                  <td className={`${td} text-right tabular-nums`}>{figureText(r.onHandAfter)}</td>
                  <td className={td}>{reasonWord(r.reason)}</td>
                  <td className={td}>
                    {r.orderId ? (
                      <Link href={`/admin/${slug}/orders/${r.orderId}`} className="underline underline-offset-2">
                        {r.by}
                      </Link>
                    ) : r.returnId ? (
                      <Link href={`/admin/${slug}/returns/${r.returnId}`} className="underline underline-offset-2">
                        {r.by}
                      </Link>
                    ) : (
                      r.by
                    )}
                  </td>
                  <td className={`${td} break-words`}>{r.note ?? <span className={hint}>-</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label="Pages" className="flex flex-wrap items-center gap-3 text-sm">
        {query.after && (
          <Link href={historyHref(base, keep)} className="underline underline-offset-2">
            Back to the newest
          </Link>
        )}
        {nextCursor && (
          <Link href={historyHref(base, { ...keep, after: nextCursor })} className="underline underline-offset-2">
            Older changes
          </Link>
        )}
      </nav>
      <p className={hint}>
        The history is kept for {INVENTORY_RETENTION_MONTHS} months and cannot be edited: a wrong change is corrected by a new one. Times are in the store&apos;s time zone.
      </p>
    </div>
  );
}
