import { compareToOriginal, normalQuantile, type VariantFigures } from "@/lib/experiment-results";
import { GOAL_WORDS } from "@/lib/experiments";
import { formatMoney } from "@/lib/money";
import type { ExperimentInfo } from "@/server/experiment-admin";
import type { ExperimentResults } from "@/server/experiment-results";

const SOFT = { few: "border-border", early: "border-border", better: "border-green-700", worse: "border-red-700", even: "border-border", broken: "border-red-700" } as const;
const COLORS = ["#6b7280", "#2563eb", "#d97706", "#7c3aed"];

const percent = (share: number, digits = 1) => `${(share * 100).toLocaleString("en-GB", { maximumFractionDigits: digits })} %`;

/** One version's name: the original is "Original", the others "Version B". */
const nameOf = (test: ExperimentInfo, key: string) => test.variants.find((v) => v.key === key)?.name ?? key.toUpperCase();

/** Cumulative conversion rate per version over the days of the test: a line each, drawn as plain SVG. */
function Trend({ test, results }: { test: ExperimentInfo; results: ExperimentResults }) {
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
      <svg viewBox={`0 0 ${w} ${h}`} role="img" aria-label="How each version's rate developed over the days" className="w-full max-w-2xl rounded-md border border-border bg-background">
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
        <span>Up to {percent(max, 2)} · from {results.daily[0].day} to {results.daily[results.daily.length - 1].day}</span>
      </figcaption>
    </figure>
  );
}

/**
 * What an A/B test found (D148), in the order a store owner reads it: the verdict in a sentence, each version against the
 * original, the steps visitors took, and how it developed. The figures are worked out in code (`experimentResults()`).
 */
