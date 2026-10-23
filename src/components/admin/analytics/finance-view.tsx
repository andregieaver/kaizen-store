import Link from "next/link";
import type { ReactNode } from "react";

import { countWords, fillWords } from "@/lib/admin-fill";
import { financeEn, type FinanceMessages } from "@/lib/admin-messages/finance.en";
import { change, formatChange, formatCount, NO_FIGURE, safeRatio, verdictOf, type GoodDirection, type Verdict } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import type { FinanceLine, FinanceLineKey, FinanceStatement } from "@/lib/analytics-finance";
import { COVERAGE_WARN, kpiChange, type Totals } from "@/lib/analytics-kpi";
import type { Bucket } from "@/lib/analytics-period";
import { decimalComma, financeNumbers, withDecimals, type FinanceNumbers } from "@/lib/finance-words";
import type { SeriesPoint } from "@/server/analytics-totals";

import { HorizontalBars, LineChart, type BarRow } from "./charts";
import { arrowOf, StatusPill } from "./data-table";
import { ExportButton } from "./export-scope";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { CARD_CLASS } from "@/components/admin/ui";

/**
 * The Finance page's body (D152): everything under the page's header, drawn from the report objects it is handed and nothing else
 * (no data access, so it can be rendered on fixture data). It answers three things in order: how much of what we sell is left after
 * what it costs (a plain sentence and four cards), where the rest went (the bridge from gross sales to operating profit as a table,
 * and the same as bars), and how far the figures can be trusted (cost coverage, estimates, refunds, currencies). A figure that
 * cannot be known is never drawn as zero: the line says what is missing and where to add it.
 */

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

/** One period's figures with the statement worked out from them (`financeStatement()`). */
export type FinancePeriodData = {
  /** "Last 30 days", or the dates. */
  label: string;
  totals: Totals;
  statement: FinanceStatement;
  /** Paid orders and refunds left out because their currency has no rate to the main currency. */
  unconverted: number;
  /** Those currencies. */
  missingCurrencies: string[];
};

/** How many of the store's product options have a cost (`analyticsSetupSummary()`), for "add costs to N". */
export type FinanceSetup = {
  /** Variants on sale: one for each size, colour or other option of a product. */
  activeVariants: number;
  variantsWithCost: number;
  /** Earlier order lines that sold without a cost whose variant has one now. */
  backfillableLines: number;
};

export type FinanceViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The store's first market's locale, for writing amounts. */
  locale: string;
  /** Only an owner can open Analytics settings. */
  isOwner: boolean;
  current: FinancePeriodData;
  /** The period the address compares with, or null when the comparison is off. */
  comparison: { mode: "previous" | "year"; data: FinancePeriodData } | null;
  bucket: Bucket;
  /** One point per bucket of the current period. */
  series: readonly SeriesPoint[];
  /** The comparison's points, one per current bucket (null where it has none); null with no comparison. */
  comparisonSeries: readonly (SeriesPoint | null)[] | null;
  /** Null when the count could not be read; the page then does not say how many products lack a cost. */
  setup: FinanceSetup | null;
  /** The words in the admin's language (D312 A9); English unless given. */
  words?: FinanceMessages;
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

/** A whole number of minor units written as an amount; a value between whole minor units (an axis tick) is rounded, never refused. */
export function moneyWriter(currency: string, locale: string): (minor: number) => string {
  return (minor) => formatAmount(Math.round(minor), currency, locale);
}

/** Whether a period had no sales at all: nothing paid and nothing refunded. */
export function hasNoSales(d: Pick<FinancePeriodData, "totals">): boolean {
  return d.totals.orders === 0 && d.totals.revenueMinor === 0 && d.totals.refundsMinor === 0;
}

export const lineOf = (statement: FinanceStatement, key: FinanceLineKey): FinanceLine | undefined => statement.lines.find((l) => l.key === key);
const amountOf = (statement: FinanceStatement, key: FinanceLineKey): number | null => lineOf(statement, key)?.amountMinor ?? null;

