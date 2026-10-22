import Link from "next/link";

import { card, hint, tableShell, td, th } from "@/components/admin/data/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import type { InventoryMessages } from "@/lib/admin-messages/inventory.en";
import { adminText } from "@/lib/admin-text";
import { SEVERITY_FILTERS, type SeverityFilter } from "@/lib/data-admin";
import type { Finding, ItemOutcome } from "@/lib/data-job";
import { deltaIn, figureIn, numberIn, rowsIn } from "@/lib/inventory-words";

const wholeIn = (n: number, lang: AdminLang) => numberIn(Math.round(n), ADMIN_LANG_FACTS[lang].locale);

/** The numbers of a dry run: what an import would do. In the admin's language (`lang`, D312 A5), as are the parts below. */
export function StockDryRun({ counts, lang = "en" }: { counts: { toUpdate: number; unchanged: number; conflicts: number; withProblems: number }; lang?: AdminLang }) {
  const w = adminText(lang, "inventory").import.dry;
  const items: [string, number][] = [
    [w.toChange, counts.toUpdate],
    [w.unchanged, counts.unchanged],
    [w.outOfDate, counts.conflicts],
    [w.withProblems, counts.withProblems],
  ];
  return (
    <section aria-label={w.label} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{w.label}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{wholeIn(n, lang)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        {w.hintStart} <code>on_hand_was</code> {w.hintEnd}
      </p>
    </section>
  );
}

/** The outcome of an applied import: the rows by what happened. */
export function StockApplied({
  counts,
  jobId,
  written,
  lang = "en",
}: {
  counts: { updated: number; unchanged: number; skipped: number; failed: number };
  jobId: string;
  written: boolean;
  lang?: AdminLang;
}) {
  const w = adminText(lang, "inventory").import.applied;
  const items: [string, number][] = [
    [w.changed, counts.updated],
    [w.unchanged, counts.unchanged],
    [w.skipped, counts.skipped],
    [w.failed, counts.failed],
  ];
  return (
    <section aria-label={w.label} className={`${card} flex flex-col gap-3`}>
      <h2 className="text-title text-ink">{written ? w.written : w.stopped}</h2>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {items.map(([name, n]) => (
          <div key={name} className="flex flex-col">
            <dt className={hint}>{name}</dt>
            <dd className="text-metric text-ink tabular-nums">{wholeIn(n, lang)}</dd>
          </div>
        ))}
      </dl>
      <p className={hint}>
        {w.reference} <code>{jobId}</code>. {w.referenceEnd}
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

/** What a row's result is called: the check's advice, or what the apply did, in the words given (English unless given). */
export function stockResultWords(item: Pick<StockItem, "outcome" | "will">, words: Pick<InventoryMessages["import"], "will" | "done"> = adminText("en", "inventory").import): string {
  const will: Record<string, string | undefined> = words.will;
  const done: Record<string, string | undefined> = words.done;
  if (item.outcome === "checked") return item.will && item.will !== "checked" ? (will[item.will] ?? words.will.checked) : words.will.checked;
  return done[item.outcome] ?? item.outcome;
}

const SEVERITY_STYLE = { error: "text-danger-text", warning: "text-warning-text", info: "text-muted" } as const;

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
  lang = "en",
}: {
  items: StockItem[];
  total: number;
  severity: SeverityFilter;
  page: number;
  pageSize: number;
  hrefFor: (query: { severity?: SeverityFilter; page?: number }) => string;
  problemsHref: string | null;
  lang?: AdminLang;
}) {
  const t = adminText(lang, "inventory").import;
  const w = t.findings;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <section aria-labelledby="stock-findings-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="stock-findings-title" className="text-title text-ink">
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
            <caption className="sr-only">{fillWords(w.caption, { n: wholeIn(total, lang) })}</caption>
            <thead>
              <tr className="border-b border-line">
                <th scope="col" className={th}>
                  {w.rows}
                </th>
                <th scope="col" className={th}>
                  {w.sku}
                </th>
                <th scope="col" className={th}>
                  {w.location}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.now}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.new}
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.change}
                </th>
                <th scope="col" className={th}>
                  {w.result}
                </th>
                <th scope="col" className={th}>
                  {w.found}
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.seq} className="border-b border-line last:border-0">
                  <td className={`${td} whitespace-nowrap`}>{rowsIn(item.rows, w)}</td>
                  <td className={`${td} break-all font-mono text-xs`}>{item.ref ?? <span className={hint}>{w.wholeFile}</span>}</td>
                  <td className={td}>{item.location ?? ""}</td>
                  <td className={`${td} text-right tabular-nums`}>{item.current === null ? "" : figureIn(item.current, locale)}</td>
                  <td className={`${td} text-right tabular-nums`}>{item.next === null ? "" : figureIn(item.next, locale)}</td>
                  <td className={`${td} text-right tabular-nums`}>{item.change === null ? "" : deltaIn(item.change, locale)}</td>
                  <td className={td}>{item.ref ? stockResultWords(item, t) : ""}</td>
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
