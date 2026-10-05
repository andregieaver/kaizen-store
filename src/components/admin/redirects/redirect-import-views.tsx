import Link from "next/link";

import type { FindingItem } from "@/components/admin/data/findings-table";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { SEVERITY_FILTERS, SEVERITY_WORDS, rowsPhrase, wholeNumber, type SeverityFilter } from "@/lib/data-admin";
import { lineResultWords } from "@/lib/redirect-admin";

/** The numbers of a dry run: what an import would do (2.2.4 step 3). */
export function RedirectDryRun({ counts }: { counts: { toCreate: number; toReplace: number; unchanged: number; skipped: number; withErrors: number } }) {
  const items: [string, number][] = [
    ["To create", counts.toCreate],
    ["To replace", counts.toReplace],
    ["Unchanged", counts.unchanged],
    ["Skipped", counts.skipped],
    ["With errors", counts.withErrors],
  ];
  return (
    <section aria-label="What the check found" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">What the check found</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-2xl font-semibold">{wholeNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        Nothing has changed in your store. The whole file is judged as one set against your redirects, in the order of the file; a line with an error is skipped and nothing of it is written. The check is advice: every line is
        checked again as it is written.
      </p>
    </section>
  );
}

/** The outcome of an applied import: the lines by what happened. */
export function RedirectApplied({ counts, jobId, written }: { counts: { created: number; updated: number; unchanged: number; skipped: number; failed: number }; jobId: string; written: boolean }) {
  const items: [string, number][] = [
    ["Created", counts.created],
    ["Replaced", counts.updated],
    ["Already there", counts.unchanged],
    ["Skipped", counts.skipped],
    ["Not imported", counts.failed],
  ];
  return (
    <section aria-label="Result" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">{written ? "What was imported" : "What was imported before it stopped"}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-2xl font-semibold">{wholeNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        Reference for the activity log: <code>{jobId}</code>. The new redirects work at once.
      </p>
    </section>
  );
}

const SEVERITY_STYLE = { error: "text-red-700 dark:text-red-400", warning: "text-amber-700 dark:text-amber-400", info: "text-muted" } as const;

/**
 * Every line's findings of an import (2.2.4 step 3): the rows of the file, the address the line goes from, what happened or would happen, and each finding
 * with its severity, stable code and a plain sentence that names only addresses (`finding()` never quotes any other cell). Filtered by severity and paged
 * through the address, so it works without a script. Presentational: the page gives the items it read for the store.
 */
export function RedirectFindings({
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
    <section aria-labelledby="redirect-findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="redirect-findings-title" className="text-base font-semibold">
          What the file says, line by line
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
            {s === "all" ? "All lines" : `${SEVERITY_WORDS[s]}s`}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">{severity === "all" ? "Nothing to show." : "No line has a finding of this kind."}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">Lines of the file with what was found, {wholeNumber(total)} in all</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  Rows
                </th>
                <th scope="col" className={th}>
                  Redirect from
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
                  <td className={`${td} break-all`}>{item.ref ? <code className="text-xs">{item.ref}</code> : <span className={hint}>The file as a whole</span>}</td>
                  <td className={td}>{item.ref ? lineResultWords(item.outcome, item.will) : ""}</td>
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
              Earlier lines
            </Link>
          ) : (
            <span />
          )}
          <span className={hint}>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={hrefFor({ severity, page: page + 1 })} className="underline underline-offset-2">
              Later lines
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
