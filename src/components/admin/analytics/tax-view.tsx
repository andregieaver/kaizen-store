import Link from "next/link";

import { formatCount, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import { addDays } from "@/lib/analytics-period";
import { rangeKey } from "@/lib/tax-periods";
import type { CurrencyBridge, MainBridge, ReconLine } from "@/lib/tax-reconciliation";
import { ratePercent, type VatReport, type VatRow } from "@/lib/tax-report";
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
};

const BASIS_LABEL: Record<string, string> = { standard: "Standard", reverse_charge: "Reverse charge", exempt: "Exempt", ioss: "IOSS" };
export const basisLabel = (basis: string): string => BASIS_LABEL[basis] ?? basis;

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

export function TaxView({ base, locale, range, report, reconciliation, drift, canExport, exportProblem }: TaxViewProps) {
  const writer = writers(locale);
  const main = writer(report.mainCurrency);
  const last = addDays(range.to, -1);
  const documents = report.totals.invoices + report.totals.creditNotes;
  const unconverted = report.notConverted.invoices + report.notConverted.creditNotes;
  const undocumented = reconciliation?.undocumented.orders ?? 0;

  const columns: Column<VatRow>[] = [
    { key: "country", label: "Country", cell: (r) => r.country },
    {
      key: "rate",
      label: "Rate",
      align: "right",
      cell: (r) => (
        <>
          {ratePercent(r.rate)} %{r.rateKind === "reduced" && r.rate > 0 ? <span className="ml-1 text-xs text-muted">reduced</span> : null}
        </>
      ),
    },
    { key: "basis", label: "Basis", cell: (r) => basisLabel(r.basis) },
    { key: "currency", label: "Currency", cell: (r) => r.currency },
    { key: "net", label: "Net", align: "right", cell: (r) => writer(r.currency)(r.netMinor) },
    { key: "vat", label: "VAT", align: "right", cell: (r) => writer(r.currency)(r.vatMinor) },
    { key: "gross", label: "Gross", align: "right", cell: (r) => writer(r.currency)(r.grossMinor) },
    { key: "invoices", label: "Invoices", align: "right", cell: (r) => count(r.invoices) },
    { key: "orders", label: "Orders", align: "right", cell: (r) => count(r.orders) },
    { key: "credits", label: "Credit notes", align: "right", cell: (r) => count(r.creditNotes) },
    { key: "credited", label: "VAT credited", align: "right", cell: (r) => (r.creditVatMinor === 0 ? NO_FIGURE : writer(r.currency)(-r.creditVatMinor)) },
    { key: "after", label: "VAT after credits", align: "right", cell: (r) => writer(r.currency)(r.vatAfterMinor) },
    {
      key: "main",
      label: `In ${report.mainCurrency}`,
      align: "right",
      cell: (r) =>
        r.vatAfterMainMinor === null ? (
          <>
            <span aria-hidden="true">{NO_FIGURE}</span>
            <span className="sr-only">No rate was stored for this currency</span>
          </>
        ) : (
          main(r.vatAfterMainMinor)
        ),
    },
    { key: "reported", label: "Reported in", cell: (r) => <span title={r.reason}>{r.reportedIn}</span> },
  ];

  const bars: BarRow[] = report.byCountry
    .filter((c) => c.vatAfterMainMinor !== 0)
    .map((c, i) => ({ key: c.country, label: c.country, value: c.vatAfterMainMinor, valueText: main(c.vatAfterMainMinor), colorIndex: i }));

  const chartColumns: Column<(typeof report.byCountry)[number]>[] = [
    { key: "country", label: "Country", cell: (c) => c.country },
    { key: "vat", label: `VAT after credits (${report.mainCurrency})`, align: "right", cell: (c) => main(c.vatAfterMainMinor) },
    { key: "net", label: `Net sales after credits (${report.mainCurrency})`, align: "right", cell: (c) => main(c.netAfterMainMinor) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <TaxStatement />
      {exportProblem ? <Note tone="warning" title="No file was made">{exportProblem}</Note> : null}
      <p className="text-sm text-muted">
        {`Made from ${count(report.totals.invoices)} ${report.totals.invoices === 1 ? "invoice" : "invoices"} and ${count(report.totals.creditNotes)} ${report.totals.creditNotes === 1 ? "credit note" : "credit notes"}.`}
        {undocumented > 0 ? (
          <>
            {` ${count(undocumented)} paid ${undocumented === 1 ? "order" : "orders"} in this period ${undocumented === 1 ? "has" : "have"} no document and ${undocumented === 1 ? "is" : "are"} not included (see Reconciliation). `}
            <Link href={`${base}/invoices?tab=waiting`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              Open Invoices, Waiting
            </Link>
          </>
        ) : null}
      </p>

      <AnalyticsSection id="vat-cards" title="VAT in the period" description={`In ${report.mainCurrency}, each document at the rate stored on it when it was issued. Credit notes are counted in the period they are issued.`}>
        {documents === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted">
            <p>No invoice or credit note is dated in this period, so there is nothing to report.</p>
            <p className="mt-1">
              Reports are made from your invoices. If invoicing is off, switch it on under{" "}
              <Link href={`${base}/settings/invoices`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                Settings, Invoices
              </Link>
              .
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label="VAT charged" value={main(report.totals.vatChargedMainMinor)} help="VAT of the invoices dated in the period." />
            <KpiCard label="VAT credited" value={main(0 - report.totals.vatCreditedMainMinor)} help="VAT of the credit notes dated in the period, as a minus amount." />
            <KpiCard label="VAT after credits" value={main(report.totals.vatAfterMainMinor)} emphasis help="VAT charged less VAT credited." />
            <KpiCard label="Net sales after credits" value={main(report.totals.netAfterMainMinor)} help="Sales without VAT, less credit notes." />
            <KpiCard label="Invoices" value={count(report.totals.invoices)} hint={`${count(report.totals.orders)} ${report.totals.orders === 1 ? "order" : "orders"}`} />
            <KpiCard label="Credit notes" value={count(report.totals.creditNotes)} />
          </div>
        )}
        {unconverted > 0 ? (
          <Note tone="warning" title={`${count(unconverted)} ${unconverted === 1 ? "document is" : "documents are"} not in these figures`}>
            No exchange rate to {report.mainCurrency} was stored on {unconverted === 1 ? "it" : "them"} ({report.notConverted.currencies.join(", ")}). They are in the table and the file in their own currency, and are never converted at today&apos;s rate.
          </Note>
        ) : null}
        {report.flagCounts.dispatch_assumed > 0 ? (
          <Note>
            {`${count(report.flagCounts.dispatch_assumed)} ${report.flagCounts.dispatch_assumed === 1 ? "document was" : "documents were"} classed with the dispatch country in your tax profile now, because the order did not record where it was sent from.`}
          </Note>
        ) : null}
        {report.flagCounts.seller_assumed > 0 ? (
          <Note>
            {`${count(report.flagCounts.seller_assumed)} ${report.flagCounts.seller_assumed === 1 ? "document was" : "documents were"} classed with the country and the OSS member state in your tax profile now, because the order did not record them when it was placed. Orders placed from now on keep them, so a later change to your profile moves nothing.`}
          </Note>
        ) : null}
        {report.flagCounts.mixed_goods_download > 0 ? (
          <Note>{`${count(report.flagCounts.mixed_goods_download)} ${report.flagCounts.mixed_goods_download === 1 ? "order has" : "orders have"} both goods and downloads. They are classed by their goods. Ask your accountant if that fits.`}</Note>
        ) : null}
      </AnalyticsSection>

      <AnalyticsSection
        id="vat-table"
        title="VAT by country and rate"
        description="One row for each delivery country, rate, basis and currency of the documents, with where that VAT is reported. Shipping is in the rate it was charged at. Amounts are in the document's own currency."
        action={
          canExport ? (
            <ExportButton base={base} kind="vat" fields={{ from: range.from, last }}>
              Export VAT by country and rate (CSV)
            </ExportButton>
          ) : null
        }
      >
        <DataTable caption="VAT by country, rate and basis" columns={columns} rows={report.rows} rowKey={rowKey} empty="No VAT to show for this period." />
        {!canExport ? <ExportsNeedWrite /> : null}
        {drift ? <Note tone="warning" title="This period has changed since you exported it">{drift}</Note> : null}
      </AnalyticsSection>

      <AnalyticsSection id="vat-chart" title="VAT by country" description={`VAT after credits in ${report.mainCurrency}. The table under it holds the same figures.`}>
        <ChartCard title="VAT after credits per country">
          <HorizontalBars label="VAT after credits per country" rows={bars} emptyText="No VAT to show for this period." />
          <details className="mt-3 text-sm">
            <summary className="cursor-pointer text-muted">Data behind the chart</summary>
            <div className="mt-2">
              <DataTable caption="VAT after credits per country" columns={chartColumns} rows={report.byCountry} rowKey={(c) => c.country} empty="No data for this period." />
            </div>
          </details>
        </ChartCard>
      </AnalyticsSection>

      {reconciliation ? (
        <ReconciliationPanel view={reconciliation} base={base} locale={locale} range={range} last={last} canExport={canExport} />
      ) : (
        <AnalyticsSection id="vat-reconciliation" title="Reconciliation">
          <Note tone="warning" title="The reconciliation could not be read">
            The VAT report above stands on its own. Reload the page to try the reconciliation again.
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

function BridgeTable({ caption, lines, money }: { caption: string; lines: readonly ReconLine[]; money: (minor: number) => string }) {
  const columns: Column<ReconLine>[] = [
    {
      key: "line",
      label: "Line",
      cell: (l) => (
        <span className={l.kind === "finance" || l.kind === "report" ? "font-semibold" : ""} title={l.text}>
          {l.sign !== 0 ? <span className="mr-1 tabular-nums text-muted">{SIGN_MARK[l.sign]}</span> : null}
          {l.label}
        </span>
      ),
    },
    { key: "orders", label: "Orders", align: "right", cell: (l) => (l.kind === "rounding" || l.kind === "exchange_rate" ? NO_FIGURE : count(l.orders)) },
    { key: "vat", label: "VAT", align: "right", cell: (l) => money(l.taxMinor) },
  ];
  return <DataTable caption={caption} columns={columns} rows={lines} rowKey={(l, i) => `${l.kind}-${l.cause ?? ""}-${i}`} />;
}

function CurrencyBridgeCard({ bridge, money }: { bridge: CurrencyBridge; money: (minor: number) => string }) {
  return (
    <ChartCard
      title={`${bridge.currency}, in the document currency`}
      action={bridge.balanced ? null : <StatusPill tone="bad">Does not reconcile</StatusPill>}
      description="From Finance's VAT to this report's VAT charged, in whole minor units with no conversion."
    >
      <BridgeTable caption={`Reconciliation in ${bridge.currency}`} lines={bridge.lines} money={money} />
      {!bridge.balanced ? <p className="mt-2 text-xs text-(--chart-bad)">{`Difference not named: ${money(bridge.differenceMinor)}.`}</p> : null}
    </ChartCard>
  );
}

function MainBridgeCard({ bridge, money }: { bridge: MainBridge; money: (minor: number) => string }) {
  return (
    <ChartCard
      title={`${bridge.currency}, your main currency`}
      description="Finance converts at today's rates and this report at the rate stored on each document, so two named lines close the gap."
    >
      <BridgeTable caption={`Reconciliation in ${bridge.currency}`} lines={bridge.lines} money={money} />
      {bridge.notConverted.length > 0 ? (
        <p className="mt-2 text-xs text-muted">{`Left out of this bridge, with no rate today: ${bridge.notConverted.join(", ")}. Their bridges above are exact.`}</p>
      ) : null}
    </ChartCard>
  );
}

export function ReconciliationPanel({ view, base, locale, range, last, canExport }: { view: ReconciliationView; base: string; locale: string; range: { from: string; to: string }; last: string; canExport: boolean }) {
  const writer = writers(locale);
  const key = rangeKey(range.from, range.to);
  const waiting = view.undocumented.byCause.waiting ?? 0;
  return (
    <AnalyticsSection
      id="vat-reconciliation"
      title="Reconciliation"
      description="How this report agrees with Finance and your orders. Finance counts an order on the day it was placed; an invoice is dated by the day of payment. Every difference is named."
      action={
        canExport ? (
          <ExportButton base={base} kind="reconciliation" fields={{ from: range.from, last }}>
            Export reconciliation (CSV)
          </ExportButton>
        ) : null
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        {view.bridges.map((b) => (
          <CurrencyBridgeCard key={b.currency} bridge={b} money={writer(b.currency)} />
        ))}
        <MainBridgeCard bridge={view.main} money={writer(view.main.currency)} />
      </div>
      {view.bridges.length === 0 ? <p className="text-sm text-muted">{`No paid orders or invoices in ${key}.`}</p> : null}
      <p role="status" className={`text-sm font-medium ${view.balanced ? "" : "text-(--chart-bad)"}`}>
        {view.sentence}
      </p>
      {view.undocumented.orders > 0 ? (
        <p className="text-sm text-muted">
          {`${count(view.undocumented.orders)} paid ${view.undocumented.orders === 1 ? "order has" : "orders have"} no invoice, so ${view.undocumented.orders === 1 ? "its" : "their"} VAT is in Finance only.`}
          {waiting > 0 ? (
            <>
              {` ${count(waiting)} ${waiting === 1 ? "is" : "are"} waiting for an invoice: `}
              <Link href={`${base}/invoices?tab=waiting`} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                open Invoices, Waiting
              </Link>
              .
            </>
          ) : null}
        </p>
      ) : null}
      {view.refunds.length > 0 ? (
        <div className="space-y-1 rounded-lg border border-border bg-surface p-4 text-sm">
          <p className="font-medium">Refunds against credit notes (for information)</p>
          {view.refunds.map((r) => (
            <p key={r.currency} className="text-muted">
              {`${r.currency}: Finance's refunds without VAT ${writer(r.currency)(r.financeMinor)}, credit notes without VAT ${writer(r.currency)(r.creditNotesMinor)} (${count(r.refunds)} ${r.refunds === 1 ? "refund" : "refunds"}). ${r.text}`}
            </p>
          ))}
        </div>
      ) : null}
    </AnalyticsSection>
  );
}
