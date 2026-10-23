import Link from "next/link";

import { countWords, fillWords } from "@/lib/admin-fill";
import { taxReportsEn, type TaxReportsMessages } from "@/lib/admin-messages/tax-reports.en";

import { formatCount, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import { addDays } from "@/lib/analytics-period";
import { rangeKey } from "@/lib/tax-periods";
import type { CurrencyBridge, MainBridge, ReconLine } from "@/lib/tax-reconciliation";
import { ratePercent, type VatReport, type VatRow } from "@/lib/tax-report";
import { lineWords, placeText, reasonWords } from "@/lib/tax-report-words";
import type { ReconciliationView } from "@/server/tax-reconciliation";

import { HorizontalBars, type BarRow } from "./charts";
import { DataTable, StatusPill, type Column } from "./data-table";
import { KpiCard } from "./kpi-card";
import { moneyWriter } from "./overview-text";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { ExportButton, ExportsNeedWrite, TaxStatement } from "./tax-parts";

/**
 * The VAT view of the VAT, OSS and IOSS page (D161, `docs/wave-1c-reports.md` 2.2): VAT per delivery country, rate and basis from the
 * store's invoices and credit notes, the cards over it, a bar chart with its data table behind it, and the reconciliation against
 * Finance and the orders. It draws the report objects it is handed and reads nothing, so it renders on fixture data. A figure that
 * cannot be known (a document with no stored rate) is shown as missing and counted, never as zero.
 *
 * THESE ARE THE OWNER'S OWN FIGURES, FOR THE OWNER'S ACCOUNTANT. They are not a tax return and Kaizen files nothing.
 */

export type TaxViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The first market's locale, for writing amounts. */
  locale: string;
  /** The range, `to` exclusive. */
  range: { from: string; to: string };
  report: VatReport;
  /** The reconciliation of the same range; null when it could not be read (the rest of the page stands). */
  reconciliation: ReconciliationView | null;
  /** The drift sentence when the range was exported and its figures changed since, else null. */
  drift: string | null;
  /** Whether the member may export (`analytics:write`). */
  canExport: boolean;
  /** A fixed sentence the export route sent the person back with. */
  exportProblem: string | null;
  /** The page's words in the account's language; English unless given. */
  words?: TaxReportsMessages;
};

export const basisLabel = (basis: string, w: TaxReportsMessages = taxReportsEn): string => (w.basis as Record<string, string>)[basis] ?? basis;

const rowKey = (r: VatRow): string => [r.country, r.rate, r.basis, r.currency, r.place, r.part ?? "", r.reason].join("|");

/** Whole numbers with thousands separators, the one way every count of this page is written. */
const count = (n: number) => formatCount(n);

/** An amount with the proper minus sign, in a currency of its own (one writer per currency). */
function writers(locale: string) {
  const cache = new Map<string, (minor: number) => string>();
  return (currency: string) => {
    let write = cache.get(currency);
    if (!write) {
      const base = moneyWriter(currency, locale);
      write = (minor: number) => base(minor).replace(/^-/, MINUS);
      cache.set(currency, write);
    }
    return write;
  };
}