/** Lines that take something away: a rise in them is worse news, and their change is read on their size, not their sign. */
const DEDUCTIONS: ReadonlySet<FinanceLineKey> = new Set(["discounts", "refunds", "cogs", "paymentFees", "platformFees", "shippingCosts", "marketing", "fixedCosts"]);

export type LineChange = { text: string; abs: number; verdict: Verdict };

/**
 * How a bridge line changed against the comparison. A deduction is compared on its size (costs going from 100 to 150 is +50 %, and
 * bad news), everything else on its amount. Nothing when either side cannot be known; a line the comparison lacks (rounding) was 0.
 */
export function lineChange(line: FinanceLine, previous: FinanceLine | undefined, numbers?: FinanceNumbers): LineChange | null {
  const before = previous ? previous.amountMinor : line.key === "rounding" ? 0 : null;
  if (line.amountMinor === null || before === null) return null;
  const deduction = DEDUCTIONS.has(line.key);
  const delta = change(deduction ? Math.abs(line.amountMinor) : line.amountMinor, deduction ? Math.abs(before) : before);
  if (!delta) return null;
  const good: GoodDirection = line.key === "rounding" ? "neutral" : deduction ? "down" : "up";
  // A change under a twentieth of a percent is rounding, not news.
  const verdict = delta.pct !== null && Math.abs(delta.pct) < 0.0005 ? "neutral" : verdictOf(delta.abs, good);
  return { text: numbers ? numbers.change(delta) : formatChange(delta), abs: delta.abs, verdict };
}

/** The label without a trailing "(estimated)": the line carries the tag instead. */
export const plainLabel = (label: string) => label.replace(/ \((estimated|estimate|anslått|anslag)\)$/, "");

/** The bars of "Where net revenue went", in order: a line of the statement and its label (the CSV repeats them). */
/** Lines a statement has only when they happened (D288's lost disputes): left out of *Where net revenue went* when absent. */
export const shownWhere = (s: FinanceStatement, key: FinanceLineKey): boolean => key !== "lostDisputes" || lineOf(s, key) !== undefined;

const WHERE_KEYS = ["netRevenue", "cogs", "paymentFees", "platformFees", "shippingCosts", "marketing", "lostDisputes", "fixedCosts", "operatingProfit"] as const;

/** The bars with their labels in the admin's language; English unless given. */
export const whereItWent = (w: FinanceMessages["view"]["where"] = financeEn.view.where): readonly (readonly [FinanceLineKey, string])[] => WHERE_KEYS.map((key) => [key, w[key]] as const);

export const WHERE_IT_WENT = whereItWent();

/**
 * The sentences that open the page: what came in, what is left after the cost of goods, after what follows each sale, and after fixed
 * costs. Written in code from the statement, never flattering: a shortfall is a shortfall, and profit that cannot be known says so.
 */
