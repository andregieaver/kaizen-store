import { niceTicks, linearScale } from "@/components/admin/analytics/chart-math";
import { countWords, fillWords } from "@/lib/admin-fill";
import { experimentsEn, type ExperimentsMessages } from "@/lib/admin-messages/experiments.en";
import type { CardComparison, ExperimentCard } from "@/lib/experiment-card";
import { GOAL_WORDS } from "@/lib/experiments";
import { formatMoney } from "@/lib/money";
import type { ExperimentInfo } from "@/server/experiment-admin";
import type { ExperimentResults } from "@/server/experiment-results";
import { AdminLink, Card, CARD_CLASS, ShareBar } from "@/components/admin/ui";

import { FoldOnHash } from "./orders/order-folds";

/** Each version's colour: the original is the muted comparison colour, the others the chart set in its fixed order. */
const COLOR: Record<string, string> = { a: "var(--chart-compare)", b: "var(--chart-1)", c: "var(--chart-2)", d: "var(--chart-3)" };
const colorOf = (key: string) => COLOR[key] ?? "var(--chart-4)";
const SOFT = { few: "", early: "", better: "border-2 border-positive-line", worse: "border-2 border-danger-line", even: "", broken: "border-2 border-danger-line" } as const;

const percentIn = (locale: string) => (share: number, digits = 1) => `${(share * 100).toLocaleString(locale, { maximumFractionDigits: digits })} %`;
const signedIn = (locale: string) => (share: number) => `${share >= 0 ? "+" : "−"}${Math.abs(Math.round(share * 100)).toLocaleString(locale)} %`;

/** One version's name: the original is "Original", the others "Version B". */
const nameOf = (test: ExperimentInfo, key: string) => test.variants.find((v) => v.key === key)?.name ?? key.toUpperCase();

type Words = ExperimentsMessages;

