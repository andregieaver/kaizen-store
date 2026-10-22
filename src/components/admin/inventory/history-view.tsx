import Link from "next/link";

import { card, field, hint, primary, secondary, tableShell, td, th } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { INVENTORY_RETENTION_MONTHS, MOVEMENT_REASONS } from "@/lib/inventory";
import { historyHref, type HistoryQuery } from "@/lib/inventory-admin";
import { byIn, deltaIn, figureIn, momentIn, reasonIn } from "@/lib/inventory-words";
import type { HistoryRow } from "@/server/inventory";

/**
 * The stock history (wave 3, D172, `docs/wave-3-inventory.md` 2.2): every change of a level, newest first, with the location, the change and the new
 * figure, the reason and who or what made it (a staff member, an order or return, a file, the AI manager, the system). The filter is a plain GET form;
 * the next page is a link with the id to start after. A movement holds no personal data: the staff member's name is read for display only. Presentational,
 * in the admin's language (`lang`, D312 A5).
 */
export function HistoryView({
  slug,
  rows,
  nextCursor,
  query,
  locations,
  timeZone,
  lang = "en",
}: {
  slug: string;
  rows: HistoryRow[];
  nextCursor: string | null;
  query: HistoryQuery;
  locations: { id: string; name: string; active: boolean }[];
  timeZone: string;
  lang?: AdminLang;
}) {
  const t = adminText(lang, "inventory");
  const w = t.history;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const base = `/admin/${slug}/inventory/history`;
  const filtered = Boolean(query.sku || query.variant || query.location || query.reason || query.from || query.to);
  const keep = { sku: query.sku, variant: query.variant, location: query.location, reason: query.reason, from: query.from, to: query.to };
  return (
    <div className="flex flex-col gap-4">
      <form method="get" action={base} className={`${card} flex flex-wrap items-end gap-3`} role="search" aria-label={w.filter}>
        {query.variant && <input type="hidden" name="variant" value={query.variant} />}
        <div className="flex flex-col gap-1">
          <label htmlFor="history-sku" className="text-sm font-medium">
            {w.sku}
          </label>
          <input id="history-sku" name="sku" defaultValue={query.sku} className={`${field} w-48 font-mono`} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-location" className="text-sm font-medium">
            {w.location}
          </label>
          <select id="history-location" name="location" defaultValue={query.location ?? ""} className={field}>
            <option value="">{w.allLocations}</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
                {l.active ? "" : w.inactive}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-reason" className="text-sm font-medium">
            {w.reason}
          </label>
          <select id="history-reason" name="reason" defaultValue={query.reason ?? ""} className={field}>
            <option value="">{w.anyReason}</option>
            {MOVEMENT_REASONS.map((r) => (
              <option key={r} value={r}>
                {reasonIn(r, t)}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-from" className="text-sm font-medium">
            {w.from}
          </label>
          <input id="history-from" type="date" name="from" defaultValue={query.from ?? ""} className={field} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="history-to" className="text-sm font-medium">
            {w.to}
          </label>
          <input id="history-to" type="date" name="to" defaultValue={query.to ?? ""} className={field} />
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
      {query.variant && <p className={hint}>{w.oneVariant}</p>}

      {rows.length === 0 ? (
        <p className="rounded-panel bg-sunken p-6 text-center text-sm">{filtered ? w.noMatch : w.nothingYet}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">{w.caption}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  {w.when}
                </th>
                <th scope="col" className={th}>
                  {w.variant}
                </th>
                <th scope="col" className={th}>
                  {w.location}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.change}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.newOnHand}
                </th>
                <th scope="col" className={th}>
                  {w.reason}
                </th>
                <th scope="col" className={th}>
                  {w.by}
                </th>
                <th scope="col" className={th}>
                  {w.note}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const by = r.byFacts ? byIn(r.byFacts, t) : r.by;
                return (
                <tr key={r.id} className="border-b border-line last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{momentIn(r.createdAt, timeZone, locale)}</td>
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
                  <td className={`${td} text-right tabular-nums`}>{deltaIn(r.delta, locale)}</td>
                  <td className={`${td} text-right tabular-nums`}>{figureIn(r.onHandAfter, locale)}</td>
                  <td className={td}>{reasonIn(r.reason, t)}</td>
                  <td className={td}>
                    {r.orderId ? (
                      <Link href={`/admin/${slug}/orders/${r.orderId}`} className="underline underline-offset-2">
                        {by}
                      </Link>
                    ) : r.returnId ? (
                      <Link href={`/admin/${slug}/returns/${r.returnId}`} className="underline underline-offset-2">
                        {by}
                      </Link>
                    ) : (
                      by
                    )}
                  </td>
                  <td className={`${td} break-words`}>{r.note ?? <span className={hint}>-</span>}</td>
                </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <nav aria-label={w.pages} className="flex flex-wrap items-center gap-3 text-sm">
        {query.after && (
          <Link href={historyHref(base, keep)} className="underline underline-offset-2">
            {w.newest}
          </Link>
        )}
        {nextCursor && (
          <Link href={historyHref(base, { ...keep, after: nextCursor })} className="underline underline-offset-2">
            {w.older}
          </Link>
        )}
      </nav>
      <p className={hint}>
        {fillWords(w.kept, { months: INVENTORY_RETENTION_MONTHS })}
      </p>
    </div>
  );
}
