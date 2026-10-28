import Link from "next/link";

import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { SEVERITY_FILTERS, type SeverityFilter } from "@/lib/data-admin";
import type { Finding, ItemOutcome } from "@/lib/data-job";
import { numberIn, rowsIn } from "@/lib/inventory-words";

/**
 * What a customer import found and did (wave 10 unit C, D366), presentational: the dry run's numbers, the apply's, and every row with its
 * findings. A row is named by its number in the file only: its email, name or phone is a person's data, and a finding never quotes a cell.
 * The words shared with the stock import are the `inventory` catalogue's.
 */

const SEVERITY_STYLE = { error: "text-danger-text", warning: "text-warning-text", info: "text-muted" } as const;

function Figures({ title, label, items, lang }: { title: string; label: string; items: [string, number][]; lang: AdminLang }) {
  return (
    <section aria-label={label} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{title}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{numberIn(n, ADMIN_LANG_FACTS[lang].locale)}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export function CustomerDryRun({ counts, lang }: { counts: { toCreate: number; toUpdate: number; withProblems: number }; lang: AdminLang }) {
  const w = adminText(lang, "customers").staff.import.dry;
  return <Figures title={w.label} label={w.label} lang={lang} items={[[w.toCreate, counts.toCreate], [w.toUpdate, counts.toUpdate], [w.withProblems, counts.withProblems]]} />;
}

export function CustomerApplied({ counts, written, lang }: { counts: { created: number; updated: number; skipped: number; failed: number }; written: boolean; lang: AdminLang }) {
  const w = adminText(lang, "customers").staff.import.applied;
  return (
    <Figures
      title={written ? w.written : w.stopped}
      label={w.label}
      lang={lang}
      items={[[w.created, counts.created], [w.updated, counts.updated], [w.skipped, counts.skipped], [w.failed, counts.failed]]}
    />
  );
}

export type CustomerItem = { seq: number; rows: number[]; outcome: ItemOutcome; will: string | null; file: boolean; messages: Finding[] };

/** What a row's result is called: the check's advice, or what the apply did. */
function resultOf(item: CustomerItem, lang: AdminLang): string {
  const w = adminText(lang, "customers").staff.import;
  const will: Record<string, string | undefined> = w.will;
  const done: Record<string, string | undefined> = w.done;
  if (item.outcome === "checked") return (item.will && will[item.will]) || "";
  return done[item.outcome] ?? "";
}

/** Every row's result, filtered by severity and paged through the address, so it works without a script. */
export function CustomerFindings({
  items,
  total,
  severity,
  page,
  pageSize,
  hrefFor,
  problemsHref,
  lang,
}: {
  items: CustomerItem[];
  total: number;
  severity: SeverityFilter;
  page: number;
  pageSize: number;
  hrefFor: (query: { severity?: SeverityFilter; page?: number }) => string;
  problemsHref: string;
  lang: AdminLang;
}) {
  const w = adminText(lang, "inventory").import.findings;
  const own = adminText(lang, "customers").staff.import;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section aria-labelledby="customer-findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="customer-findings-title" className="text-title text-ink">
          {w.title}
        </h2>
        <form method="post" action={problemsHref}>
          <button type="submit" className="text-sm underline underline-offset-2">
            {w.download}
          </button>
        </form>
      </div>
      <nav aria-label={w.bySeverity} className="flex flex-wrap gap-2 text-sm">
        {SEVERITY_FILTERS.map((s) => (
          <Link key={s} href={hrefFor({ severity: s })} aria-current={severity === s ? "page" : undefined} className="rounded px-2 py-1 aria-[current=page]:bg-sunken aria-[current=page]:font-medium">
            {s === "all" ? w.allRows : w.severities[s]}
          </Link>
        ))}
      </nav>
      {items.length === 0 ? (
        <p className="rounded-panel bg-sunken p-6 text-center text-sm">{severity === "all" ? w.nothing : w.noneOfKind}</p>
      ) : (
        <div className={tableShell}>
          <table className="w-full text-sm">
            <caption className="sr-only">{fillWords(w.caption, { n: numberIn(total, ADMIN_LANG_FACTS[lang].locale) })}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  {w.rows}
                </th>
                <th scope="col" className={th}>
                  {own.result}
                </th>
                <th scope="col" className={th}>
                  {w.found}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.seq} className="border-b border-line last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{item.file ? <span className={hint}>{w.wholeFile}</span> : rowsIn(item.rows, w)}</td>
                  <td className={td}>{item.file ? "" : resultOf(item, lang)}</td>
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
          <span className={hint}>{fillWords(w.pageOf, { page, pages })}</span>
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
