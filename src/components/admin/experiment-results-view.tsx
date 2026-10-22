import { countWords, fillWords } from "@/lib/admin-fill";
import { experimentsEn, type ExperimentsMessages } from "@/lib/admin-messages/experiments.en";
import { compareToOriginal, normalQuantile, type VariantFigures } from "@/lib/experiment-results";
import { GOAL_WORDS } from "@/lib/experiments";
import { formatMoney } from "@/lib/money";
import type { ExperimentInfo } from "@/server/experiment-admin";
import type { ExperimentResults } from "@/server/experiment-results";
import { CARD_CLASS } from "@/components/admin/ui";

const SOFT = { few: "border-line", early: "border-line", better: "border-positive-text", worse: "border-danger-text", even: "border-line", broken: "border-danger-text" } as const;
const COLORS = ["#6b7280", "#2563eb", "#d97706", "#7c3aed"];

const percentIn = (locale: string) => (share: number, digits = 1) => `${(share * 100).toLocaleString(locale, { maximumFractionDigits: digits })} %`;

/** One version's name: the original is "Original", the others "Version B". */
const nameOf = (test: ExperimentInfo, key: string) => test.variants.find((v) => v.key === key)?.name ?? key.toUpperCase();

/** Cumulative conversion rate per version over the days of the test: a line each, drawn as plain SVG. */
function Trend({ test, results, words, numberLocale }: { test: ExperimentInfo; results: ExperimentResults; words: ExperimentsMessages; numberLocale: string }) {
  const percent = percentIn(numberLocale);
  const keys = test.variants.map((v) => v.key);
  const totals = Object.fromEntries(keys.map((k) => [k, { v: 0, c: 0 }]));
  const series = keys.map((k) => ({ key: k, points: [] as number[] }));
  for (const day of results.daily) {
    for (const s of series) {
      const d = day.variants[s.key];
      if (d) {
        totals[s.key].v += d.visitors;
        totals[s.key].c += d.conversions;
      }
      s.points.push(totals[s.key].v > 0 ? totals[s.key].c / totals[s.key].v : 0);
    }
  }
  if (results.daily.length < 2) return null;
  const max = Math.max(0.0001, ...series.flatMap((s) => s.points));
  const w = 600;
  const h = 160;
  const x = (i: number) => (i / (results.daily.length - 1)) * (w - 20) + 10;
  const y = (p: number) => h - 10 - (p / max) * (h - 20);
  return (
    <figure className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label={words.results.trendLabel} className="w-full max-w-2xl rounded-md border border-line bg-card">
        {series.map((s, i) => (
          <polyline key={s.key} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth="2" points={s.points.map((p, j) => `${x(j)},${y(p)}`).join(" ")} />
        ))}
      </svg>
      <figcaption className="flex flex-wrap gap-4 text-xs text-muted">
        {series.map((s, i) => (
          <span key={s.key} className="flex items-center gap-1">
            <span aria-hidden className="inline-block h-0.5 w-4" style={{ background: COLORS[i % COLORS.length] }} />
            {nameOf(test, s.key)}
          </span>
        ))}
        <span>{fillWords(words.results.trendRange, { max: percent(max, 2), from: results.daily[0].day, to: results.daily[results.daily.length - 1].day })}</span>
      </figcaption>
    </figure>
  );
}

/**
 * What an A/B test found (D148), in the order a store owner reads it: the verdict in a sentence, each version against the
 * original, the steps visitors took, and how it developed. The figures are worked out in code (`experimentResults()`).
 */
