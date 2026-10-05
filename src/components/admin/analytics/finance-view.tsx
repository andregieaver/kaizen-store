import Link from "next/link";
import type { ReactNode } from "react";

import { change, formatChange, formatCount, formatPercent, NO_FIGURE, safeRatio, verdictOf, type GoodDirection, type Verdict } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import type { FinanceLine, FinanceLineKey, FinanceStatement } from "@/lib/analytics-finance";
import { COVERAGE_WARN, kpiChange, type Totals } from "@/lib/analytics-kpi";
import type { Bucket } from "@/lib/analytics-period";
import type { SeriesPoint } from "@/server/analytics-totals";

import { HorizontalBars, LineChart, type BarRow } from "./charts";
import { arrowOf, StatusPill } from "./data-table";
import { ExportButton } from "./export-scope";
import { KpiCard, type KpiCardProps } from "./kpi-card";
import { AnalyticsSection, ChartCard, Note } from "./section";

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
};

// ---------------------------------------------------------------------------
// Small pure helpers (exported for the tests)
// ---------------------------------------------------------------------------

/** A whole number of minor units written as an amount; a value between whole minor units (an axis tick) is rounded, never refused. */
export function moneyWriter(currency: string, locale: string): (minor: number) => string {
  return (minor) => formatAmount(Math.round(minor), currency, locale);
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

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
export function lineChange(line: FinanceLine, previous: FinanceLine | undefined): LineChange | null {
  const before = previous ? previous.amountMinor : line.key === "rounding" ? 0 : null;
  if (line.amountMinor === null || before === null) return null;
  const deduction = DEDUCTIONS.has(line.key);
  const delta = change(deduction ? Math.abs(line.amountMinor) : line.amountMinor, deduction ? Math.abs(before) : before);
  if (!delta) return null;
  const good: GoodDirection = line.key === "rounding" ? "neutral" : deduction ? "down" : "up";
  // A change under a twentieth of a percent is rounding, not news.
  const verdict = delta.pct !== null && Math.abs(delta.pct) < 0.0005 ? "neutral" : verdictOf(delta.abs, good);
  return { text: formatChange(delta), abs: delta.abs, verdict };
}

/** The label without a trailing "(estimated)": the line carries the tag instead. */
export const plainLabel = (label: string) => label.replace(/ \((estimated|estimate)\)$/, "");

/** The bars of "Where net revenue went", in order: a line of the statement and its label (the CSV repeats them). */
export const WHERE_IT_WENT: readonly (readonly [FinanceLineKey, string])[] = [
  ["netRevenue", "Net revenue"],
  ["cogs", "Cost of goods"],
  ["paymentFees", "Payment fees"],
  ["platformFees", "Platform fees"],
  ["shippingCosts", "Shipping costs"],
  ["marketing", "Marketing"],
  ["fixedCosts", "Fixed costs"],
  ["operatingProfit", "Operating profit"],
];

/**
 * The sentences that open the page: what came in, what is left after the cost of goods, after what follows each sale, and after fixed
 * costs. Written in code from the statement, never flattering: a shortfall is a shortfall, and profit that cannot be known says so.
 */
export function profitLines(d: FinancePeriodData, money: (minor: number) => string): string[] {
  const t = d.totals;
  const s = d.statement;
  const net = amountOf(s, "netRevenue");
  if (hasNoSales(d) || net === null) return ["No orders were paid in this period yet. Once they are, this is where you see how much of each sale is left after what it costs."];
  if (t.orders === 0) return [`No orders were paid in this period, but refunds of ${money(t.refundsMinor)} were made in it.`];

  const lines = [`${formatCount(t.orders)} paid ${plural(t.orders, "order", "orders")} brought in ${money(net)} after refunds.`];
  if (!s.hasCosts) {
    const some = s.costCoverage !== null && s.costCoverage > 0;
    lines.push(
      some
        ? `Product costs are known for only ${formatPercent(s.costCoverage, 0)} of sales, too few to estimate profit from. Add what the rest of your products cost to see how much of this is yours to keep.`
        : "None of the products sold has a cost entered, so there is no profit to show. Add what your products cost to see how much of this is yours to keep.",
    );
    if (s.grossMargin !== null) lines.push(`On the sales whose cost is known, the gross margin is ${formatPercent(s.grossMargin)}.`);
    return lines;
  }
  const gross = amountOf(s, "grossProfit");
  const contribution = amountOf(s, "contributionProfit");
  const operating = amountOf(s, "operatingProfit");
  const grossMargin = s.grossMargin;
  const cogs = lineOf(s, "cogs")?.amountMinor ?? null;
  const contributionMargin = lineOf(s, "contributionProfit")?.shareOfNet ?? null;
  const coverage = s.estimated && s.costCoverage !== null ? `, estimated from the ${formatPercent(s.costCoverage, 0)} of sales whose cost is known` : "";
  const goods = s.estimated ? "The goods cost an estimated" : "The goods cost";

  if (gross !== null) {
    lines.push(
      gross >= 0
        ? `${goods} ${money(cogs === null ? t.cogsMinor : -cogs)}, which leaves a gross profit of ${money(gross)}${grossMargin === null ? "" : ` (${formatPercent(grossMargin)} of net revenue)`}${coverage}.`
        : `${goods} ${money(cogs === null ? t.cogsMinor : -cogs)}, which is ${money(-gross)} more than they brought in${coverage}.`,
    );
  }
  if (contribution !== null) {
    lines.push(
      contribution >= 0
        ? `After fees, shipping and marketing, contribution profit is about ${money(contribution)}${contributionMargin === null ? "" : ` (${formatPercent(contributionMargin)})`}${s.estimated ? ", an estimate" : ""}.`
        : `After fees, shipping and marketing, the store is about ${money(-contribution)} short.`,
    );
  }
  if (operating !== null && t.orders > 0 && lineOf(s, "fixedCosts") && (lineOf(s, "fixedCosts")?.amountMinor ?? 0) !== 0) {
    lines.push(operating >= 0 ? `After fixed costs, operating profit is about ${money(operating)}. That is an estimate.` : `After fixed costs, the store is about ${money(-operating)} short. That is an estimate.`);
  }
  return lines;
}

/** Words for orders and refunds left out because their currency has no rate; empty when nothing was left out. */
export function currencyNotes(current: FinancePeriodData, comparison: FinancePeriodData | null, currency: string): string[] {
  const out: string[] = [];
  const one = (d: FinancePeriodData, which: string) => {
    if (d.unconverted <= 0) return;
    const n = d.unconverted;
    out.push(
      `${formatCount(n)} ${plural(n, "order or refund", "orders and refunds")} in ${d.missingCurrencies.join(", ") || "another currency"} ${plural(n, "is", "are")} left out of ${which} because the store has no rate to ${currency}, so those figures are lower than they should be.`,
    );
  };
  one(current, "these figures");
  if (comparison) one(comparison, "the comparison period");
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
export const FINANCE_DEFINITIONS: readonly { term: string; text: string }[] = [
  { term: "Paid order", text: "An order with a payment taken. Unpaid and cancelled-before-payment orders, copied orders and hosts' orders are not counted. An order paid and later refunded still counts; the refund is taken off as a refund. Dated by the day it was placed." },
  { term: "Gross sales", text: "The price of the goods sold before any discount, without VAT." },
  { term: "Discounts", text: "Everything taken off the goods: campaigns, customer groups, codes, referral and bonus credit, without VAT." },
  { term: "Shipping income", text: "What shoppers paid for shipping, without VAT." },
  { term: "Revenue", text: "Gross sales less discounts plus shipping income: what paid orders brought in, without VAT. Refunds are not yet taken off." },
  { term: "Refunds", text: "Money paid back in the period, dated by the day of the refund, without VAT. Refunds made only in the payment provider's dashboard are not seen." },
  { term: "Net revenue", text: "Revenue less refunds." },
  { term: "Cost of goods sold", text: "What the units sold cost you, kept on each order line when it was sold, so a later change of cost never rewrites history. A line sold without a cost counts as costing nothing, and the coverage figure says how much of sales that is." },
  { term: "Gross profit and gross margin", text: "Net revenue less the cost of goods sold. The margin is the gross profit as a share of net revenue." },
  { term: "Payment fees (estimated)", text: "Worked out for every paid order from the fee percentage and fixed fee in Analytics settings, on the order's total with VAT. Your payment provider's statement is the real figure." },
  { term: "Platform fees", text: "What Kaizen took on the period's payments. This is recorded, not estimated." },
  { term: "Shipping costs (estimated)", text: "The cost of sending one order, from Analytics settings, for every paid order with something physical in it." },
  { term: "Marketing", text: "The ad spend you entered under Marketing, day by day, for the days of the period." },
  { term: "Contribution profit and margin", text: "Net revenue less the cost of goods, payment fees, platform fees, shipping costs and marketing: what each sale leaves before fixed costs. The margin is that as a share of net revenue." },
  { term: "Fixed costs (pro rata)", text: "The monthly amount in Analytics settings (rent, salaries and the like) spread evenly over the days of the period." },
  { term: "Operating profit (estimate)", text: "Contribution profit less fixed costs. It rests on estimates, so treat it as a guide." },
  { term: "VAT", text: "Tax charged on orders, including shipping (VAT not charged under reverse charge is not counted, and is not a discount). It is passed on to the tax authorities and is not income; every other figure here is without it." },
  { term: "Currencies", text: "Amounts in another currency are converted into the store's main currency at today's rates, so history is valued at today's rates. An order in a currency with no rate is left out and counted." },
];

// ---------------------------------------------------------------------------
// Pieces
// ---------------------------------------------------------------------------

const linkClass = "font-medium text-(--brand-text) underline-offset-2 hover:underline";

const TONE: Record<Verdict, string> = { good: "text-(--chart-good)", bad: "text-(--chart-bad)", neutral: "text-muted" };
const ARROW = { up: "▲", down: "▼", flat: "▬" } as const;
const SPOKEN = { up: "Up", down: "Down", flat: "No change" } as const;
const NEWS: Record<Verdict, string> = { good: ", better", bad: ", worse", neutral: "" };

/** A change in a table cell: an arrow, the signed text, and a hidden word for a screen reader, so colour is never alone. */
function ChangeCell({ value }: { value: LineChange | null }) {
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

/** The estimated costs the owner enters in Analytics settings, as a sentence names them. */
const UNSET_WORDS: Partial<Record<FinanceLineKey, string>> = { paymentFees: "payment fees", shippingCosts: "shipping costs", fixedCosts: "fixed costs" };

/** Lines whose note is always in view: what is estimated, what is missing, and what the cost of goods and refunds rest on. */
const noteShown = (line: FinanceLine) => line.note !== null && (line.estimated || line.missing || line.key === "cogs" || line.key === "refunds");

function BridgeTable({ current, comparison, money }: { current: FinancePeriodData; comparison: FinanceViewProps["comparison"]; money: (minor: number) => string }) {
  const prior = comparison && !hasNoSales(comparison.data) ? comparison.data : null;
  const versus = comparison ? (comparison.mode === "year" ? "Same period last year" : "Previous period") : null;
  const th = "whitespace-nowrap border-b border-border px-3 py-2 align-bottom";
  return (
    <>
    <div className="relative overflow-x-auto rounded-lg border border-border bg-background">
      <table data-export-id="finance.bridge" className="w-full min-w-[40rem] border-collapse text-sm">
        <caption className="sr-only">From gross sales to operating profit, one line for each step, in {current.label}</caption>
        <thead>
          <tr>
            <th scope="col" className={`${th} text-left`}>
              Line
            </th>
            <th scope="col" className={`${th} text-right`}>
              <span>This period</span>
              <span className="block text-xs font-normal text-muted">{current.label}</span>
            </th>
            {comparison ? (
              <>
                <th scope="col" className={`${th} text-right`}>
                  <span>{versus}</span>
                  <span className="block text-xs font-normal text-muted">{comparison.data.label}</span>
                </th>
                <th scope="col" className={`${th} text-right`}>
                  Change
                </th>
              </>
            ) : null}
            <th scope="col" className={`${th} text-right`} title="Each line as a share of net revenue">
              Share of net revenue
            </th>
          </tr>
        </thead>
        <tbody>
          {current.statement.lines.map((line) => {
            const before = prior ? lineOf(prior.statement, line.key) : undefined;
            const beforeAmount = prior ? (before ? before.amountMinor : line.key === "rounding" ? 0 : null) : null;
            return (
              <tr key={line.key} data-line={line.key} className={`border-b border-border last:border-b-0 ${line.subtotal ? "bg-surface font-semibold" : ""}`}>
                <th scope="row" className="min-w-[10rem] px-3 py-2 text-left align-top font-[inherit]">
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span {...(line.note && !noteShown(line) ? { title: line.note } : {})}>{plainLabel(line.label)}</span>
                    {line.estimated ? <StatusPill tone="info">Estimated</StatusPill> : null}
                    {line.missing ? <StatusPill tone="warning">Costs missing</StatusPill> : null}
                  </span>
                  {noteShown(line) ? <span className="mt-0.5 block max-w-md text-xs font-normal text-muted">{line.note}</span> : null}
                </th>
                <td className="px-3 py-2 text-right align-top tabular-nums">{line.amountMinor === null ? <span className="text-muted">{NO_FIGURE}</span> : money(line.amountMinor)}</td>
                {comparison ? (
                  <>
                    <td className="px-3 py-2 text-right align-top tabular-nums">
                      {beforeAmount === null ? (
                        <span className="text-muted" {...(prior ? {} : { title: "No orders were paid in that period" })}>
                          {NO_FIGURE}
                        </span>
                      ) : (
                        money(beforeAmount)
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right align-top tabular-nums">
                      <ChangeCell value={prior ? lineChange(line, before) : null} />
                    </td>
                  </>
                ) : null}
                <td className="px-3 py-2 text-right align-top tabular-nums">{line.shareOfNet === null ? <span className="text-muted">{NO_FIGURE}</span> : formatPercent(line.shareOfNet)}</td>
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

export function FinanceView({ base, currency, locale, isOwner, current, comparison, bucket, series, comparisonSeries, setup }: FinanceViewProps) {
  const money = moneyWriter(currency, locale);
  const settingsHref = `${base}/analytics/settings`;
  const productsHref = `${base}/products`;
  const s = current.statement;
  const t = current.totals;
  const sales = !hasNoSales(current);
  const prior = comparison && !hasNoSales(comparison.data) ? comparison.data : null;
  const compareWords = comparison ? (comparison.mode === "year" ? "the same period last year" : "the previous period") : null;
  const costsMissing = sales && !s.hasCosts;
  const coverage = s.costCoverage;
  const partialCoverage = sales && s.hasCosts && coverage !== null && coverage < 1;
  const someCosts = coverage !== null && coverage > 0;
  const missingOptions = missingCostCount(setup);

  // ---- notes about what the figures are and are not ----
  const notes: ReactNode[] = [...currencyNotes(current, comparison?.data ?? null, currency)];
  if (!s.reconciles) notes.push("The lines of the statement below do not add up exactly. The figures are as recorded; please report this.");
  if (comparison && !prior && sales) notes.push(`No orders were paid in ${compareWords}, so there is nothing to compare with.`);
  const unset = sales && s.hasCosts ? s.lines.filter((l) => l.missing && ["paymentFees", "shippingCosts", "fixedCosts"].includes(l.key)).map((l) => UNSET_WORDS[l.key] ?? plainLabel(l.label).toLowerCase()) : [];
  if (unset.length > 0) {
    const list = unset.length > 1 ? `${unset.slice(0, -1).join(", ")} and ${unset[unset.length - 1]}` : unset[0];
    notes.push(
      isOwner ? (
        <>
          {`The ${list} ${plural(unset.length, "is", "are")} not entered, so ${plural(unset.length, "it counts", "they count")} as nothing and profit may look better than it is. `}
          <Link href={settingsHref} className={linkClass}>
            Enter {plural(unset.length, "it", "them")} in Analytics settings
          </Link>
          .
        </>
      ) : (
        `The ${list} ${plural(unset.length, "is", "are")} not entered, so ${plural(unset.length, "it counts", "they count")} as nothing and profit may look better than it is. An owner can enter ${plural(unset.length, "it", "them")} in Analytics settings.`
      ),
    );
  }

  // ---- the cost coverage warning ----
  const backfill = setup && setup.backfillableLines > 0 ? setup.backfillableLines : 0;
  const coverageNote =
    costsMissing || partialCoverage ? (
      <Note tone={costsMissing || (coverage !== null && coverage < COVERAGE_WARN) ? "warning" : "info"} title={costsMissing ? "Profit cannot be shown yet" : `Profit is estimated from the ${formatPercent(coverage, 0)} of sales whose cost is known`}>
        <p>
          {costsMissing
            ? someCosts
              ? `Product costs are known for only ${formatPercent(coverage, 0)} of sales, too few to estimate from (30 % is the least), so gross profit, contribution profit and operating profit have no figure rather than a misleading one. The gross margin below is for the sales whose cost is known.`
              : "None of the products sold has a cost entered, so gross profit, contribution profit and operating profit have no figure rather than a misleading one."
            : "The rest of sales was made without a cost entered, so its cost of goods is estimated from the sales that have one, in the same proportion. Margins are worked out on the sales whose cost is known."}{" "}
          {missingOptions !== null && missingOptions > 0
            ? `Add costs to ${formatCount(missingOptions)} product ${plural(missingOptions, "option", "options")} (an option is one size, colour or other choice of a product) to ${costsMissing ? "see profit" : "cover the rest"}.`
            : "Add what each product costs in the product editor."}
        </p>
        <p className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
          <Link href={productsHref} className={linkClass}>
            Add costs in the product editor
          </Link>
          {backfill > 0 && isOwner ? (
            <span>
              {`${formatCount(backfill)} earlier order ${plural(backfill, "line", "lines")} can be filled in with costs entered since: `}
              <Link href={settingsHref} className={linkClass}>
                apply them in Analytics settings
              </Link>
            </span>
          ) : null}
        </p>
      </Note>
    ) : null;

  // ---- the opening cards ----
  const deltaOf = (kind: "money" | "percent", good: GoodDirection, now: number | null, then: number | null) => {
    if (!prior) return null;
    const c = kpiChange({ kind, good }, now, then);
    return c.abs === null ? null : { text: c.text, abs: c.abs, verdict: c.verdict };
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
    missing: costsMissing
      ? { text: `Needs product costs. Enter what a unit costs in the product editor to see ${what}.`, action: { label: "Add costs in the product editor", href: productsHref } }
      : { text: "Needs net revenue above 0 in the period." },
  });
  const grossLine = lineOf(s, "grossProfit");
  const contributionLine = lineOf(s, "contributionProfit");
  const operatingLine = lineOf(s, "operatingProfit");
  const netAmount = amountOf(s, "netRevenue");
  const cards: (KpiCardProps & { id: string })[] = [
    {
      id: "net",
      label: "Net revenue",
      value: netAmount === null ? null : money(netAmount),
      good: "up",
      emphasis: true,
      help: "Revenue less refunds made in the period, without VAT.",
      ...compared("money", "up", netAmount, before("netRevenue")),
    },
    typeof s.grossMargin === "number"
      ? {
          id: "gross",
          label: "Gross margin",
          value: formatPercent(s.grossMargin),
          good: "up",
          emphasis: true,
          help: "Gross profit as a share of net revenue, worked out on the sales whose cost is known: what is left of each sale after the cost of the goods.",
          hint: `Gross profit ${grossLine?.amountMinor == null ? NO_FIGURE : `${money(grossLine.amountMinor)}${s.estimated ? " (estimated)" : ""}`}${coverage === null ? "" : `, based on ${formatPercent(coverage, 0)} of sales`}`,
          ...compared("percent", "up", s.grossMargin, prior ? prior.statement.grossMargin : null),
        }
      : { ...costMissing("margin"), id: "gross", label: "Gross margin", help: "Gross profit as a share of net revenue: what is left of each sale after the cost of the goods.", emphasis: true },
    typeof contributionLine?.shareOfNet === "number"
      ? {
          id: "contribution",
          label: "Contribution margin",
          value: formatPercent(contributionLine.shareOfNet),
          good: "up",
          emphasis: true,
          help: "Contribution profit as a share of net revenue. Contribution profit is what is left after the goods, payment and platform fees, shipping and marketing, before fixed costs.",
          hint: `Contribution profit ${contributionLine.amountMinor === null ? NO_FIGURE : money(contributionLine.amountMinor)} (estimated)`,
          ...compared("percent", "up", contributionLine.shareOfNet, beforeShare("contributionProfit")),
        }
      : { ...costMissing("margin"), id: "contribution", label: "Contribution margin", help: "Contribution profit as a share of net revenue.", emphasis: true },
    typeof operatingLine?.amountMinor === "number"
      ? {
          id: "operating",
          label: "Operating profit (estimate)",
          value: money(operatingLine.amountMinor),
          good: "up",
          emphasis: true,
          help: "Contribution profit less fixed costs spread over the days of the period.",
          hint: lineOf(s, "fixedCosts")?.missing ? "No fixed costs are entered, so this equals contribution profit." : "After fixed costs. Rests on estimates.",
          ...compared("money", "up", operatingLine.amountMinor, before("operatingProfit")),
        }
      : { ...costMissing("profit"), id: "operating", label: "Operating profit (estimate)", help: "Contribution profit less fixed costs spread over the days of the period.", emphasis: true },
  ];

  // ---- where net revenue went ----
  const flow = (key: FinanceLineKey): FinanceLine | undefined => lineOf(s, key);
  const flowRow = (key: FinanceLineKey, label: string, colorIndex: number): BarRow => {
    const line = flow(key);
    const amount = line?.amountMinor ?? null;
    const share = line?.shareOfNet ?? null;
    const detail = line?.missing && amount !== null ? "not entered" : line?.missing ? "costs missing" : line?.estimated ? "estimated" : undefined;
    return {
      key,
      label,
      value: amount,
      valueText: amount === null ? NO_FIGURE : money(amount),
      detail: [share === null ? null : formatPercent(share), detail].filter(Boolean).join(" · ") || undefined,
      colorIndex,
    };
  };
  const bars: BarRow[] = WHERE_IT_WENT.map(([key, label]) => flowRow(key, label, key === "operatingProfit" ? 2 : 0));

  // ---- over time ----
  const labels = series.map((p) => p.label);
  const per = bucket;
  const contributionKnown = series.some((p) => p.contributionMinor !== null);
  const previousLabel = comparison?.mode === "year" ? "Same period last year" : "Previous period";
  const chartSeries = [
    {
      key: "net",
      label: "Net revenue",
      values: series.map((p) => p.netRevenueMinor),
      ...(comparisonSeries ? { previous: series.map((_, i) => comparisonSeries[i]?.netRevenueMinor ?? null) } : {}),
    },
    ...(contributionKnown ? [{ key: "contribution", label: "Contribution profit", values: series.map((p) => p.contributionMinor) }] : []),
  ];

  // ---- VAT and refunds ----
  const refundRate = safeRatio(t.refundsMinor, t.revenueMinor > 0 ? t.revenueMinor : null);
  const vatCard: KpiCardProps = {
    label: "VAT collected",
    value: t.orders > 0 ? money(t.vatMinor) : null,
    state: t.orders > 0 ? "ok" : "missing",
    missing: { text: "No orders were paid in this period." },
    good: "neutral",
    help: "Tax charged on paid orders, including shipping. VAT not charged on a sale to a business in another EU country (reverse charge) is not counted here and is not a discount.",
    hint: "Passed on to the tax authorities. Not income, and left out of every other figure on this page.",
    ...compared("money", "neutral", t.vatMinor, prior ? prior.totals.vatMinor : null),
  };
  const refundCard: KpiCardProps = {
    label: "Refunds",
    value: money(t.refundsMinor),
    good: "down",
    help: "Money paid back in the period, dated by the day of the refund, without VAT.",
    hint: refundRate === null ? "No revenue to compare with." : `${formatPercent(refundRate)} of revenue`,
    ...compared("money", "down", t.refundsMinor, prior ? prior.totals.refundsMinor : null),
  };

  return (
    <div className="flex flex-col gap-8">
      {notes.length > 0 ? (
        <div className="space-y-2">
          {notes.map((n, i) => (
            <Note key={i} tone="warning">
              {n}
            </Note>
          ))}
        </div>
      ) : null}
      {coverageNote}

      <AnalyticsSection id="finance-left" title="How much of what we sell is left?" description={`${current.label}, in ${currency} without VAT.`}>
        <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
          {profitLines(current, money).map((line, i) => (
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
          <AnalyticsSection
            id="finance-bridge"
            title="From gross sales to operating profit"
            description="Each line adds to or takes from the one above; the shaded lines are the totals so far. Tags say what is estimated and what is missing."
          >
            <BridgeTable current={current} comparison={comparison} money={money} />
            <p className="text-xs text-muted">Refunds made only in the payment provider&apos;s dashboard are not seen, so refunds here may be lower than what was paid back.</p>
          </AnalyticsSection>

          <AnalyticsSection id="finance-where" title="Where net revenue went" description="Each bar is on the same scale as net revenue. Costs are shown as minus amounts, with their share of net revenue.">
            <div className="grid gap-4 lg:grid-cols-2">
              <ChartCard title="From net revenue to operating profit" description="Cost of goods and the estimated fees and costs are taken off in turn. A bar marked costs missing has no figure yet.">
                <HorizontalBars label="Where net revenue went, from net revenue to operating profit" rows={bars} exportId="finance.where_it_went" exportLeftOut={{ orders: current.unconverted, currencies: current.missingCurrencies }} />
              </ChartCard>
              <ChartCard
                title={`Net revenue and contribution profit per ${per}`}
                description={contributionKnown ? "Contribution profit is what each sale leaves after its own costs, before fixed costs. It is partly estimated." : "Contribution profit needs product costs, so only net revenue is drawn."}
              >
                <LineChart label={`Net revenue and contribution profit per ${per}`} labels={labels} series={chartSeries} format={money} previousLabel={previousLabel} exportId="finance.revenue_profit" exportLeftOut={{ orders: current.unconverted, currencies: current.missingCurrencies }} />
              </ChartCard>
            </div>
          </AnalyticsSection>

          <AnalyticsSection id="finance-vat-refunds" title="VAT and refunds" description="VAT is not income. Refunds are money given back.">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <KpiCard {...vatCard} />
              <KpiCard {...refundCard} />
            </div>
          </AnalyticsSection>
        </>
      ) : null}

      <AnalyticsSection id="finance-method" title="How these are worked out">
        <details className="rounded-lg border border-border bg-background p-4 text-sm">
          <summary className="cursor-pointer font-medium">What each line means</summary>
          <dl className="mt-3 space-y-2">
            {FINANCE_DEFINITIONS.map((d) => (
              <div key={d.term}>
                <dt className="font-medium">{d.term}</dt>
                <dd className="text-muted">{d.text}</dd>
              </div>
            ))}
          </dl>
        </details>
      </AnalyticsSection>

      <p className="text-xs text-muted">
        All amounts are in {currency} without VAT unless a label says otherwise. Refunds made only in the payment provider&apos;s dashboard are not seen. History is valued at today&apos;s exchange rates.
      </p>
    </div>
  );
}
