import Link from "next/link";

import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { SEVERITY_FILTERS, SEVERITY_WORDS, rowsPhrase, wholeNumber, type SeverityFilter } from "@/lib/data-admin";
import type { Finding, ItemOutcome } from "@/lib/data-job";
import { deltaText, figureText } from "@/lib/inventory-admin";

/** The numbers of a dry run: what an import would do. */
export function StockDryRun({ counts }: { counts: { toUpdate: number; unchanged: number; conflicts: number; withProblems: number } }) {
  const items: [string, number][] = [
    ["To change", counts.toUpdate],
    ["Unchanged", counts.unchanged],
    ["Out of date", counts.conflicts],
    ["With problems", counts.withProblems],
  ];
  return (
    <section aria-label="What the check found" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">What the check found</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{wholeNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        Nothing has changed in your store. A row that is out of date has an <code>on_hand_was</code> that is no longer the stock; it is left alone. A row with a problem is skipped and the others go on. The check is advice: every row is checked
        again as it is written.
      </p>
    </section>
  );
}

/** The outcome of an applied import: the rows by what happened. */
export function StockApplied({ counts, jobId, written }: { counts: { updated: number; unchanged: number; skipped: number; failed: number }; jobId: string; written: boolean }) {
  const items: [string, number][] = [
    ["Changed", counts.updated],
    ["Unchanged", counts.unchanged],
    ["Skipped (out of date or a problem)", counts.skipped],
    ["Not saved", counts.failed],
  ];
  return (
    <section aria-label="Result" className={`${card} flex flex-col gap-3`}>
      <h2 className="text-base font-semibold">{written ? "What was imported" : "What was imported before it stopped"}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{wholeNumber(n)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        Reference for the activity log and the history: <code>{jobId}</code>. Each change is in the stock history with the reason of its row.
      </p>
    </section>
  );
}

/** One row of the file as the check or the apply judged it. */
export type StockItem = {
  seq: number;
  /** The SKU the row names; null for a finding about the file as a whole. */
  ref: string | null;
  rows: number[];
  outcome: ItemOutcome;
  /** What the row would do (`update`, `unchanged`, `conflict`, `skip`), and the figures, for a row that names a variant at a location. */
  will: string | null;
  location: string | null;
  current: number | null;
  next: number | null;
  change: number | null;
  messages: Finding[];
};

const WILL_WORDS: Record<string, string> = { update: "Would be changed", unchanged: "Unchanged", conflict: "Out of date: left alone", skip: "Would be skipped" };
const DONE_WORDS: Record<string, string> = { updated: "Changed", unchanged: "Unchanged", skipped: "Skipped", failed: "Not saved" };

/** What a row's result is called: the check's advice, or what the apply did. */
export const stockResultWords = (item: Pick<StockItem, "outcome" | "will">): string =>
  item.outcome === "checked" ? (item.will ? (WILL_WORDS[item.will] ?? "Checked") : "Checked") : (DONE_WORDS[item.outcome] ?? item.outcome);

const SEVERITY_STYLE = { error: "text-red-700 dark:text-red-400", warning: "text-amber-700 dark:text-amber-400", info: "text-muted" } as const;

/**
 * Every row's result of a stock import: the rows of the file, the SKU and location, the figure now and after, what happens, and each finding with its
 * severity, stable code and a plain sentence that names only SKUs and numbers (`finding()` never quotes any other cell). Filtered by severity and paged
 * through the address, so it works without a script. Presentational: the page gives the items it read for the store.
 */
export function StockFindings({
  items,
  total,
  severity,
  page,
  pageSize,
  hrefFor,
  problemsHref,
}: {
  items: StockItem[];
  total: number;
  severity: SeverityFilter;
  page: number;
  pageSize: number;
  hrefFor: (query: { severity?: SeverityFilter; page?: number }) => string;
  problemsHref: string | null;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section aria-labelledby="stock-findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="stock-findings-title" className="text-base font-semibold">
          What the file says, row by row
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
            {s === "all" ? "All rows" : `${SEVERITY_WORDS[s]}s`}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-6 text-center text-sm">{severity === "all" ? "Nothing to show." : "No row has a finding of this kind."}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">Rows of the file with what was found, {wholeNumber(total)} in all</caption>
            <thead>
              <tr className="border-b border-border">
                <th scope="col" className={th}>
                  Rows
                </th>
                <th scope="col" className={th}>
                  SKU
                </th>
                <th scope="col" className={th}>
                  Location
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Now
                </th>
                <th scope="col" className={`${th} text-right`}>
                  New
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Change
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
                  <td className={`${td} break-all font-mono text-xs`}>{item.ref ?? <span className={hint}>The file as a whole</span>}</td>
                  <td className={td}>{item.location ?? ""}</td>
                  <td className={`${td} text-right tabular-nums`}>{item.current === null ? "" : figureText(item.current)}</td>
                  <td className={`${td} text-right tabular-nums`}>{item.next === null ? "" : figureText(item.next)}</td>
                  <td className={`${td} text-right tabular-nums`}>{item.change === null ? "" : deltaText(item.change)}</td>
                  <td className={td}>{item.ref ? stockResultWords(item) : ""}</td>
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
              Earlier rows
            </Link>
          ) : (
            <span />
          )}
          <span className={hint}>
            Page {page} of {pages}
          </span>
          {page < pages ? (
            <Link href={hrefFor({ severity, page: page + 1 })} className="underline underline-offset-2">
              Later rows
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
