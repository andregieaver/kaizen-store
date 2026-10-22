import Link from "next/link";

import type { FindingItem } from "@/components/admin/data/findings-table";
import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { SEVERITY_FILTERS, SEVERITY_WORDS, rowsPhrase, wholeNumber, type SeverityFilter } from "@/lib/data-admin";
import { fillWords } from "@/lib/admin-fill";
import { redirectsEn, type RedirectsMessages } from "@/lib/admin-messages/redirects.en";
import { lineResultWords } from "@/lib/redirect-admin";
import { redirectFindingText } from "@/lib/redirect-words";

/** The numbers of a dry run: what an import would do (2.2.4 step 3). */
export function RedirectDryRun({
  counts,
  words = redirectsEn,
  locale = "en-GB",
}: {
  counts: { toCreate: number; toReplace: number; unchanged: number; skipped: number; withErrors: number };
  words?: RedirectsMessages;
  locale?: string;
}) {
  const d = words.import.dry;
  const items: [string, number][] = [
    [d.toCreate, counts.toCreate],
    [d.toReplace, counts.toReplace],
    [d.unchanged, counts.unchanged],
    [d.skipped, counts.skipped],
    [d.withErrors, counts.withErrors],
  ];
  return (
    <section aria-label={d.title} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{d.title}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{wholeNumber(n, locale)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>{d.note}</p>
    </section>
  );
}


/** The outcome of an applied import: the lines by what happened. */
export function RedirectApplied({
  counts,
  jobId,
  written,
  words = redirectsEn,
  locale = "en-GB",
}: {
  counts: { created: number; updated: number; unchanged: number; skipped: number; failed: number };
  jobId: string;
  written: boolean;
  words?: RedirectsMessages;
  locale?: string;
}) {
  const a = words.import.applied;
  const items: [string, number][] = [
    [a.created, counts.created],
    [a.replaced, counts.updated],
    [a.already, counts.unchanged],
    [a.skipped, counts.skipped],
    [a.failed, counts.failed],
  ];
  return (
    <section aria-label={a.label} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{written ? a.done : a.stopped}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{wholeNumber(n, locale)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        {a.reference} <code>{jobId}</code>. {a.works}
      </p>
    </section>
  );
}

const SEVERITY_STYLE = { error: "text-danger-text", warning: "text-warning-text", info: "text-muted" } as const;

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
  words = redirectsEn,
  locale = "en-GB",
}: {
  words?: RedirectsMessages;
  locale?: string;
  items: FindingItem[];
  total: number;
  severity: SeverityFilter;
  page: number;
  pageSize: number;
  hrefFor: (query: { severity?: SeverityFilter; page?: number }) => string;
  problemsHref: string | null;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const f = words.import.findings;
  return (
    <section aria-labelledby="redirect-findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="redirect-findings-title" className="text-title text-ink">
          {f.title}
        </h2>
        {problemsHref && (
          <form method="post" action={problemsHref}>
            <button type="submit" className="text-sm underline underline-offset-2">
              {f.download}
            </button>
          </form>
        )}
      </div>
      <nav aria-label={f.filter} className="flex flex-wrap gap-2 text-sm">
        {SEVERITY_FILTERS.map((s) => (
          <Link key={s} href={hrefFor({ severity: s })} aria-current={severity === s ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-sunken aria-[current=page]:font-medium">
            {s === "all" ? f.allLines : `${SEVERITY_WORDS[s]}s`}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-panel bg-sunken p-6 text-center text-sm">{severity === "all" ? f.nothing : f.noneOfKind}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">{fillWords(f.caption, { n: wholeNumber(total, locale) })}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  {f.rows}
                </th>
                <th scope="col" className={th}>
                  {f.from}
                </th>
                <th scope="col" className={th}>
                  {f.result}
                </th>
                <th scope="col" className={th}>
                  {f.findings}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.seq} className="border-b border-line last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{rowsPhrase(item.rows)}</td>
                  <td className={`${td} break-all`}>{item.ref ? <code className="text-xs">{item.ref}</code> : <span className={hint}>{f.wholeFile}</span>}</td>
                  <td className={td}>{item.ref ? lineResultWords(item.outcome, item.will, words) : ""}</td>
                  <td className={td}>
                    {item.messages.length === 0 ? (
                      <span className={hint}>{f.nothingToNote}</span>
                    ) : (
                      <ul className="flex flex-col gap-1">
                        {item.messages.map((m, i) => (
                          <li key={`${m.code}-${i}`}>
                            <span className={`font-medium ${SEVERITY_STYLE[m.severity]}`}>{SEVERITY_WORDS[m.severity]}</span> <code className="text-xs text-muted">{m.code}</code> {redirectFindingText(m, words)}
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
              {f.earlier}
            </Link>
          ) : (
            <span />
          )}
          <span className={hint}>
            {fillWords(words.common.pageOf, { page, pages })}
          </span>
          {page < pages ? (
            <Link href={hrefFor({ severity, page: page + 1 })} className="underline underline-offset-2">
              {f.later}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      )}
    </section>
  );
}
