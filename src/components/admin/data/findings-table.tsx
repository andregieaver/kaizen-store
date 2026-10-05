import Link from "next/link";

import { SEVERITY_FILTERS, SEVERITY_WORDS, rowsPhrase, wholeNumber, type SeverityFilter } from "@/lib/data-admin";
import type { Finding, ItemOutcome } from "@/lib/data-job";

import { hint, tableShell, td, th } from "./ui";

/** One product's line of an import: what the file said about it and what happened (or would happen). */
export type FindingItem = { seq: number; ref: string | null; rows: number[]; outcome: ItemOutcome; will: string | null; messages: Finding[] };

const OUTCOME_WORDS: Record<string, string> = {
  created: "Created",
  updated: "Updated",
  unchanged: "Unchanged",
  skipped: "Skipped",
  drafted: "Saved as a draft",
  failed: "Failed",
};
const WILL_WORDS: Record<string, string> = {
  created: "Would be created",
  updated: "Would be updated",
  unchanged: "Unchanged",
  skipped: "Would be skipped",
  drafted: "Would be saved as a draft",
};

export const outcomeWords = (item: Pick<FindingItem, "outcome" | "will">): string =>
  item.outcome === "checked" ? (item.will ? (WILL_WORDS[item.will] ?? "Checked") : "Checked") : (OUTCOME_WORDS[item.outcome] ?? item.outcome);

const SEVERITY_STYLE = { error: "text-red-700 dark:text-red-400", warning: "text-amber-700 dark:text-amber-400", info: "text-muted" } as const;

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
}: {
  items: FindingItem[];
  total: number;
  severity: SeverityFilter;
  page: number;
  pageSize: number;
  hrefFor: (query: { severity?: SeverityFilter; page?: number }) => string;
  problemsHref: string | null;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section aria-labelledby="findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="findings-title" className="text-base font-semibold">
          What the file says, product by product
        </h2>
        {problemsHref && (
          <form method="post" action={problemsHref}>
            <button type="submit" className="text-sm underline underline-offset-2">
              Download the problems as CSV
            </button>
          </form>
        )}
      </div>
      <nav aria-label="Filter by severity" className="flex flex-wrap gap-2 text-sm">
        {SEVERITY_FILTERS.map((s) => (
          <Link key={s} href={hrefFor({ severity: s })} aria-current={severity === s ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-surface aria-[current=page]:font-semibold">
            {s === "all" ? "All products" : `${SEVERITY_WORDS[s]}s`}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">{severity === "all" ? "Nothing to show." : "No product has a finding of this kind."}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">Products of the file with what was found, {wholeNumber(total)} in all</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  Rows
                </th>
                <th scope="col" className={th}>
                  Product
                </th>
                <th scope="col" className={th}>
                  Result
                </th>
                <th scope="col" className={th}>
                  Findings
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.seq} className="border-b border-border last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{rowsPhrase(item.rows)}</td>
                  <td className={`${td} break-all font-medium`}>{item.ref ?? ""}</td>
                  <td className={td}>{outcomeWords(item)}</td>
                  <td className={td}>
                    {item.messages.length === 0 ? (
                      <span className={hint}>Nothing to note</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {item.messages.map((m, i) => (
                          <li key={`${m.code}-${i}`}>
                            <span className={`font-medium ${SEVERITY_STYLE[m.severity]}`}>{SEVERITY_WORDS[m.severity]}</span> <code className="text-xs text-muted">{m.code}</code> {m.text}
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
        <nav aria-label="Pages" className="flex items-center justify-between text-sm">
          {page > 1 ? (
            <Link href={hrefFor({ severity, page: page - 1 })} className="underline underline-offset-2">
              Earlier products
            </Link>
          ) : (
            <span />
          )}
          <span className={hint}>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={hrefFor({ severity, page: page + 1 })} className="underline underline-offset-2">
              Later products
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
