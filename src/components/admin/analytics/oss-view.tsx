import Link from "next/link";
import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { countWords, fillWords } from "@/lib/admin-fill";
import { taxReportsEn, type TaxReportsMessages } from "@/lib/admin-messages/tax-reports.en";
import { formatCount, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import type { ConversionGroup, Part2Line, RateCard, ReturnMode, ReturnScheme } from "@/lib/oss-return";
import { taxHref } from "@/lib/tax-admin";
import type { ReturnPart } from "@/lib/tax-classes";
import { deadlineText, longDateIn, noteWords, periodText, reasonWords } from "@/lib/tax-report-words";
import { ratePercent } from "@/lib/tax-report";
import type { ReturnView } from "@/server/tax-reports";

import { DataTable, StatusPill, type Column } from "./data-table";
import { KpiCard } from "./kpi-card";
import { moneyWriter } from "./overview-text";
import { AnalyticsSection, ChartCard, Note } from "./section";
import { ExportButton, ExportsNeedWrite, TaxStatement } from "./tax-parts";

/**
 * The OSS (quarterly) and IOSS (monthly) views of the VAT, OSS and IOSS page (D161, `docs/wave-1c-reports.md` 2.2 and 4.3 to 4.6): the
 * parts of a return in the order of the return's layout, in euro at the ECB's rate of the period's last day, the rates and where each
 * came from, what is left out of the return and why, the registration against the sales, the deadline and the exports. It draws the
 * view it is handed and reads nothing, so it renders on fixture data. A euro figure with no rate behind it is shown as missing,
 * never as zero, and the return data is not offered as a file until it is whole.
 *
 * THESE ARE THE OWNER'S OWN FIGURES, FOR THE OWNER'S ACCOUNTANT. They are not a tax return and Kaizen files nothing. Needs review: accountant.
 */

type FormAction = (state: FormState, form: FormData) => Promise<FormState>;

/** The server actions of the euro rates, bound to the store; only an owner is offered them. */
export type RateActions = { fetch: FormAction; override: FormAction };

export type OssViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  locale: string;
  scheme: ReturnScheme;
  mode: ReturnMode;
  view: ReturnView;
  /** The periods the picker offers, newest first, and the one shown. */
  periods: readonly { key: string; label: string }[];
  /** Whether the member may export (`analytics:write`). */
  canExport: boolean;
  /** Whether the member is an owner: only an owner fetches or enters a rate. */
  isOwner: boolean;
  /** The drift sentence when this period's return data was exported and its figures changed since, else null. */
  drift: string | null;
  /** When the return data of this period and mode was last exported (ISO), else null. */
  lastExportedAt: string | null;
  /** A fixed sentence the export route sent the person back with. */
  exportProblem: string | null;
  /** The rate forms' actions; null for a member who is not an owner. */
  actions: RateActions | null;
  /** The page's words in the account's language; English unless given. */
  words?: TaxReportsMessages;
};

/** What the page says under every goods table: the dispatch state's own VAT number is the owner's to enter, nothing here holds it. */
export const DISPATCH_NOTE = taxReportsEn.oss.dispatchNote;

export const PART_LABEL: Record<ReturnPart, string> = taxReportsEn.oss.parts;

const PART_ORDER: ReturnPart[] = ["2a", "2b", "2d", "NU", "IOSS"];

const field = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