export function TaxView({ base, locale, range, report, reconciliation, drift, canExport, exportProblem, words = taxReportsEn }: TaxViewProps) {
  const w = words;
  const v = w.vat;
  const c = v.columns;
  const writer = writers(locale);
  const main = writer(report.mainCurrency);
  const last = addDays(range.to, -1);
  const documents = report.totals.invoices + report.totals.creditNotes;
  const unconverted = report.notConverted.invoices + report.notConverted.creditNotes;
  const undocumented = reconciliation?.undocumented.orders ?? 0;

  const columns: Column<VatRow>[] = [
    { key: "country", label: c.country, cell: (r) => r.country },
    {
      key: "rate",
      label: c.rate,
      align: "right",
      cell: (r) => (
        <>
          {ratePercent(r.rate)} %{r.rateKind === "reduced" && r.rate > 0 ? <span className="ml-1 text-xs text-muted">{c.reduced}</span> : null}
        </>
      ),
    },
    { key: "basis", label: c.basis, cell: (r) => basisLabel(r.basis, w) },
    { key: "currency", label: c.currency, cell: (r) => r.currency },
    { key: "net", label: c.net, align: "right", cell: (r) => writer(r.currency)(r.netMinor) },
    { key: "vat", label: c.vat, align: "right", cell: (r) => writer(r.currency)(r.vatMinor) },
    { key: "gross", label: c.gross, align: "right", cell: (r) => writer(r.currency)(r.grossMinor) },
    { key: "invoices", label: c.invoices, align: "right", cell: (r) => count(r.invoices) },
    { key: "orders", label: c.orders, align: "right", cell: (r) => count(r.orders) },
    { key: "credits", label: c.creditNotes, align: "right", cell: (r) => count(r.creditNotes) },
    { key: "credited", label: c.credited, align: "right", cell: (r) => (r.creditVatMinor === 0 ? NO_FIGURE : writer(r.currency)(-r.creditVatMinor)) },
    { key: "after", label: c.after, align: "right", cell: (r) => writer(r.currency)(r.vatAfterMinor) },
    {
      key: "main",
      label: fillWords(c.inMain, { currency: report.mainCurrency }),
      align: "right",
      cell: (r) =>
        r.vatAfterMainMinor === null ? (
          <>
            <span aria-hidden="true">{NO_FIGURE}</span>
            <span className="sr-only">{c.noStoredRate}</span>
          </>
        ) : (
          main(r.vatAfterMainMinor)
        ),
    },
    { key: "reported", label: c.reportedIn, cell: (r) => <span title={reasonWords(r.reason, w)}>{w === taxReportsEn ? r.reportedIn : placeText(r, w)}</span> },
  ];

  const bars: BarRow[] = report.byCountry
    .filter((c) => c.vatAfterMainMinor !== 0)
    .map((c, i) => ({ key: c.country, label: c.country, value: c.vatAfterMainMinor, valueText: main(c.vatAfterMainMinor), colorIndex: i }));

  const chartColumns: Column<(typeof report.byCountry)[number]>[] = [
    { key: "country", label: c.country, cell: (row) => row.country },
    { key: "vat", label: fillWords(v.chartVat, { currency: report.mainCurrency }), align: "right", cell: (row) => main(row.vatAfterMainMinor) },
    { key: "net", label: fillWords(v.chartNet, { currency: report.mainCurrency }), align: "right", cell: (row) => main(row.netAfterMainMinor) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <TaxStatement words={w} />
      {exportProblem ? <Note tone="warning" title={w.parts.noFile}>{exportProblem}</Note> : null}
      <p className="text-sm text-muted">
        {fillWords(v.madeFrom, {
          invoices: countWords(report.totals.invoices, v.invoices, { n: count(report.totals.invoices) }),
          creditNotes: countWords(report.totals.creditNotes, v.creditNotes, { n: count(report.totals.creditNotes) }),
        })}
        {undocumented > 0 ? (
          <>
            {` ${countWords(undocumented, v.undocumented, { n: count(undocumented) })}`}
            <Link href={`${base}/invoices?tab=waiting`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              {v.openWaiting}
            </Link>
          </>
        ) : null}
      </p>

      <AnalyticsSection id="vat-cards" title={v.cardsTitle} description={fillWords(v.cardsDescription, { currency: report.mainCurrency })}>
        {documents === 0 ? (
          <div className="rounded-panel border border-dashed border-line px-4 py-6 text-sm text-muted">
            <p>{v.nothing}</p>
            <p className="mt-1">
              {v.invoicingOff}{" "}
              <Link href={`${base}/settings/invoices`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                {v.settingsInvoices}
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label={v.kpi.charged} value={main(report.totals.vatChargedMainMinor)} help={v.kpi.chargedHelp} />
            <KpiCard label={v.kpi.credited} value={main(0 - report.totals.vatCreditedMainMinor)} help={v.kpi.creditedHelp} />
            <KpiCard label={v.kpi.after} value={main(report.totals.vatAfterMainMinor)} emphasis help={v.kpi.afterHelp} />
            <KpiCard label={v.kpi.net} value={main(report.totals.netAfterMainMinor)} help={v.kpi.netHelp} />
            <KpiCard label={v.kpi.invoices} value={count(report.totals.invoices)} hint={countWords(report.totals.orders, v.orders, { n: count(report.totals.orders) })} />
            <KpiCard label={v.kpi.creditNotes} value={count(report.totals.creditNotes)} />
          </div>
        )}
        {unconverted > 0 ? (
          <Note tone="warning" title={countWords(unconverted, v.unconvertedTitle, { n: count(unconverted) })}>
            {countWords(unconverted, v.unconverted, { currency: report.mainCurrency, currencies: report.notConverted.currencies.join(", ") })}
          </Note>
        ) : null}
        {report.flagCounts.dispatch_assumed > 0 ? (
          <Note>
            {countWords(report.flagCounts.dispatch_assumed, v.dispatchAssumed, { n: count(report.flagCounts.dispatch_assumed) })}
          </Note>
        ) : null}
        {report.flagCounts.seller_assumed > 0 ? (
          <Note>
            {countWords(report.flagCounts.seller_assumed, v.sellerAssumed, { n: count(report.flagCounts.seller_assumed) })}
          </Note>
        ) : null}
        {report.flagCounts.mixed_goods_download > 0 ? (
          <Note>{countWords(report.flagCounts.mixed_goods_download, v.mixed, { n: count(report.flagCounts.mixed_goods_download) })}</Note>
        ) : null}
      </AnalyticsSection>

      <AnalyticsSection
        id="vat-table"
        title={v.tableTitle}
        description={v.tableDescription}
        action={
          canExport ? (
            <ExportButton base={base} kind="vat" fields={{ from: range.from, last }}>
              {v.exportVat}
            </ExportButton>
          ) : null
        }
      >
        <DataTable caption={v.tableCaption} columns={columns} rows={report.rows} rowKey={rowKey} empty={v.tableEmpty} exportable={false} exportReason="tax.vat" />
        {!canExport ? <ExportsNeedWrite words={w} /> : null}
        {drift ? <Note tone="warning" title={w.parts.changedSinceExport}>{drift}</Note> : null}
      </AnalyticsSection>

      <AnalyticsSection id="vat-chart" title={v.chartSection} description={fillWords(v.chartDescription, { currency: report.mainCurrency })}>
        <ChartCard title={v.chartTitle}>
          <HorizontalBars label={v.chartTitle} rows={bars} emptyText={v.tableEmpty} exportable={false} exportReason="tax.vat_chart" />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted">{v.chartData}</summary>
            <div className="mt-2">
              <DataTable caption={v.chartTitle} columns={chartColumns} rows={report.byCountry} rowKey={(row) => row.country} empty={v.chartEmpty} exportable={false} exportReason="tax.vat_chart" />
            </div>
          </details>
        </ChartCard>
      </AnalyticsSection>

      {reconciliation ? (
        <ReconciliationPanel view={reconciliation} base={base} locale={locale} range={range} last={last} canExport={canExport} words={w} />
      ) : (
        <AnalyticsSection id="vat-reconciliation" title={w.recon.title}>
          <Note tone="warning" title={v.reconUnreadable}>
            {v.reconUnreadableText}
          </Note>
        </AnalyticsSection>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

/** `+` before a line that adds to Finance's figure on the way to the report's, a minus before one that takes away. */
const SIGN_MARK: Record<-1 | 0 | 1, string> = { [-1]: MINUS, 0: "", 1: "+" };

function BridgeTable({ caption, lines, money, main, w }: { caption: string; lines: readonly ReconLine[]; money: (minor: number) => string; main: boolean; w: TaxReportsMessages }) {
  const said = (l: ReconLine) => (w === taxReportsEn ? { label: l.label, text: l.text } : lineWords(l, main, w));
  const columns: Column<ReconLine>[] = [
    {
      key: "line",
      label: w.recon.line,
      cell: (l) => (
        <span className={l.kind === "finance" || l.kind === "report" ? "font-medium" : ""} title={said(l).text}>
          {l.sign !== 0 ? <span className="mr-1 tabular-nums text-muted">{SIGN_MARK[l.sign]}</span> : null}
          {said(l).label}
        </span>
      ),
    },
    { key: "orders", label: w.recon.orders, align: "right", cell: (l) => (l.kind === "rounding" || l.kind === "exchange_rate" ? NO_FIGURE : count(l.orders)) },
    { key: "vat", label: w.recon.vat, align: "right", cell: (l) => money(l.taxMinor) },
  ];
  return <DataTable caption={caption} columns={columns} rows={lines} rowKey={(l, i) => `${l.kind}-${l.cause ?? ""}-${i}`} exportable={false} exportReason="tax.reconciliation" />;
}

function CurrencyBridgeCard({ bridge, money, w }: { bridge: CurrencyBridge; money: (minor: number) => string; w: TaxReportsMessages }) {
  const r = w.recon;
  return (
    <ChartCard
      title={fillWords(r.currencyTitle, { currency: bridge.currency })}
      action={bridge.balanced ? null : <StatusPill tone="bad">{r.notReconciled}</StatusPill>}
      description={r.currencyDescription}
    >
      <BridgeTable caption={fillWords(r.caption, { currency: bridge.currency })} lines={bridge.lines} money={money} main={false} w={w} />
      {!bridge.balanced ? <p className="mt-2 text-xs text-(--chart-bad)">{fillWords(r.difference, { amount: money(bridge.differenceMinor) })}</p> : null}
    </ChartCard>
  );
}

function MainBridgeCard({ bridge, money, w }: { bridge: MainBridge; money: (minor: number) => string; w: TaxReportsMessages }) {
  const r = w.recon;
  return (
    <ChartCard title={fillWords(r.mainTitle, { currency: bridge.currency })} description={r.mainDescription}>
      <BridgeTable caption={fillWords(r.caption, { currency: bridge.currency })} lines={bridge.lines} money={money} main w={w} />
      {bridge.notConverted.length > 0 ? (
        <p className="mt-2 text-xs text-muted">{fillWords(r.leftOut, { currencies: bridge.notConverted.join(", ") })}</p>
      ) : null}
    </ChartCard>
  );
}

export function ReconciliationPanel({
  view,
  base,
  locale,
  range,
  last,
  canExport,
  words = taxReportsEn,
}: {
  view: ReconciliationView;
  base: string;
  locale: string;
  range: { from: string; to: string };
  last: string;
  canExport: boolean;
  words?: TaxReportsMessages;
}) {
  const w = words;
  const r = w.recon;
  const writer = writers(locale);
  const key = rangeKey(range.from, range.to);
  const waiting = view.undocumented.byCause.waiting ?? 0;
  return (
    <AnalyticsSection
      id="vat-reconciliation"
      title={r.title}
      description={r.description}
      action={
        canExport ? (
          <ExportButton base={base} kind="reconciliation" fields={{ from: range.from, last }}>
            {r.export}
          </ExportButton>
        ) : null
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {view.bridges.map((b) => (
          <CurrencyBridgeCard key={b.currency} bridge={b} money={writer(b.currency)} w={w} />
        ))}
        <MainBridgeCard bridge={view.main} money={writer(view.main.currency)} w={w} />
      </div>
      {view.bridges.length === 0 ? <p className="text-sm text-muted">{fillWords(r.nothing, { period: key })}</p> : null}
      <p role="status" className={`text-sm font-medium ${view.balanced ? "" : "text-(--chart-bad)"}`}>
        {w === taxReportsEn ? view.sentence : view.balanced ? r.equal : r.notReconciled}
      </p>
      {view.undocumented.orders > 0 ? (
        <p className="text-sm text-muted">
          {countWords(view.undocumented.orders, r.noInvoice, { n: count(view.undocumented.orders) })}
          {waiting > 0 ? (
            <>
              {countWords(waiting, r.waiting, { n: count(waiting) })}
              <Link href={`${base}/invoices?tab=waiting`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                {r.openWaiting}
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
      {view.refunds.length > 0 ? (
        <div className="space-y-1 rounded-panel bg-sunken p-4 text-sm">
          <p className="font-medium">{r.refundsTitle}</p>
          {view.refunds.map((line) => (
            <p key={line.currency} className="text-muted">
              {fillWords(r.refundsLine, {
                currency: line.currency,
                finance: writer(line.currency)(line.financeMinor),
                credits: writer(line.currency)(line.creditNotesMinor),
                refunds: countWords(line.refunds, r.refunds, { n: count(line.refunds) }),
                text: w === taxReportsEn ? line.text : line.withinRounding ? r.refundsAgree : r.refundsDiffer,
              })}
            </p>
          ))}
        </div>
      ) : null}
    </AnalyticsSection>
  );
}
