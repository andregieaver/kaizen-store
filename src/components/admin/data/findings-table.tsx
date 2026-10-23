import Link from "next/link";

import { adminText, type AdminAreaMessages } from "@/lib/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { SEVERITY_FILTERS, rowsPhrase, wholeNumber, type SeverityFilter } from "@/lib/data-admin";
import type { Finding, ItemOutcome } from "@/lib/data-job";

import { hint, tableShell, td, th } from "./ui";

/** One product's line of an import: what the file said about it and what happened (or would happen). */
export type FindingItem = { seq: number; ref: string | null; rows: number[]; outcome: ItemOutcome; will: string | null; messages: Finding[] };

/** The table's words; a page passes the account's language (D312 A11), English unless given. */
export type FindingsWords = AdminAreaMessages["bookings"]["findings"];
const EN: FindingsWords = adminText("en", "bookings").findings;

export const outcomeWords = (item: Pick<FindingItem, "outcome" | "will">, w: FindingsWords = EN): string => {
  const will = w.will as Record<string, string>;
  const outcome = w.outcome as Record<string, string>;
  return item.outcome === "checked" ? (item.will ? (will[item.will] ?? w.checked) : w.checked) : (outcome[item.outcome] ?? item.outcome);
};

const SEVERITY_STYLE = { error: "text-danger-text", warning: "text-warning-text", info: "text-muted" } as const;

/**
 * Every row's findings of an import (2.2.3): the rows of the file, the product's handle, how serious, the stable code, the column and a plain sentence.
 * The sentence is written from names and numbers (`finding()`), never a quoted cell. Filtered by severity and paged through the address, so it works
 * without a script. Presentational: the page gives the items it read for the store.
 */
export function FindingsTable({
  items,
  total,
  severity,
  page,
  pageSize,
  hrefFor,
  problemsHref,
  words: w = EN,
}: {
  items: FindingItem[];
  total: number;
  severity: SeverityFilter;
  page: number;
  pageSize: number;
  hrefFor: (query: { severity?: SeverityFilter; page?: number }) => string;
  problemsHref: string | null;
  words?: FindingsWords;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section aria-labelledby="findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="findings-title" className="text-title text-ink">
          {w.title}
        </h2>
        {problemsHref && (
          <form method="post" action={problemsHref}>
            <button type="submit" className="text-sm underline underline-offset-2">
              {w.download}
            </button>
          </form>
        )}
      </div>
      <nav aria-label={w.filter} className="flex flex-wrap gap-2 text-sm">
        {SEVERITY_FILTERS.map((s) => (
          <Link key={s} href={hrefFor({ severity: s })} aria-current={severity === s ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-sunken aria-[current=page]:font-medium">
            {s === "all" ? w.allProducts : w.severities[s]}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-panel bg-sunken p-6 text-center text-sm">{severity === "all" ? w.nothing : w.noneOfKind}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">{fillWords(w.caption, { n: wholeNumber(total) })}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  {w.rows}
                </th>
                <th scope="col" className={th}>
                  {w.product}
                </th>
                <th scope="col" className={th}>
                  {w.result}
                </th>
                <th scope="col" className={th}>
                  {w.findings}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.seq} className="border-b border-line last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{rowsPhrase(item.rows)}</td>
                  <td className={`${td} break-all font-medium`}>{item.ref ?? ""}</td>
                  <td className={td}>{outcomeWords(item, w)}</td>
                  <td className={td}>
                    {item.messages.length === 0 ? (
                      <span className={hint}>{w.nothingToNote}</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {item.messages.map((m, i) => (
                          <li key={`${m.code}-${i}`}>
                            <span className={`font-medium ${SEVERITY_STYLE[m.severity]}`}>{w.severity[m.severity]}</span> <code className="text-xs text-muted">{m.code}</code> {m.text}
                          </li>
                        ))}
                      </ul>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav aria-label={w.pages} className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={hrefFor({ severity, page: page - 1 })} className="underline underline-offset-2">
              {w.earlier}
            </Link>
          ) : (
            <span />
          )}
          <span className={hint}>
            {fillWords(w.pageOf, { page, pages })}
          </span>
          {page < pages ? (
            <Link href={hrefFor({ severity, page: page + 1 })} className="underline underline-offset-2">
              {w.later}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