export function OssView({ base, locale, scheme, mode, view, periods, canExport, isOwner, drift, lastExportedAt, exportProblem, actions, words = taxReportsEn }: OssViewProps) {
  const w = words;
  const o = w.oss;
  const { data } = view;
  const eurWrite = moneyWriter("EUR", locale);
  const eur = (minor: number | null): ReactNode =>
    minor === null ? (
      <>
        <span aria-hidden="true">{NO_FIGURE}</span>
        <span className="sr-only">{o.noEuroRate}</span>
      </>
    ) : (
      eurWrite(minor).replace(/^-/, MINUS)
    );
  const eurText = (minor: number | null): string => (minor === null ? NO_FIGURE : eurWrite(minor).replace(/^-/, MINUS));
  const word = scheme === "oss" ? "OSS" : "IOSS";
  const stateOff = scheme === "ioss" && view.state === "off";
  const label = periodText(data.period, w);
  const sellerEmpty = data.registration === "none" && scheme === "oss";
  const exportFields = { period: data.period.key, mode };
  const settingsTax = `${base}/settings/tax`;
  const href = (nextMode: ReturnMode) => taxHref(base, { view: scheme, quarter: data.period.key, month: data.period.key, mode: nextMode });

  const parts = PART_ORDER.filter((p) => data.part2.some((l) => l.part === p));
  const lineColumns: Column<Part2Line>[] = [
    { key: "ms", label: o.columns.consumption, cell: (l) => l.memberState },
    { key: "dispatch", label: o.columns.dispatch, cell: (l) => l.dispatchState ?? "–" },
    { key: "rate", label: o.columns.rate, align: "right", cell: (l) => `${ratePercent(l.rate)} %` },
    { key: "kind", label: o.columns.rateKind, cell: (l) => (l.rateKind === "standard" ? o.columns.standard : o.columns.reduced) },
    { key: "taxable", label: o.columns.taxable, align: "right", cell: (l) => eur(l.taxableEur) },
    { key: "vat", label: o.columns.vat, align: "right", cell: (l) => eur(l.vatEur) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <TaxStatement words={w} />
      {exportProblem ? (
        <Note tone="warning" title={w.parts.noFile}>
          {exportProblem}
        </Note>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <form method="get" action={`${base}/analytics/tax`} className="flex flex-wrap items-end gap-2" aria-label={scheme === "oss" ? o.quarter : o.month}>
          <input type="hidden" name="view" value={scheme} />
          {mode === "books" ? <input type="hidden" name="mode" value="books" /> : null}
          <label className="flex flex-col gap-0.5 text-xs text-muted">
            {scheme === "oss" ? o.quarter : o.month}
            <select name={scheme === "oss" ? "quarter" : "month"} defaultValue={data.period.key} className="h-9 rounded-panel border border-line bg-card px-2 text-sm">
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-panel border border-line px-3 text-sm font-medium">
            {o.show}
          </button>
        </form>
        <nav aria-label={o.modeLabel} className="flex gap-1">
          {(["filing", "books"] as const).map((m) => (
            <Link
              key={m}
              href={href(m)}
              aria-current={m === mode ? "true" : undefined}
              className={`inline-flex h-9 items-center rounded-panel border px-3 text-sm ${m === mode ? "border-brand bg-sunken font-medium" : "border-line"}`}
            >
              {m === "filing" ? o.filing : o.books}
            </Link>
          ))}
        </nav>
      </div>
      <p className="-mt-4 max-w-3xl text-sm text-muted">{o.modeText[mode]}</p>

      <p role="status" className="text-sm">
        {w === taxReportsEn ? view.deadline.sentence : deadlineText(data.period, view.today, w)}
        {view.deadline.state === "due_soon" || view.deadline.state === "passed" ? <span className="ml-2 align-middle"><StatusPill tone={view.deadline.state === "passed" ? "warning" : "info"}>{view.deadline.state === "passed" ? o.deadlinePassed : o.dueSoon}</StatusPill></span> : null}
      </p>

      {scheme === "ioss" && view.state !== "on" ? (
        <Note tone={stateOff ? "info" : "warning"} title={stateOff ? o.iossOffTitle : o.iossNoNumberTitle}>
          {stateOff ? (
            <p>
              {o.iossOff}{" "}
              <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                {o.openSettingsTax}
              </Link>
            </p>
          ) : (
            <p>
              {o.iossNoNumber}{" "}
              <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                {o.openSettingsTax}
              </Link>
            </p>
          )}
        </Note>
      ) : null}
      {scheme === "ioss" && view.profile.iossIntermediary ? (
        <Note title={o.intermediaryTitle}>{fillWords(o.intermediary, { name: view.profile.iossIntermediary })}</Note>
      ) : null}
      {sellerEmpty ? (
        <Note tone="warning" title={o.noRegistrationTitle}>
          <p>
            {o.noRegistration}{" "}
            <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              {o.openSettingsTax}
            </Link>
          </p>
        </Note>
      ) : null}
      {data.notes.map((n) => (
        <Note key={n.code} tone="warning" title={o.notesTitle}>
          {noteWords(n, w)}
        </Note>
      ))}

      {stateOff ? null : (
        <>
          {data.incomplete ? (
            <Note tone="warning" title={o.incompleteTitle}>
              <p>
                {fillWords(o.incomplete, { missing: data.missing.map((m) => fillWords(o.missingOn, { currency: m.currency, day: longDateIn(m.day, w) })).join(", ") })}
                {data.missing.some((m) => m.day >= view.today) ? o.ecbPublishes : ""}
                {isOwner ? o.ownerFetch : o.staffFetch}
              </p>
            </Note>
          ) : null}

          <AnalyticsSection
            id="return-part2"
            title={fillWords(o.part2Title, { scheme: word, period: label })}
            description={fillWords(o.part2Description, {
              invoices: countWords(data.totals.documents, w.vat.invoices),
              creditNotes: countWords(data.totals.creditNotes, w.vat.creditNotes),
            })}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard label={o.kpiTaxable} value={data.totals.taxableEur === null ? null : eurText(data.totals.taxableEur)} state={data.totals.taxableEur === null ? "missing" : "ok"} missing={{ text: o.rateMissing }} />
              <KpiCard label={o.kpiVat} value={data.totals.vatEur === null ? null : eurText(data.totals.vatEur)} state={data.totals.vatEur === null ? "missing" : "ok"} missing={{ text: o.rateMissing }} />
              <KpiCard label={o.kpiDue} value={data.part5Eur === null ? null : eurText(data.part5Eur)} emphasis state={data.part5Eur === null ? "missing" : "ok"} missing={{ text: o.rateMissing }} help={o.kpiDueHelp} />
            </div>
            {parts.length === 0 ? (
              <div className="rounded-panel border border-dashed border-line px-4 py-6 text-sm text-muted">{fillWords(o.nothingPart2, { period: label })}</div>
            ) : (
              parts.map((p) => (
                <ChartCard key={p} title={o.parts[p]}>
                  <DataTable
                    caption={o.parts[p]}
                    columns={p === "2b" || p === "2d" ? lineColumns : lineColumns.filter((c) => c.key !== "dispatch")}
                    rows={data.part2.filter((l) => l.part === p)}
                    rowKey={(l) => `${l.part}|${l.memberState}|${l.dispatchState ?? ""}|${l.rate}`}
                    exportable={false}
                    exportReason="oss.part2"
                  />
                  {p === "2b" || p === "2d" ? <p className="mt-2 text-xs text-muted">{o.dispatchNote}</p> : null}
                </ChartCard>
              ))
            )}
          </AnalyticsSection>

          <AnalyticsSection id="return-part3" title={o.part3Title} description={o.part3Description}>
            {mode === "books" ? (
              <p className="text-sm text-muted">{o.part3Books}</p>
            ) : (
              <DataTable
                caption={o.part3Caption}
                columns={[
                  { key: "period", label: o.periodCorrected, cell: (l) => l.correctionPeriod },
                  { key: "ms", label: o.columns.consumption, cell: (l) => l.memberState },
                  { key: "vat", label: o.columns.vat, align: "right", cell: (l) => eur(l.vatEur) },
                  { key: "late", label: o.note, cell: (l) => (l.late ? o.tooLate : NO_FIGURE) },
                ]}
                rows={data.part3}
                rowKey={(l) => `${l.correctionPeriod}|${l.memberState}`}
                empty={fillWords(o.part3Empty, { period: label })}
                exportable={false}
                exportReason="oss.part3"
              />
            )}
          </AnalyticsSection>

          <AnalyticsSection id="return-part4" title={o.part4Title} description={o.part4Description}>
            <DataTable
              caption={o.part4Caption}
              columns={[
                { key: "ms", label: o.columns.consumption, cell: (b) => b.memberState },
                { key: "p2", label: o.part2Vat, align: "right", cell: (b) => eur(b.part2VatEur) },
                { key: "p3", label: o.part3Vat, align: "right", cell: (b) => eur(b.part3VatEur) },
                { key: "bal", label: o.balance, align: "right", cell: (b) => eur(b.balanceEur) },
                { key: "note", label: o.note, cell: (b) => (b.reimbursed ? o.reimbursed : NO_FIGURE) },
              ]}
              rows={data.part4}
              rowKey={(b) => b.memberState}
              empty={fillWords(o.part4Empty, { period: label })}
              exportable={false}
              exportReason="oss.part4"
            />
          </AnalyticsSection>

          <AnalyticsSection
            id="return-rates"
            title={o.ratesTitle}
            description={o.ratesDescription}
          >
            <RatesTable rates={data.rates} actions={isOwner ? actions : null} w={w} />
            {!isOwner ? <p className="text-sm text-muted">{o.ownerOnly}</p> : null}
            <ConversionGroups groups={data.groups} eur={eur} locale={locale} w={w} />
          </AnalyticsSection>

          <AnalyticsSection id="return-left-out" title={o.leftOutTitle} description={o.leftOutDescription}>
            <DataTable
              caption={o.leftOutCaption}
              columns={[
                { key: "reason", label: o.reason, cell: (n) => <span className="whitespace-normal">{w === taxReportsEn ? n.text : reasonWords(n.reason, w)}</span> },
                { key: "currency", label: o.currency, cell: (n) => n.currency },
                { key: "lines", label: o.documentLines, align: "right", cell: (n) => formatCount(n.documentLines) },
                { key: "taxable", label: o.net, align: "right", cell: (n) => moneyWriter(n.currency, locale)(n.taxableMinor).replace(/^-/, MINUS) },
                { key: "vat", label: o.vat, align: "right", cell: (n) => moneyWriter(n.currency, locale)(n.vatMinor).replace(/^-/, MINUS) },
              ]}
              rows={data.notIncluded}
              rowKey={(n) => `${n.reason}|${n.currency}`}
              empty={o.leftOutEmpty}
              exportable={false}
              exportReason="oss.left_out"
            />
          </AnalyticsSection>

          <AnalyticsSection
            id="return-registration"
            title={o.registrationTitle}
            description={fillWords(o.registrationDescription, { registration: o.registrationWords[data.registration] })}
          >
            <p className="text-sm text-muted">
              {o.registrationBefore}{" "}
              <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                {o.settingsTax}
              </Link>
              {o.registrationAfter}
            </p>
          </AnalyticsSection>

          <AnalyticsSection id="return-export" title={o.filesTitle} description={o.filesDescription}>
            {canExport ? (
              <div className="flex flex-wrap items-center gap-3">
                <ExportButton base={base} kind={scheme} fields={exportFields} disabled={data.incomplete} primary>
                  {fillWords(o.exportReturn, { scheme: word })}
                </ExportButton>
                <ExportButton base={base} kind={`${scheme}_detail`} fields={exportFields}>
                  {o.exportDetail}
                </ExportButton>
              </div>
            ) : (
              <ExportsNeedWrite words={w} />
            )}
            {data.incomplete && canExport ? <p className="text-sm text-muted">{o.incompleteExport}</p> : null}
            {lastExportedAt ? <p className="text-sm text-muted">{fillWords(o.lastExported, { date: longDateIn(lastExportedAt.slice(0, 10), w) })}</p> : null}
            {drift ? (
              <Note tone="warning" title={w.parts.changedSinceExport}>
                {drift}
              </Note>
            ) : null}
          </AnalyticsSection>
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rates
// ---------------------------------------------------------------------------

function sourceText(rate: RateCard, w: TaxReportsMessages): ReactNode {
  const t = w.oss.rates;
  if (!rate.choice) return <span className="text-(--chart-bad)">{t.missing}</span>;
  return rate.choice.source === "owner" ? fillWords(t.owner, { reason: rate.choice.reason ?? "" }) : t.ecb;
}

function RatesTable({ rates, actions, w }: { rates: readonly RateCard[]; actions: RateActions | null; w: TaxReportsMessages }) {
  const t = w.oss.rates;
  const columns: Column<RateCard>[] = [
    { key: "currency", label: t.currency, cell: (r) => r.currency },
    { key: "for", label: t.for, cell: (r) => (r.for === "correction" ? t.correction : t.thisPeriod) },
    { key: "day", label: t.dayAsked, cell: (r) => longDateIn(r.day, w) },
    { key: "rate", label: t.perEur, align: "right", cell: (r) => (r.choice ? r.choice.rate : NO_FIGURE) },
    { key: "date", label: t.rateOf, cell: (r) => (r.choice ? longDateIn(r.choice.date, w) : NO_FIGURE) },
    { key: "source", label: t.source, cell: (r) => <span className="whitespace-normal">{sourceText(r, w)}</span> },
    ...(actions
      ? [
          {
            key: "act",
            label: t.rate,
            cell: (r: RateCard) => <RateForms rate={r} actions={actions} w={w} />,
          } satisfies Column<RateCard>,
        ]
      : []),
  ];
  return <DataTable caption={t.caption} columns={columns} rows={rates} rowKey={(r) => `${r.currency}|${r.day}|${r.for}`} empty={t.empty} exportable={false} exportReason="oss.rates" />;
}

/** An owner's two ways to a rate: ask the ECB for the day, or enter a rate of their own with a reason (it wins over the ECB's for this store). */
function RateForms({ rate, actions, w }: { rate: RateCard; actions: RateActions; w: TaxReportsMessages }) {
  const t = w.oss.rates;
  return (
    <div className="flex min-w-48 flex-col gap-2 whitespace-normal">
      {!rate.choice ? (
        <ActionForm action={actions.fetch} className="flex flex-col gap-1" successMessage={t.stored}>
          <input type="hidden" name="currency" value={rate.currency} />
          <input type="hidden" name="day" value={rate.day} />
          <div>
            <SubmitButton variant="secondary">
              {t.fetch}
              <span className="sr-only">{fillWords(t.fetchFor, { currency: rate.currency, day: rate.day })}</span>
            </SubmitButton>
          </div>
        </ActionForm>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-(--brand-text)">{rate.choice?.source === "owner" ? t.change : t.enter}</summary>
        <ActionForm action={actions.override} className="mt-2 flex flex-col gap-2" successMessage={t.saved}>
          <input type="hidden" name="currency" value={rate.currency} />
          <input type="hidden" name="day" value={rate.day} />
          <label className="flex flex-col gap-1 font-medium">
            {fillWords(t.rateLabel, { currency: rate.currency })}
            <input name="rate" required inputMode="decimal" autoComplete="off" placeholder="10.9015" className={`${field} tabular-nums`} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            {t.why}
            <input name="reason" required minLength={10} maxLength={300} autoComplete="off" className={field} />
          </label>
          <div>
            <SubmitButton>{t.save}</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}

/** Every conversion behind the return, so the euro figures can be followed back to an amount and a rate. */
function ConversionGroups({ groups, eur, locale, w }: { groups: readonly ConversionGroup[]; eur: (minor: number | null) => ReactNode; locale: string; w: TaxReportsMessages }) {
  if (groups.length === 0) return null;
  const t = w.oss.conversions;
  const columns: Column<ConversionGroup>[] = [
    { key: "part", label: t.part, cell: (g) => (g.correctionPeriod ? fillWords(t.correction, { period: g.correctionPeriod }) : g.part) },
    { key: "ms", label: t.memberState, cell: (g) => g.memberState },
    { key: "rate", label: t.vatRate, align: "right", cell: (g) => `${ratePercent(g.rate)} %` },
    { key: "cur", label: t.currency, cell: (g) => g.currency },
    { key: "net", label: t.taxableDoc, align: "right", cell: (g) => moneyWriter(g.currency, locale)(g.taxableMinor).replace(/^-/, MINUS) },
    { key: "vat", label: t.vatDoc, align: "right", cell: (g) => moneyWriter(g.currency, locale)(g.vatMinor).replace(/^-/, MINUS) },
    { key: "neteur", label: t.taxableEur, align: "right", cell: (g) => eur(g.taxableEur) },
    { key: "vateur", label: t.vatEur, align: "right", cell: (g) => eur(g.vatEur) },
  ];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">{t.summary}</summary>
      <div className="mt-2">
        <DataTable caption={t.caption} columns={columns} rows={groups} rowKey={(g, i) => `${g.part}|${g.memberState}|${g.rate}|${g.currency}|${g.correctionPeriod ?? ""}|${i}`} exportable={false} exportReason="oss.conversions" />
        <p className="mt-2 text-xs text-muted">{t.note}</p>
      </div>
    </details>
  );
}