export function profitLines(d: FinancePeriodData, money: (minor: number) => string, words: FinanceMessages = financeEn, numbers: FinanceNumbers = financeNumbers(words)): string[] {
  const w = words.view.profit;
  const pct = numbers.percent;
  const t = d.totals;
  const s = d.statement;
  const net = amountOf(s, "netRevenue");
  if (hasNoSales(d) || net === null) return [w.noSales];
  if (t.orders === 0) return [fillWords(w.onlyRefunds, { amount: money(t.refundsMinor) })];

  const lines = [countWords(t.orders, w.paid, { n: formatCount(t.orders), amount: money(net) })];
  if (!s.hasCosts) {
    const some = s.costCoverage !== null && s.costCoverage > 0;
    lines.push(
      some ? fillWords(w.someCosts, { share: pct(s.costCoverage, 0) }) : w.noCosts,
    );
    if (s.grossMargin !== null) lines.push(fillWords(w.knownMargin, { share: pct(s.grossMargin) }));
    return lines;
  }
  const gross = amountOf(s, "grossProfit");
  const contribution = amountOf(s, "contributionProfit");
  const operating = amountOf(s, "operatingProfit");
  const grossMargin = s.grossMargin;
  const cogs = lineOf(s, "cogs")?.amountMinor ?? null;
  const contributionMargin = lineOf(s, "contributionProfit")?.shareOfNet ?? null;
  const coverage = s.estimated && s.costCoverage !== null ? fillWords(w.coverage, { share: pct(s.costCoverage, 0) }) : "";
  const goods = s.estimated ? w.goodsEstimated : w.goods;
  const cogsText = money(cogs === null ? t.cogsMinor : -cogs);

  if (gross !== null) {
    lines.push(
      gross >= 0
        ? fillWords(w.grossLeft, { goods, cogs: cogsText, gross: money(gross), margin: grossMargin === null ? "" : fillWords(w.grossMargin, { share: pct(grossMargin) }), coverage })
        : fillWords(w.grossShort, { goods, cogs: cogsText, short: money(-gross), coverage }),
    );
  }
  if (contribution !== null) {
    lines.push(
      contribution >= 0
        ? fillWords(w.contribution, { amount: money(contribution), margin: contributionMargin === null ? "" : fillWords(w.contributionMargin, { share: pct(contributionMargin) }), estimate: s.estimated ? w.anEstimate : "" })
        : fillWords(w.contributionShort, { amount: money(-contribution) }),
    );
  }
  if (operating !== null && t.orders > 0 && lineOf(s, "fixedCosts") && (lineOf(s, "fixedCosts")?.amountMinor ?? 0) !== 0) {
    lines.push(operating >= 0 ? fillWords(w.operating, { amount: money(operating) }) : fillWords(w.operatingShort, { amount: money(-operating) }));
  }
  return lines;
}

/** Words for orders and refunds left out because their currency has no rate; empty when nothing was left out. */
export function currencyNotes(current: FinancePeriodData, comparison: FinancePeriodData | null, currency: string, words: FinanceMessages = financeEn): string[] {
  const w = words.view.currencies;
  const out: string[] = [];
  const one = (d: FinancePeriodData, which: string) => {
    if (d.unconverted <= 0) return;
    const n = d.unconverted;
    out.push(countWords(n, w.leftOut, { n: formatCount(n), currencies: d.missingCurrencies.join(", ") || w.another, which, currency }));
  };
  one(current, w.these);
  if (comparison) one(comparison, w.comparison);
  return out;
}

/** Product options without a cost, or null when that is not known. */
export function missingCostCount(setup: FinanceSetup | null): number | null {
  if (!setup) return null;
  return Math.max(0, setup.activeVariants - setup.variantsWithCost);
}

// ---------------------------------------------------------------------------
// Definitions
// ---------------------------------------------------------------------------

/** docs/analytics.md's definitions, in plain words, for the closing disclosure. */
export const FINANCE_DEFINITIONS: readonly { term: string; text: string }[] = financeEn.view.definitions;

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

const TONE: Record<Verdict, string> = { good: "text-(--chart-good)", bad: "text-(--chart-bad)", neutral: "text-muted" };
const ARROW = { up: "▲", down: "▼", flat: "▬" } as const;
/** A change in a table cell: an arrow, the signed text, and a hidden word for a screen reader, so colour is never alone. */
function ChangeCell({ value, w }: { value: LineChange | null; w: FinanceMessages["view"]["table"] }) {
  const SPOKEN = { up: w.up, down: w.down, flat: w.flat };
  const NEWS: Record<Verdict, string> = { good: w.better, bad: w.worse, neutral: "" };
  if (!value) return <span className="text-muted">{NO_FIGURE}</span>;
  const direction = arrowOf(value.abs);
  return (
    <span className={`inline-flex items-baseline gap-1 font-medium ${TONE[value.verdict]}`}>
      <span aria-hidden="true" className="text-[0.7em]">
        {ARROW[direction]}
      </span>
      <span className="sr-only">{`${SPOKEN[direction]}${NEWS[value.verdict]}: `}</span>
      <span>{value.text}</span>
    </span>
  );
}