export function ExperimentResultsView({
  test,
  results,
  locale,
  words = experimentsEn,
  numberLocale = "en-GB",
}: {
  test: ExperimentInfo;
  results: ExperimentResults;
  locale: string;
  /** The words and how numbers are written, in the account's language (D312 A7). */
  words?: ExperimentsMessages;
  numberLocale?: string;
}) {
  const r = words.results;
  const percent = percentIn(numberLocale);
  const num = (n: number) => n.toLocaleString(numberLocale);
  const goal = { ...GOAL_WORDS[test.goal], ...words.goals[test.goal] };
  const original = results.figures.find((f) => f.key === "a");
  const others = results.figures.filter((f) => f.key !== "a");
  const z = normalQuantile(1 - 0.025 / Math.max(1, others.length));
  const compare = (f: VariantFigures) => (original ? compareToOriginal(goal.kind, original, f, z) : null);
  const money = (minor: number) => formatMoney(Math.round(minor), results.currency, locale);
  const value = (f: VariantFigures) =>
    goal.kind === "rate" ? percent(f.visitors ? f.conversions / f.visitors : 0, 2) : money(f.money && f.visitors ? f.money.sum / f.visitors : 0);
  const verdict = results.verdict;

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ab-verdict" className={`rounded-lg border-2 bg-card p-5 ${SOFT[verdict.kind]}`}>
        <h2 id="ab-verdict" className="text-title text-ink">
          {verdict.headline}
        </h2>
        <p className="mt-1 max-w-3xl text-sm">{verdict.detail}</p>
        {results.harmed && (
          <p role="alert" className="mt-3 text-sm font-medium text-danger-text">
            {fillWords(r.harmed, { key: results.harmed.toUpperCase() })}
          </p>
        )}
        {results.unconverted > 0 && (
          <p className="mt-3 text-xs text-muted">
            {countWords(results.unconverted, r.unconverted)}
          </p>
        )}
      </section>

      <section aria-labelledby="ab-versions" className="flex flex-col gap-2">
        <h2 id="ab-versions" className="text-title text-ink">
          {fillWords(r.versionsFor, { goal: goal.label.toLowerCase() })}
        </h2>
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="px-4 py-2 font-normal">{r.version}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.visitors}</th>
                <th scope="col" className="px-4 py-2 font-normal">{goal.kind === "rate" ? fillWords(r.who, { per: goal.per }) : r.revenuePer}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.against}</th>
              </tr>
            </thead>
            <tbody>
              {results.figures.map((f) => {
                const c = f.key === "a" ? null : compare(f);
                return (
                  <tr key={f.key} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 font-medium">
                      {nameOf(test, f.key)}
                      {test.appliedVariant === f.key && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-brand-ink">{r.winner}</span>}
                    </th>
                    <td className="px-4 py-2">{num(f.visitors)}</td>
                    <td className="px-4 py-2">
                      {value(f)}
                      {goal.kind === "rate" && <span className="block text-xs text-muted">{fillWords(r.ofTotal, { n: num(f.conversions), total: num(f.visitors) })}</span>}
                    </td>
                    <td className="px-4 py-2">
                      {f.key === "a" ? (
                        <span className="text-muted">—</span>
                      ) : c ? (
                        <>
                          {c.relative === null ? r.noChange : `${c.relative >= 0 ? "+" : "−"}${percent(Math.abs(c.relative))}`}
                          <span className="block text-xs text-muted">{fillWords(r.chanceBetter, { n: Math.round(c.chanceBetter * 100) })}</span>
                        </>
                      ) : (
                        <span className="text-muted">{r.notEnough}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="ab-funnel" className="flex flex-col gap-2">
        <h2 id="ab-funnel" className="text-title text-ink">{r.funnel}</h2>
        <div className={`overflow-x-auto ${CARD_CLASS}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-line text-muted">
                <th scope="col" className="px-4 py-2 font-normal">{r.version}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.saw}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.added}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.checkout}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.ordered}</th>
                <th scope="col" className="px-4 py-2 font-normal">{r.revenue}</th>
              </tr>
            </thead>
            <tbody>
              {test.variants.map((v) => {
                const f = results.funnel[v.key] ?? { visitors: 0, carts: 0, checkouts: 0, buyers: 0, clicks: 0 };
                const share = (n: number) => (f.visitors ? ` (${percent(n / f.visitors)})` : "");
                return (
                  <tr key={v.key} className="border-b border-line last:border-0">
                    <th scope="row" className="px-4 py-2 font-medium">{v.name}</th>
                    <td className="px-4 py-2">{num(f.visitors)}</td>
                    <td className="px-4 py-2">{num(f.carts)}{share(f.carts)}</td>
                    <td className="px-4 py-2">{num(f.checkouts)}{share(f.checkouts)}</td>
                    <td className="px-4 py-2">{num(f.buyers)}{share(f.buyers)}</td>
                    <td className="px-4 py-2">{money(results.revenue[v.key]?.plain ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {test.goal === "click" && (
          <p className="text-xs text-muted">
            {fillWords(r.clicks, { list: test.variants.map((v) => `${v.name} ${num(results.funnel[v.key]?.clicks ?? 0)}`).join(", ") })}
          </p>
        )}
        {test.goal === "form" && (
          <p className="text-xs text-muted">
            {fillWords(r.forms, { list: test.variants.map((v) => `${v.name} ${num(results.funnel[v.key]?.forms ?? 0)}`).join(", ") })}
          </p>
        )}
      </section>

      <section aria-labelledby="ab-trend" className="flex flex-col gap-2">
        <h2 id="ab-trend" className="text-title text-ink">{r.trend}</h2>
        <Trend test={test} results={results} words={words} numberLocale={numberLocale} />
        {results.weekly.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer underline">{r.weekly}</summary>
            <div className={`mt-2 overflow-x-auto ${CARD_CLASS}`}>
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-muted">
                    <th scope="col" className="px-4 py-2 font-normal">{r.week}</th>
                    {test.variants.map((v) => (
                      <th key={v.key} scope="col" className="px-4 py-2 font-normal">{v.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.weekly.map((w) => (
                    <tr key={w.week} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">{w.week}</th>
                      {test.variants.map((v) => {
                        const d = w.variants[v.key];
                        return (
                          <td key={v.key} className="px-4 py-2">
                            {d ? fillWords(r.ofTotal, { n: num(d.conversions), total: num(d.visitors) }) : "—"}
                            {d && d.visitors > 0 && <span className="block text-xs text-muted">{percent(d.conversions / d.visitors, 2)}</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        )}
      </section>

      <p className="max-w-3xl text-xs text-muted">
        {fillWords(r.footnote, { currency: results.currency })}
        {results.splitP < 0.05 ? r.uneven : ""}
      </p>
    </div>
  );
}