export function ExperimentResultsView({ test, results, locale }: { test: ExperimentInfo; results: ExperimentResults; locale: string }) {
  const goal = GOAL_WORDS[test.goal];
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
      <section aria-labelledby="ab-verdict" className={`rounded-lg border-2 bg-background p-5 ${SOFT[verdict.kind]}`}>
        <h2 id="ab-verdict" className="text-lg font-semibold">
          {verdict.headline}
        </h2>
        <p className="mt-1 max-w-3xl text-sm">{verdict.detail}</p>
        {results.harmed && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-800 dark:text-red-300">
            Version {results.harmed.toUpperCase()} is clearly selling less than the original.
          </p>
        )}
        {results.unconverted > 0 && (
          <p className="mt-3 text-xs text-muted">
            {results.unconverted} {results.unconverted === 1 ? "order was" : "orders were"} in a currency without a rate, so they count as orders but not in the revenue.
          </p>
        )}
      </section>

      <section aria-labelledby="ab-versions" className="flex flex-col gap-2">
        <h2 id="ab-versions" className="text-lg font-semibold">
          The versions, for: {goal.label.toLowerCase()}
        </h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="px-4 py-2 font-normal">Version</th>
                <th scope="col" className="px-4 py-2 font-normal">Visitors</th>
                <th scope="col" className="px-4 py-2 font-normal">{goal.kind === "rate" ? `Who ${goal.per}` : "Revenue per visitor"}</th>
                <th scope="col" className="px-4 py-2 font-normal">Against the original</th>
              </tr>
            </thead>
            <tbody>
              {results.figures.map((f) => {
                const c = f.key === "a" ? null : compare(f);
                return (
                  <tr key={f.key} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2 font-medium">
                      {nameOf(test, f.key)}
                      {test.appliedVariant === f.key && <span className="ml-2 rounded-full bg-foreground px-2 py-0.5 text-xs text-background">Winner</span>}
                    </th>
                    <td className="px-4 py-2">{f.visitors.toLocaleString("en-GB")}</td>
                    <td className="px-4 py-2">
                      {value(f)}
                      {goal.kind === "rate" && <span className="block text-xs text-muted">{f.conversions.toLocaleString("en-GB")} of {f.visitors.toLocaleString("en-GB")}</span>}
                    </td>
                    <td className="px-4 py-2">
                      {f.key === "a" ? (
                        <span className="text-muted">—</span>
                      ) : c ? (
                        <>
                          {c.relative === null ? "No change to compare" : `${c.relative >= 0 ? "+" : "−"}${percent(Math.abs(c.relative))}`}
                          <span className="block text-xs text-muted">
                            {Math.round(c.chanceBetter * 100)} % chance it is better
                          </span>
                        </>
                      ) : (
                        <span className="text-muted">Not enough yet</span>
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
        <h2 id="ab-funnel" className="text-lg font-semibold">What visitors did</h2>
        <div className="overflow-x-auto rounded-lg border border-border bg-background">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-muted">
                <th scope="col" className="px-4 py-2 font-normal">Version</th>
                <th scope="col" className="px-4 py-2 font-normal">Saw it</th>
                <th scope="col" className="px-4 py-2 font-normal">Added to cart</th>
                <th scope="col" className="px-4 py-2 font-normal">Started checkout</th>
                <th scope="col" className="px-4 py-2 font-normal">Ordered</th>
                <th scope="col" className="px-4 py-2 font-normal">Revenue (no VAT)</th>
              </tr>
            </thead>
            <tbody>
              {test.variants.map((v) => {
                const f = results.funnel[v.key] ?? { visitors: 0, carts: 0, checkouts: 0, buyers: 0, clicks: 0 };
                const share = (n: number) => (f.visitors ? ` (${percent(n / f.visitors)})` : "");
                return (
                  <tr key={v.key} className="border-b border-border last:border-0">
                    <th scope="row" className="px-4 py-2 font-medium">{v.name}</th>
                    <td className="px-4 py-2">{f.visitors.toLocaleString("en-GB")}</td>
                    <td className="px-4 py-2">{f.carts.toLocaleString("en-GB")}{share(f.carts)}</td>
                    <td className="px-4 py-2">{f.checkouts.toLocaleString("en-GB")}{share(f.checkouts)}</td>
                    <td className="px-4 py-2">{f.buyers.toLocaleString("en-GB")}{share(f.buyers)}</td>
                    <td className="px-4 py-2">{money(results.revenue[v.key]?.plain ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {test.goal === "click" && (
          <p className="text-xs text-muted">
            Clicks on the button: {test.variants.map((v) => `${v.name} ${(results.funnel[v.key]?.clicks ?? 0).toLocaleString("en-GB")}`).join(", ")}.
          </p>
        )}
      </section>

      <section aria-labelledby="ab-trend" className="flex flex-col gap-2">
        <h2 id="ab-trend" className="text-lg font-semibold">How it developed</h2>
        <Trend test={test} results={results} />
        {results.weekly.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer underline">Week by week</summary>
            <div className="mt-2 overflow-x-auto rounded-lg border border-border bg-background">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-muted">
                    <th scope="col" className="px-4 py-2 font-normal">Week</th>
                    {test.variants.map((v) => (
                      <th key={v.key} scope="col" className="px-4 py-2 font-normal">{v.name}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.weekly.map((w) => (
                    <tr key={w.week} className="border-b border-border last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">{w.week}</th>
                      {test.variants.map((v) => {
                        const d = w.variants[v.key];
                        return (
                          <td key={v.key} className="px-4 py-2">
                            {d ? `${d.conversions} of ${d.visitors}` : "—"}
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
        Only visitors who accepted statistics cookies are counted, and each is counted once, in the version they first saw. An order counts when it is paid, for
        a basket the visitor started after first seeing the version. Revenue is without VAT, with shipping, in {results.currency}; one very large order is capped
        so it cannot decide the result alone.{results.splitP < 0.05 ? " The split between versions looks uneven: see the note above." : ""}
      </p>
    </div>
  );
}