/** Lines whose note is always in view: what is estimated, what is missing, and what the cost of goods and refunds rest on. */
const noteShown = (line: FinanceLine) => line.note !== null && (line.estimated || line.missing || line.key === "cogs" || line.key === "refunds");

function BridgeTable({ current, comparison, money, w, n }: { current: FinancePeriodData; comparison: FinanceViewProps["comparison"]; money: (minor: number) => string; w: FinanceMessages["view"]["table"]; n: FinanceNumbers }) {
  const prior = comparison && !hasNoSales(comparison.data) ? comparison.data : null;
  const versus = comparison ? (comparison.mode === "year" ? w.lastYear : w.previous) : null;
  const th = "whitespace-nowrap border-b border-line px-3 py-2 align-bottom";
  return (
    <>
    <div className={`relative overflow-x-auto ${CARD_CLASS}`}>
      <table data-export-id="finance.bridge" className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">{fillWords(w.caption, { period: current.label })}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} text-left`}>
              {w.line}
            </th>
            <th scope="col" className={`${th} text-right`}>
              <span>{w.thisPeriod}</span>
              <span className="block text-xs font-normal text-muted">{current.label}</span>
            </th>
            {comparison ? (
              <>
                <th scope="col" className={`${th} text-right`}>
                  <span>{versus}</span>
                  <span className="block text-xs font-normal text-muted">{comparison.data.label}</span>
                </th>
                <th scope="col" className={`${th} text-right`}>
                  {w.change}
                </th>
              </>
            ) : null}
            <th scope="col" className={`${th} text-right`} title={w.shareTitle}>
              {w.share}
            </th>
          </tr>
        </thead>
        <tbody>
          {current.statement.lines.map((line) => {
            const before = prior ? lineOf(prior.statement, line.key) : undefined;
            const beforeAmount = prior ? (before ? before.amountMinor : line.key === "rounding" ? 0 : null) : null;
            return (
              <tr key={line.key} data-line={line.key} className={`border-b border-line last:border-b-0 ${line.subtotal ? "bg-sunken font-medium" : ""}`}>
                <th scope="row" className="min-w-[10rem] px-3 py-2 text-left align-top font-[inherit]">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span {...(line.note && !noteShown(line) ? { title: line.note } : {})}>{plainLabel(line.label)}</span>
                    {line.estimated ? <StatusPill tone="info">{w.estimated}</StatusPill> : null}
                    {line.missing ? <StatusPill tone="warning">{w.costsMissing}</StatusPill> : null}
                  </span>
                  {noteShown(line) ? <span className="mt-0.5 block max-w-md text-xs font-normal text-muted">{line.note}</span> : null}
                </th>
                <td className="px-3 py-2 text-right align-top tabular-nums">{line.amountMinor === null ? <span className="text-muted">{NO_FIGURE}</span> : money(line.amountMinor)}</td>
                {comparison ? (
                  <>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {beforeAmount === null ? (
                        <span className="text-muted" {...(prior ? {} : { title: w.noOrders })}>
                          {NO_FIGURE}
                        </span>
                      ) : (
                        money(beforeAmount)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">
                      <ChangeCell value={prior ? lineChange(line, before, n) : null} w={w} />
                    </td>
                  </>
                ) : null}
                <td className="px-3 py-2 text-right align-top tabular-nums">{line.shareOfNet === null ? <span className="text-muted">{NO_FIGURE}</span> : n.percent(line.shareOfNet)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    <div className="mt-1 flex justify-end empty:hidden">
      <ExportButton exportId="finance.bridge" leftOut={{ orders: current.unconverted, currencies: current.missingCurrencies }} />
    </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export function FinanceView({ base, currency, locale, isOwner, current, comparison, bucket, series, comparisonSeries, setup, words = financeEn }: FinanceViewProps) {
  const v = words.view;
  const n = financeNumbers(words);
  const pct = n.percent;
  const money = moneyWriter(currency, locale);
  const settingsHref = `${base}/analytics/settings`;
  const productsHref = `${base}/products`;
  const s = current.statement;
  const t = current.totals;
  const sales = !hasNoSales(current);
  const prior = comparison && !hasNoSales(comparison.data) ? comparison.data : null;
  const compareWords = comparison ? (comparison.mode === "year" ? v.notes.lastYear : v.notes.previous) : null;
  const costsMissing = sales && !s.hasCosts;
  const coverage = s.costCoverage;
  const partialCoverage = sales && s.hasCosts && coverage !== null && coverage < 1;
  const someCosts = coverage !== null && coverage > 0;
  const missingOptions = missingCostCount(setup);

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [...currencyNotes(current, comparison?.data ?? null, currency, words)];
  if (!s.reconciles) notes.push(v.notes.reconciles);
  if (comparison && !prior && sales) notes.push(fillWords(v.notes.noComparison, { when: compareWords ?? "" }));
  const unsetWords: Partial<Record<FinanceLineKey, string>> = v.notes.unset;
  const unset = sales && s.hasCosts ? s.lines.filter((l) => l.missing && ["paymentFees", "shippingCosts", "fixedCosts"].includes(l.key)).map((l) => unsetWords[l.key] ?? plainLabel(l.label).toLowerCase()) : [];
  if (unset.length > 0) {
    const list = unset.length > 1 ? `${unset.slice(0, -1).join(", ")} ${v.notes.and} ${unset[unset.length - 1]}` : unset[0];
    notes.push(
      isOwner ? (
        <>
          {countWords(unset.length, v.notes.unsetOwner, { list })}
          <Link href={settingsHref} className={linkClass}>
            {countWords(unset.length, v.notes.enter)}
          </Link>
          .
        </>
      ) : (
        countWords(unset.length, v.notes.unsetStaff, { list })
      ),
    );
  }

  // ---- the cost coverage warning ----
  const backfill = setup && setup.backfillableLines > 0 ? setup.backfillableLines : 0;
  const c = v.coverage;
  const coverageNote =
    costsMissing || partialCoverage ? (
      <Note tone={costsMissing || (coverage !== null && coverage < COVERAGE_WARN) ? "warning" : "info"} title={costsMissing ? c.cannotTitle : fillWords(c.estimatedTitle, { share: pct(coverage, 0) })}>
        <p>
          {costsMissing ? (someCosts ? fillWords(c.someCosts, { share: pct(coverage, 0) }) : c.noCosts) : c.partial}{" "}
          {missingOptions !== null && missingOptions > 0 ? countWords(missingOptions, c.addCosts, { n: formatCount(missingOptions), goal: costsMissing ? c.seeProfit : c.coverRest }) : c.addInEditor}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <Link href={productsHref} className={linkClass}>
            {c.addLink}
          </Link>
          {backfill > 0 && isOwner ? (
            <span>
              {countWords(backfill, c.backfill, { n: formatCount(backfill) })}
              <Link href={settingsHref} className={linkClass}>
                {c.apply}
              </Link>
            </span>
          ) : null}
        </p>
      </Note>
    ) : null;

  // ---- the opening cards ----
  const k = v.cards;
  const deltaOf = (kind: "money" | "percent", good: GoodDirection, now: number | null, then: number | null) => {
    if (!prior) return null;
    const ch = kpiChange({ kind, good }, now, then);
    return ch.abs === null ? null : { text: withDecimals(ch.text, decimalComma(words)), abs: ch.abs, verdict: ch.verdict };
  };
  const compared = (kind: "money" | "percent", good: GoodDirection, now: number | null, then: number | null): Partial<KpiCardProps> => {
    if (!comparison) return {};
    const d = deltaOf(kind, good, now, then);
    return comparison.mode === "year" ? { deltaLastYear: d } : { deltaPrevious: d };
  };
  const before = (key: FinanceLineKey) => (prior ? amountOf(prior.statement, key) : null);
  const beforeShare = (key: FinanceLineKey) => (prior ? (lineOf(prior.statement, key)?.shareOfNet ?? null) : null);

  const costMissing = (what: string): KpiCardProps => ({
    label: "",
    value: null,
    state: "missing",
    missing: costsMissing ? { text: fillWords(k.needsCosts, { what }), action: { label: c.addLink, href: productsHref } } : { text: k.needsRevenue },
  });
  const grossLine = lineOf(s, "grossProfit");
  const contributionLine = lineOf(s, "contributionProfit");
  const operatingLine = lineOf(s, "operatingProfit");
  const netAmount = amountOf(s, "netRevenue");
  const cards: (KpiCardProps & { id: string })[] = [
    {
      id: "net",
      label: k.net,
      value: netAmount === null ? null : money(netAmount),
      good: "up",
      emphasis: true,
      help: k.netHelp,
      ...compared("money", "up", netAmount, before("netRevenue")),
    },
    typeof s.grossMargin === "number"
      ? {
          id: "gross",
          label: k.gross,
          value: pct(s.grossMargin),
          good: "up",
          emphasis: true,
          help: k.grossHelp,
          hint: fillWords(k.grossHint, {
            amount: grossLine?.amountMinor == null ? NO_FIGURE : `${money(grossLine.amountMinor)}${s.estimated ? k.estimated : ""}`,
            estimated: "",
            based: coverage === null ? "" : fillWords(k.based, { share: pct(coverage, 0) }),
          }),
          ...compared("percent", "up", s.grossMargin, prior ? prior.statement.grossMargin : null),
        }
      : { ...costMissing(k.margin), id: "gross", label: k.gross, help: k.grossHelpShort, emphasis: true },
    typeof contributionLine?.shareOfNet === "number"
      ? {
          id: "contribution",
          label: k.contribution,
          value: pct(contributionLine.shareOfNet),
          good: "up",
          emphasis: true,
          help: k.contributionHelp,
          hint: fillWords(k.contributionHint, { amount: contributionLine.amountMinor === null ? NO_FIGURE : money(contributionLine.amountMinor) }),
          ...compared("percent", "up", contributionLine.shareOfNet, beforeShare("contributionProfit")),
        }
      : { ...costMissing(k.margin), id: "contribution", label: k.contribution, help: k.contributionHelpShort, emphasis: true },
    typeof operatingLine?.amountMinor === "number"
      ? {
          id: "operating",
          label: k.operating,
          value: money(operatingLine.amountMinor),
          good: "up",
          emphasis: true,
          help: k.operatingHelp,
          hint: lineOf(s, "fixedCosts")?.missing ? k.operatingNoFixed : k.operatingHint,
          ...compared("money", "up", operatingLine.amountMinor, before("operatingProfit")),
        }
      : { ...costMissing(k.profit), id: "operating", label: k.operating, help: k.operatingHelp, emphasis: true },
  ];

  // ---- where net revenue went ----
  const flow = (key: FinanceLineKey): FinanceLine | undefined => lineOf(s, key);
  const flowRow = (key: FinanceLineKey, label: string, colorIndex: number): BarRow => {
    const line = flow(key);
    const amount = line?.amountMinor ?? null;
    const share = line?.shareOfNet ?? null;
    const detail = line?.missing && amount !== null ? v.bars.notEntered : line?.missing ? v.bars.costsMissing : line?.estimated ? v.bars.estimated : undefined;
    return {
      key,
      label,
      value: amount,
      valueText: amount === null ? NO_FIGURE : money(amount),
      detail: [share === null ? null : pct(share), detail].filter(Boolean).join(" · ") || undefined,
      colorIndex,
    };
  };
  const bars: BarRow[] = whereItWent(v.where).filter(([key]) => shownWhere(s, key)).map(([key, label]) => flowRow(key, label, key === "operatingProfit" ? 2 : 0));

  // ---- over time ----
  const x = v.sections;
  const labels = series.map((p) => p.label);
  const per = x.buckets[bucket];
  const contributionKnown = series.some((p) => p.contributionMinor !== null);
  const previousLabel = comparison?.mode === "year" ? v.table.lastYear : v.table.previous;
  const chartSeries = [
    {
      key: "net",
      label: v.where.netRevenue,
      values: series.map((p) => p.netRevenueMinor),
      ...(comparisonSeries ? { previous: series.map((_, i) => comparisonSeries[i]?.netRevenueMinor ?? null) } : {}),
    },
    ...(contributionKnown ? [{ key: "contribution", label: words.statement.labels.contributionProfit, values: series.map((p) => p.contributionMinor) }] : []),
  ];

  // ---- VAT and refunds ----
  const refundRate = safeRatio(t.refundsMinor, t.revenueMinor > 0 ? t.revenueMinor : null);
  const vatCard: KpiCardProps = {
    label: k.vat,
    value: t.orders > 0 ? money(t.vatMinor) : null,
    state: t.orders > 0 ? "ok" : "missing",
    missing: { text: k.vatMissing },
    good: "neutral",
    help: k.vatHelp,
    hint: k.vatHint,
    ...compared("money", "neutral", t.vatMinor, prior ? prior.totals.vatMinor : null),
  };
  const refundCard: KpiCardProps = {
    label: k.refunds,
    value: money(t.refundsMinor),
    good: "down",
    help: k.refundsHelp,
    hint: refundRate === null ? k.refundsNoRevenue : fillWords(k.refundsShare, { share: pct(refundRate) }),
    ...compared("money", "down", t.refundsMinor, prior ? prior.totals.refundsMinor : null),
  };
  const overTime = fillWords(x.overTime, { per });

  return (
    <div className="flex flex-col gap-8">
      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((note, i) => (
            <Note key={i} tone="warning">
              {note}
            </Note>
          ))}
        </div>
      ) : null}
      {coverageNote}

      <AnalyticsSection id="finance-left" title={x.leftTitle} description={fillWords(x.leftDescription, { period: current.label, currency })}>
        <div className="space-y-1 rounded-panel bg-sunken p-4 text-sm">
          {profitLines(current, money, words, n).map((line, i) => (
            <p key={i} className={i === 0 ? "text-base font-medium" : "text-muted"}>
              {line}
            </p>
          ))}
        </div>
        {sales ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map(({ id, ...props }) => (
              <KpiCard key={id} {...props} />
            ))}
          </div>
        ) : null}
      </AnalyticsSection>

      {sales ? (
        <>
          <AnalyticsSection id="finance-bridge" title={x.bridgeTitle} description={x.bridgeDescription}>
            <BridgeTable current={current} comparison={comparison} money={money} w={v.table} n={n} />
            <p className="text-xs text-muted">{x.bridgeNote}</p>
          </AnalyticsSection>

          <AnalyticsSection id="finance-where" title={x.whereTitle} description={x.whereDescription}>
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title={x.flowTitle} description={x.flowDescription}>
                <HorizontalBars label={x.flowLabel} rows={bars} exportId="finance.where_it_went" exportLeftOut={{ orders: current.unconverted, currencies: current.missingCurrencies }} />
              </ChartCard>
              <ChartCard title={overTime} description={contributionKnown ? x.overTimeWith : x.overTimeWithout}>
                <LineChart label={overTime} labels={labels} series={chartSeries} format={money} previousLabel={previousLabel} exportId="finance.revenue_profit" exportLeftOut={{ orders: current.unconverted, currencies: current.missingCurrencies }} />
              </ChartCard>
            </div>
          </AnalyticsSection>

          <AnalyticsSection id="finance-vat-refunds" title={x.vatTitle} description={x.vatDescription}>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard {...vatCard} />
              <KpiCard {...refundCard} />
            </div>
          </AnalyticsSection>
        </>
      ) : null}

      <AnalyticsSection id="finance-method" title={x.methodTitle}>
        <details className="rounded-panel border border-line bg-card p-4 text-sm">
          <summary className="cursor-pointer font-medium">{x.methodSummary}</summary>
          <dl className="mt-3 space-y-2">
            {v.definitions.map((d) => (
              <div key={d.term}>
                <dt className="font-medium">{d.term}</dt>
                <dd className="text-muted">{d.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      </AnalyticsSection>

      <p className="text-xs text-muted">{fillWords(x.footer, { currency })}</p>
    </div>
  );
}