/** "How sure are we?": each version's change against the original as a dot (the best guess) on a bar (its likely range), against "no change". */
function RangeChart({ test, card, words, numberLocale }: { test: ExperimentInfo; card: ExperimentCard; words: Words; numberLocale: string }) {
  const w = words.card.sure;
  const signed = signedIn(numberLocale);
  const shown = card.comparisons.filter((c): c is CardComparison & { relative: number; low: number; high: number } => c.relative !== null && c.low !== null && c.high !== null);
  const draw = card.showFigures && shown.length > 0;
  const lo = Math.min(-0.1, ...(draw ? shown.map((c) => c.low) : []));
  const hi = Math.max(0.1, ...(draw ? shown.map((c) => c.high) : []));
  const ticks = niceTicks(lo, hi, { target: 4, includeZero: true });
  // Drawn about as wide as its half of the page, so its words stay at reading size.
  const W = 360;
  const left = 12;
  const right = W - 12;
  const rowH = 44;
  const top = 34;
  const rows = draw ? shown.length : 1;
  const bottom = top + rows * rowH;
  const H = bottom + 26;
  const x = linearScale([ticks.min, ticks.max], [left, right]);
  return (
    <Card title={w.title} description={w.sub} className="flex flex-col gap-3" compact>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={w.label} className="w-full" data-range-chart>
        <rect x={x(0)} y={top - 22} width={right - x(0)} height={bottom - top + 22} style={{ fill: "var(--positive-soft)" }} opacity={draw ? 1 : 0.5} />
        <text x={right - 6} y={top - 8} textAnchor="end" fontSize="12" fontWeight="600" style={{ fill: "var(--positive-text)" }}>
          {w.better}
        </text>
        {x(0) - left > 64 && (
          <text x={left + 6} y={top - 8} fontSize="12" fontWeight="600" style={{ fill: "var(--danger-text)" }}>
            {w.worse}
          </text>
        )}
        {ticks.ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={top - 22} y2={bottom} style={{ stroke: t === 0 ? "var(--ink-2)" : "var(--chart-grid)" }} strokeWidth={t === 0 ? 1.5 : 1} strokeDasharray={t === 0 ? "4 3" : undefined} />
            <text x={x(t)} y={bottom + 16} textAnchor={t === ticks.ticks[0] ? "start" : t === ticks.ticks[ticks.ticks.length - 1] ? "end" : "middle"} fontSize="11" style={{ fill: t === 0 ? "var(--ink-2)" : "var(--muted)" }}>
              {t === 0 ? "0 %" : signed(t)}
            </text>
          </g>
        ))}
        {draw &&
          shown.map((c, i) => {
            const y = top + i * rowH + rowH / 2 + 4;
            const name = nameOf(test, c.key);
            const line = `${name}: ${signed(c.relative)} (${fillWords(w.likely, { low: signed(c.low), high: signed(c.high) })})`;
            return (
              <g key={c.key}>
                <title>{line}</title>
                <line x1={x(c.low)} x2={x(c.high)} y1={y} y2={y} strokeWidth={8} strokeLinecap="round" opacity={0.35} style={{ stroke: colorOf(c.key) }} />
                <circle cx={x(c.relative)} cy={y} r={7} strokeWidth={2} style={{ fill: colorOf(c.key), stroke: "var(--card)" }} />
                <text x={x(c.relative)} y={y - 13} textAnchor="middle" fontSize="12" fontWeight="600" style={{ fill: "var(--ink)" }}>
                  {`${name} ${signed(c.relative)}`}
                </text>
              </g>
            );
          })}
      </svg>
      <p className="text-caption text-muted">{card.state === "broken" ? w.broken : draw ? w.explain : w.early}</p>
      {draw && (
        <ul className="sr-only">
          {shown.map((c) => (
            <li key={c.key}>{`${nameOf(test, c.key)}: ${signed(c.relative)}, ${fillWords(w.likely, { low: signed(c.low), high: signed(c.high) })}`}</li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/** "How it developed": each version's share who did the thing, counted from the start, day by day, with the shortest run marked. */
function Trend({ test, results, words, numberLocale }: { test: ExperimentInfo; results: ExperimentResults; words: Words; numberLocale: string }) {
  const w = words.card.trend;
  const percent = percentIn(numberLocale);
  const per = words.goals[test.goal].per;
  const keys = test.variants.map((v) => v.key);
  const totals = Object.fromEntries(keys.map((k) => [k, { v: 0, c: 0 }]));
  const series = keys.map((k) => ({ key: k, points: [] as (number | null)[] }));
  for (const day of results.daily) {
    for (const s of series) {
      const d = day.variants[s.key];
      if (d) {
        totals[s.key].v += d.visitors;
        totals[s.key].c += d.conversions;
      }
      s.points.push(totals[s.key].v > 0 ? totals[s.key].c / totals[s.key].v : null);
    }
  }
  const n = results.daily.length;
  if (n < 2) return null;
  const values = series.flatMap((s) => s.points.filter((p): p is number => p !== null));
  const ticks = niceTicks(Math.min(...values), Math.max(...values, 0.0001), { target: 4, includeZero: false });
  const W = 400;
  const H = 200;
  const left = 44;
  const right = W - 52;
  const top = 12;
  const bottom = H - 28;
  const x = (i: number) => left + (i / (n - 1)) * (right - left);
  const y = linearScale([ticks.min, ticks.max], [bottom, top]);
  const minIndex = Math.min(n - 1, Math.max(0, test.minDays - 1));
  const path = (points: (number | null)[]) =>
    points
      .map((p, i) => (p === null ? null : `${x(i).toFixed(1)},${y(p).toFixed(1)}`))
      .filter(Boolean)
      .join(" ");
  return (
    <Card title={w.title} description={fillWords(w.sub, { per })} className="flex flex-col gap-3" compact>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={fillWords(w.label, { per })} className="w-full" data-trend-chart>
        <rect x={left} y={top} width={x(minIndex) - left} height={bottom - top} style={{ fill: "var(--chart-seq-0)" }} />
        <text x={left + 6} y={top + 14} fontSize="11" style={{ fill: "var(--muted)" }}>
          {w.learning}
        </text>
        {ticks.ticks.map((t) => (
          <g key={t}>
            <line x1={left} x2={right} y1={y(t)} y2={y(t)} style={{ stroke: "var(--chart-grid)" }} />
            <text x={left - 6} y={y(t) + 4} textAnchor="end" fontSize="11" style={{ fill: "var(--muted)" }}>
              {percent(t, 1)}
            </text>
          </g>
        ))}
        <line x1={left} x2={right} y1={bottom} y2={bottom} style={{ stroke: "var(--chart-axis)" }} />
        {minIndex > 0 && minIndex < n - 1 && <line x1={x(minIndex)} x2={x(minIndex)} y1={top} y2={bottom} strokeDasharray="4 3" style={{ stroke: "var(--ink-2)" }} />}
        <text x={left} y={bottom + 18} textAnchor="start" fontSize="11" style={{ fill: "var(--muted)" }}>
          {results.daily[0].day.slice(5)}
        </text>
        {minIndex > 0 && minIndex < n - 1 && (
          <text x={x(minIndex)} y={bottom + 18} textAnchor="middle" fontSize="11" style={{ fill: "var(--muted)" }}>
            {fillWords(w.day, { n: test.minDays })}
          </text>
        )}
        <text x={right} y={bottom + 18} textAnchor="end" fontSize="11" style={{ fill: "var(--muted)" }}>
          {results.daily[n - 1].day.slice(5)}
        </text>
        {series.map((s) => (
          <polyline key={s.key} points={path(s.points)} fill="none" strokeWidth={2} strokeLinejoin="round" style={{ stroke: colorOf(s.key) }} />
        ))}
        {series.map((s) => {
          const last = s.points[n - 1];
          if (last === null || last === undefined) return null;
          return (
            <g key={s.key}>
              <circle cx={x(n - 1)} cy={y(last)} r={4} strokeWidth={2} style={{ fill: colorOf(s.key), stroke: "var(--card)" }}>
                <title>{`${nameOf(test, s.key)}: ${percent(last, 2)}`}</title>
              </circle>
              <text x={x(n - 1) + 8} y={y(last) + 4} fontSize="11.5" fontWeight="600" style={{ fill: "var(--ink)" }}>
                {percent(last, 1)}
              </text>
            </g>
          );
        })}
      </svg>
      <Legend test={test} />
    </Card>
  );
}

function Legend({ test }: { test: ExperimentInfo }) {
  return (
    <p className="flex flex-wrap gap-4 text-caption text-ink-2">
      {test.variants.map((v) => (
        <span key={v.key} className="flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-1 w-3 rounded-full" style={{ background: colorOf(v.key) }} />
          {v.name}
        </span>
      ))}
    </p>
  );
}

/** "What visitors did": of every 100 who saw each version, how many took each step, as bars side by side. */
function FunnelBars({ test, results, words, numberLocale }: { test: ExperimentInfo; results: ExperimentResults; words: Words; numberLocale: string }) {
  const r = words.results;
  const w = words.card.funnel;
  const keys = test.variants.map((v) => v.key);
  const steps: { label: string; of: (f: ExperimentResults["funnel"][string]) => number }[] = [
    { label: r.added, of: (f) => f.carts },
    { label: r.checkout, of: (f) => f.checkouts },
    { label: r.ordered, of: (f) => f.buyers },
    ...(test.goal === "click" ? [{ label: GOAL_WORDS.click.label, of: (f: ExperimentResults["funnel"][string]) => f.clicks }] : []),
    ...(test.goal === "form" ? [{ label: words.goals.form.per, of: (f: ExperimentResults["funnel"][string]) => f.forms }] : []),
  ];
  const per100 = (key: string, of: (f: ExperimentResults["funnel"][string]) => number) => {
    const f = results.funnel[key];
    return f && f.visitors > 0 ? (of(f) / f.visitors) * 100 : 0;
  };
  const top = Math.max(1, ...steps.flatMap((s) => keys.map((k) => per100(k, s.of))));
  const figure = (n: number) => n.toLocaleString(numberLocale, { maximumFractionDigits: 1 });
  return (
    <Card title={w.title} description={w.sub} className="flex flex-col gap-3" compact>
      <dl aria-label={w.label} className="flex flex-col gap-3" data-funnel-bars>
        {steps.map((s) => (
          <div key={s.label} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3">
            <dt className="text-caption text-ink-2">{s.label}</dt>
            <dd className="flex flex-col gap-1">
              {keys.map((k) => {
                const value = per100(k, s.of);
                return (
                  <span key={k} className="flex items-center gap-2">
                    <span className="h-3 rounded-r" style={{ width: `${Math.max(0.5, (value / top) * 85)}%`, background: colorOf(k) }} aria-hidden />
                    <span className="text-caption tabular-nums text-ink-2">
                      {figure(value)}
                      <span className="sr-only"> {nameOf(test, k)}</span>
                    </span>
                  </span>
                );
              })}
            </dd>
          </div>
        ))}
      </dl>
      <Legend test={test} />
    </Card>
  );
}

/**
 * What an A/B test found (D148, redrawn as a record in D656), in the order a store owner reads it: the verdict with how far the test is
 * from an answer, how sure we are as a picture, what is different, how it developed and what visitors did; every figure and the method
 * behind "How we worked this out". The figures are worked out in code (`experimentResults()`, `experimentCard()`); nothing here judges.
 */
export function ExperimentResultsView({
  test,
  results,
  card,
  differences = {},
  base,
  locale,
  words = experimentsEn,
  numberLocale = "en-GB",
  readyAround = null,
}: {
  test: ExperimentInfo;
  results: ExperimentResults;
  card: ExperimentCard;
  /** What each version changes, in words (`versionDifferences()` said by `differenceLine()`). */
  differences?: Record<string, string[]>;
  /** The tests' admin path, for each version's preview. */
  base: string;
  locale: string;
  /** The words and how numbers are written, in the account's language (D312 A7). */
  words?: ExperimentsMessages;
  numberLocale?: string;
  /** `card.progress.readyAround` written as a date in the account's language. */
  readyAround?: string | null;
}) {
  const r = words.results;
  const c = words.card;
  const percent = percentIn(numberLocale);
  const signed = signedIn(numberLocale);
  const num = (n: number) => n.toLocaleString(numberLocale);
  const goal = { ...GOAL_WORDS[test.goal], ...words.goals[test.goal] };
  const money = (minor: number) => formatMoney(Math.round(minor), results.currency, locale);
  const value = (f: ExperimentResults["figures"][number]) =>
    goal.kind === "rate" ? percent(f.visitors ? f.conversions / f.visitors : 0, 2) : money(f.money && f.visitors ? f.money.sum / f.visitors : 0);
  const verdict = results.verdict;
  const p = card.progress;
  const stoppedEarly = test.status !== "running" && !p.reached;
  const versions = test.variants.filter((v) => v.key !== "a");
  const counts = results.figures.map((f) => f.visitors);
  const total = counts.reduce((a, b) => a + b, 0);

  return (
    <div className="flex flex-col gap-6">
      <section aria-labelledby="ab-verdict" className={`flex flex-col gap-4 p-5 sm:p-6 ${CARD_CLASS} ${SOFT[verdict.kind]}`}>
        <div className="flex flex-col gap-1">
          <h2 id="ab-verdict" className="text-title text-ink">
            {verdict.headline}
          </h2>
          <p className="max-w-[75ch] text-body text-ink-2">{verdict.detail}</p>
        </div>
        {results.harmed && (
          <p role="alert" className="text-body font-medium text-danger-text">
            {fillWords(r.harmed, { key: results.harmed.toUpperCase() })}
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2" data-progress>
          <ShareBar
            label={c.progress.days}
            figure={fillWords(c.progress.daysFigure, { days: num(p.days), min: num(p.minDays) })}
            share={p.minDays > 0 ? p.days / p.minDays : 1}
            signal={p.days >= p.minDays ? "positive" : "warning"}
          />
          <ShareBar
            label={c.progress.visitors}
            figure={fillWords(c.progress.visitorsFigure, { n: num(p.visitors), min: num(p.minVisitors) })}
            share={p.minVisitors > 0 ? p.visitors / p.minVisitors : 1}
            signal={p.visitors >= p.minVisitors ? "positive" : "warning"}
          />
        </div>
        <p className="text-caption text-muted">
          {p.reached ? c.progress.reached : stoppedEarly ? c.progress.stoppedEarly : readyAround ? fillWords(c.progress.around, { date: readyAround }) : c.progress.noPace}
        </p>
        {results.unconverted > 0 && <p className="text-caption text-muted">{countWords(results.unconverted, r.unconverted)}</p>}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <RangeChart test={test} card={card} words={words} numberLocale={numberLocale} />
        <Card title={c.different.title} className="flex flex-col gap-4" compact>
          {versions.map((v) => {
            const lines = differences[v.key] ?? [];
            return (
              <div key={v.key} className="flex flex-col gap-2" data-differences={v.key}>
                <p className="flex flex-wrap items-center justify-between gap-2 text-body-strong text-ink">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="inline-block size-2.5 rounded-sm" style={{ background: colorOf(v.key) }} />
                    {v.name}
                  </span>
                  {v.pageId && (
                    <AdminLink href={`${base}/variants/${v.pageId}/preview`} className="text-caption font-normal text-ink-2 underline">
                      {c.different.preview}
                    </AdminLink>
                  )}
                </p>
                {lines.length === 0 ? (
                  <p className="text-caption text-muted">{c.different.none}</p>
                ) : (
                  <ul className="flex list-disc flex-col gap-1 pl-5 text-caption text-ink-2">
                    {lines.slice(0, 5).map((line, i) => (
                      <li key={i} className="break-words">
                        {line}
                      </li>
                    ))}
                    {lines.length > 5 && <li className="list-none text-muted">{countWords(lines.length - 5, c.different.more)}</li>}
                  </ul>
                )}
              </div>
            );
          })}
        </Card>
      </div>

      {/* Pictures of the figures only once there is an answer: before then they move with luck (no peeking, D656). */}
      {card.showFigures && (
        <div className="grid gap-6 lg:grid-cols-2">
          {goal.kind === "rate" ? <Trend test={test} results={results} words={words} numberLocale={numberLocale} /> : null}
          <FunnelBars test={test} results={results} words={words} numberLocale={numberLocale} />
        </div>
      )}

      <FoldOnHash id="how" summary={c.details.summary} hint={c.details.hint}>
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
                  <th scope="col" className="px-4 py-2 font-normal">{c.details.likely}</th>
                </tr>
              </thead>
              <tbody>
                {results.figures.map((f) => {
                  const cmp = card.comparisons.find((x) => x.key === f.key);
                  return (
                    <tr key={f.key} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">
                        {nameOf(test, f.key)}
                        {test.appliedVariant === f.key && <span className="ml-2 rounded-full bg-brand px-2 py-0.5 text-xs text-brand-ink">{r.winner}</span>}
                      </th>
                      <td className="px-4 py-2 tabular-nums">{num(f.visitors)}</td>
                      <td className="px-4 py-2 tabular-nums">
                        {value(f)}
                        {goal.kind === "rate" && <span className="block text-xs text-muted">{fillWords(r.ofTotal, { n: num(f.conversions), total: num(f.visitors) })}</span>}
                      </td>
                      <td className="px-4 py-2 tabular-nums">
                        {f.key === "a" ? (
                          <span className="text-muted">—</span>
                        ) : !card.showFigures ? (
                          <span className="text-muted">{r.notEnough}</span>
                        ) : cmp && cmp.relative !== null && cmp.low !== null && cmp.high !== null ? (
                          <>
                            {signed(cmp.relative)}
                            <span className="block text-xs text-muted">{fillWords(c.sure.likely, { low: signed(cmp.low), high: signed(cmp.high) })}</span>
                          </>
                        ) : (
                          <span className="text-muted">{r.noChange}</span>
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
            <table className="w-full min-w-[34rem] text-left text-sm">
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
                  const f = results.funnel[v.key] ?? { visitors: 0, carts: 0, checkouts: 0, buyers: 0, clicks: 0, forms: 0 };
                  const share = (n: number) => (f.visitors ? ` (${percent(n / f.visitors)})` : "");
                  return (
                    <tr key={v.key} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">{v.name}</th>
                      <td className="px-4 py-2 tabular-nums">{num(f.visitors)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{num(f.carts)}{share(f.carts)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{num(f.checkouts)}{share(f.checkouts)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{num(f.buyers)}{share(f.buyers)}</td>
                      <td className="whitespace-nowrap px-4 py-2 tabular-nums">{money(results.revenue[v.key]?.plain ?? 0)}</td>
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

        <section aria-labelledby="ab-split" className="flex flex-col gap-2">
          <h2 id="ab-split" className="text-title text-ink">
            {c.details.split}: {results.splitP < 0.001 ? c.details.splitOff : c.details.splitOk}
          </h2>
          <div className={`flex flex-col gap-2 p-4 ${CARD_CLASS}`}>
            <div aria-hidden className="flex h-3 overflow-hidden rounded-full">
              {results.figures.map((f) => (
                <span key={f.key} style={{ width: `${total > 0 ? (f.visitors / total) * 100 : 100 / results.figures.length}%`, background: colorOf(f.key) }} className="border-r-2 border-card last:border-0" />
              ))}
            </div>
            <p className="text-caption text-ink-2">
              {results.figures.map((f) => `${nameOf(test, f.key)} ${num(f.visitors)} (${percent(total > 0 ? f.visitors / total : 0, 1)})`).join(" · ")}
            </p>
          </div>
        </section>

        {results.weekly.length > 0 && (
          <section aria-labelledby="ab-weekly" className="flex flex-col gap-2">
            <h2 id="ab-weekly" className="text-title text-ink">{r.weekly}</h2>
            <div className={`overflow-x-auto ${CARD_CLASS}`}>
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
                  {results.weekly.map((wk) => (
                    <tr key={wk.week} className="border-b border-line last:border-0">
                      <th scope="row" className="px-4 py-2 font-medium">{wk.week}</th>
                      {test.variants.map((v) => {
                        const d = wk.variants[v.key];
                        return (
                          <td key={v.key} className="px-4 py-2 tabular-nums">
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
          </section>
        )}

        <p className="max-w-[75ch] text-xs text-muted">
          {fillWords(r.footnote, { currency: results.currency })}
          {results.splitP < 0.05 ? r.uneven : ""}
        </p>
      </FoldOnHash>
    </div>
  );
}
