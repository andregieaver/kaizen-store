import Link from "next/link";
import type { ReactNode } from "react";

import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { formatCount, MINUS, NO_FIGURE } from "@/lib/analytics-core";
import type { ConversionGroup, Part2Line, RateCard, ReturnMode, ReturnScheme } from "@/lib/oss-return";
import { IOSS_OFF_TEXT } from "@/lib/oss-return";
import { taxHref } from "@/lib/tax-admin";
import type { ReturnPart } from "@/lib/tax-classes";
import { longDate, periodLabel } from "@/lib/tax-periods";
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
};

/** What the page says under every goods table: the dispatch state's own VAT number is the owner's to enter, nothing here holds it. */
export const DISPATCH_NOTE =
  "Goods are totalled per Member State of dispatch as well. A return also asks for the VAT or tax number the dispatch Member State gave you; Kaizen does not hold it, so you enter it yourself.";

export const PART_LABEL: Record<ReturnPart, string> = {
  "2a": "Part 2a: services from your Member State of identification",
  "2b": "Part 2b: goods dispatched from your Member State of identification",
  "2d": "Part 2d: goods dispatched from another Member State",
  NU: "Part 2: services under the non-Union scheme",
  IOSS: "Part 2: consignments of 150 EUR or less, import scheme",
};

const PART_ORDER: ReturnPart[] = ["2a", "2b", "2d", "NU", "IOSS"];

const MODE_TEXT: Record<ReturnMode, string> = {
  filing: "Filing mode shows what a return for the period holds: a credit note of the same period reduces Part 2, a later one is a Part 3 correction of the period of its sale.",
  books: "Books mode is the bookkeeping view: every credit note counts in the period it is issued, as Finance counts a refund, so Part 2 can be negative and there is no Part 3.",
};

const REGISTRATION_WORD = { union: "the Union scheme", non_union: "the non-Union scheme", ioss: "the import scheme (IOSS)", none: "no registration" } as const;

const field = "min-h-10 w-full rounded-md border border-border bg-background px-3 text-sm";

export function OssView({ base, locale, scheme, mode, view, periods, canExport, isOwner, drift, lastExportedAt, exportProblem, actions }: OssViewProps) {
  const { data } = view;
  const eurWrite = moneyWriter("EUR", locale);
  const eur = (minor: number | null): ReactNode =>
    minor === null ? (
      <>
        <span aria-hidden="true">{NO_FIGURE}</span>
        <span className="sr-only">No euro rate is stored for this amount</span>
      </>
    ) : (
      eurWrite(minor).replace(/^-/, MINUS)
    );
  const eurText = (minor: number | null): string => (minor === null ? NO_FIGURE : eurWrite(minor).replace(/^-/, MINUS));
  const word = scheme === "oss" ? "OSS" : "IOSS";
  const stateOff = scheme === "ioss" && view.state === "off";
  const label = periodLabel(data.period);
  const sellerEmpty = data.registration === "none" && scheme === "oss";
  const exportFields = { period: data.period.key, mode };
  const settingsTax = `${base}/settings/tax`;
  const href = (nextMode: ReturnMode) => taxHref(base, { view: scheme, quarter: data.period.key, month: data.period.key, mode: nextMode });

  const parts = PART_ORDER.filter((p) => data.part2.some((l) => l.part === p));
  const lineColumns: Column<Part2Line>[] = [
    { key: "ms", label: "Member State of consumption", cell: (l) => l.memberState },
    { key: "dispatch", label: "Member State of dispatch", cell: (l) => l.dispatchState ?? "–" },
    { key: "rate", label: "Rate", align: "right", cell: (l) => `${ratePercent(l.rate)} %` },
    { key: "kind", label: "Rate kind", cell: (l) => (l.rateKind === "standard" ? "Standard" : "Reduced") },
    { key: "taxable", label: "Taxable amount (EUR)", align: "right", cell: (l) => eur(l.taxableEur) },
    { key: "vat", label: "VAT (EUR)", align: "right", cell: (l) => eur(l.vatEur) },
  ];

  return (
    <div className="flex flex-col gap-8">
      <TaxStatement />
      {exportProblem ? (
        <Note tone="warning" title="No file was made">
          {exportProblem}
        </Note>
      ) : null}

      <div className="flex flex-wrap items-end gap-x-6 gap-y-3">
        <form method="get" action={`${base}/analytics/tax`} className="flex flex-wrap items-end gap-2" aria-label={scheme === "oss" ? "Quarter" : "Month"}>
          <input type="hidden" name="view" value={scheme} />
          {mode === "books" ? <input type="hidden" name="mode" value="books" /> : null}
          <label className="flex flex-col gap-0.5 text-xs text-muted">
            {scheme === "oss" ? "Quarter" : "Month"}
            <select name={scheme === "oss" ? "quarter" : "month"} defaultValue={data.period.key} className="h-9 rounded-lg border border-border bg-background px-2 text-sm">
              {periods.map((p) => (
                <option key={p.key} value={p.key}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className="h-9 rounded-lg border border-border px-3 text-sm font-medium">
            Show
          </button>
        </form>
        <nav aria-label="Mode" className="flex gap-1">
          {(["filing", "books"] as const).map((m) => (
            <Link
              key={m}
              href={href(m)}
              aria-current={m === mode ? "true" : undefined}
              className={`inline-flex h-9 items-center rounded-lg border px-3 text-sm ${m === mode ? "border-foreground bg-surface font-semibold" : "border-border"}`}
            >
              {m === "filing" ? "Filing" : "Books"}
            </Link>
          ))}
        </nav>
      </div>
      <p className="-mt-4 max-w-3xl text-sm text-muted">{MODE_TEXT[mode]}</p>

      <p role="status" className="text-sm">
        {view.deadline.sentence}
        {view.deadline.state === "due_soon" || view.deadline.state === "passed" ? <span className="ml-2 align-middle"><StatusPill tone={view.deadline.state === "passed" ? "warning" : "info"}>{view.deadline.state === "passed" ? "Deadline passed" : "Due soon"}</StatusPill></span> : null}
      </p>

      {scheme === "ioss" && view.state !== "on" ? (
        <Note tone={stateOff ? "info" : "warning"} title={stateOff ? "IOSS is off" : "No IOSS number is recorded now"}>
          {stateOff ? (
            <p>
              {IOSS_OFF_TEXT}{" "}
              <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                Open Settings, Tax
              </Link>
            </p>
          ) : (
            <p>
              Some orders were marked IOSS, but no IOSS number is recorded in Settings, Tax now. They are shown as they were marked.{" "}
              <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                Open Settings, Tax
              </Link>
            </p>
          )}
        </Note>
      ) : null}
      {scheme === "ioss" && view.profile.iossIntermediary ? (
        <Note title="An intermediary is named">
          Your IOSS intermediary ({view.profile.iossIntermediary}) normally files the return. The return data file below is the data to give them.
        </Note>
      ) : null}
      {sellerEmpty ? (
        <Note tone="warning" title="What an OSS return would hold: no OSS registration is recorded (Settings, Tax)">
          <p>
            Nothing is hidden: these are the figures a return would hold if you were registered.{" "}
            <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
              Open Settings, Tax
            </Link>
          </p>
        </Note>
      ) : null}
      {data.notes.map((n) => (
        <Note key={n.code} tone="warning" title="Registration and sales do not fit">
          {n.message}
        </Note>
      ))}

      {stateOff ? null : (
        <>
          {data.incomplete ? (
            <Note tone="warning" title="This return is incomplete">
              <p>
                {`No euro rate is stored for ${data.missing.map((m) => `${m.currency} on ${longDate(m.day)}`).join(", ")}, so the euro figures behind it are left out and the return data is not offered as a file.`}
                {data.missing.some((m) => m.day >= view.today) ? " The ECB publishes its rates about 16:00 Central European Time on working days." : ""}
                {isOwner ? " Fetch the rate from the ECB or enter your own under Euro rates." : " An owner can fetch the rate from the ECB or enter one."}
              </p>
            </Note>
          ) : null}

          <AnalyticsSection
            id="return-part2"
            title={`${word} return for ${label}`}
            description={`In euro, per Member State of consumption and rate. ${data.totals.documents} ${data.totals.documents === 1 ? "invoice" : "invoices"} and ${data.totals.creditNotes} ${data.totals.creditNotes === 1 ? "credit note" : "credit notes"} make Part 2.`}
          >
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <KpiCard label="Taxable amount, Part 2" value={data.totals.taxableEur === null ? null : eurText(data.totals.taxableEur)} state={data.totals.taxableEur === null ? "missing" : "ok"} missing={{ text: "A euro rate is missing." }} />
              <KpiCard label="VAT, Part 2" value={data.totals.vatEur === null ? null : eurText(data.totals.vatEur)} state={data.totals.vatEur === null ? "missing" : "ok"} missing={{ text: "A euro rate is missing." }} />
              <KpiCard label="Total due, Part 5" value={data.part5Eur === null ? null : eurText(data.part5Eur)} emphasis state={data.part5Eur === null ? "missing" : "ok"} missing={{ text: "A euro rate is missing." }} help="The sum of the positive balances. A negative balance is not counted." />
            </div>
            {parts.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border px-4 py-6 text-sm text-muted">{`Nothing in Part 2 for ${label}.`}</div>
            ) : (
              parts.map((p) => (
                <ChartCard key={p} title={PART_LABEL[p]}>
                  <DataTable
                    caption={PART_LABEL[p]}
                    columns={p === "2b" || p === "2d" ? lineColumns : lineColumns.filter((c) => c.key !== "dispatch")}
                    rows={data.part2.filter((l) => l.part === p)}
                    rowKey={(l) => `${l.part}|${l.memberState}|${l.dispatchState ?? ""}|${l.rate}`}
                    exportable={false}
                    exportReason="oss.part2"
                  />
                  {p === "2b" || p === "2d" ? <p className="mt-2 text-xs text-muted">{DISPATCH_NOTE}</p> : null}
                </ChartCard>
              ))
            )}
          </AnalyticsSection>

          <AnalyticsSection id="return-part3" title="Part 3: corrections of earlier periods" description="A credit note issued after the period of its sale corrects that period. Converted at the rate of the period it corrects.">
            {mode === "books" ? (
              <p className="text-sm text-muted">Books mode has no Part 3. Open Filing mode to see the corrections.</p>
            ) : (
              <DataTable
                caption="Corrections of earlier periods"
                columns={[
                  { key: "period", label: "Period corrected", cell: (l) => l.correctionPeriod },
                  { key: "ms", label: "Member State of consumption", cell: (l) => l.memberState },
                  { key: "vat", label: "VAT (EUR)", align: "right", cell: (l) => eur(l.vatEur) },
                  { key: "late", label: "Note", cell: (l) => (l.late ? "More than three years ago: such a correction is made with the Member State directly, not through the OSS." : NO_FIGURE) },
                ]}
                rows={data.part3}
                rowKey={(l) => `${l.correctionPeriod}|${l.memberState}`}
                empty={`No corrections in ${label}.`}
                exportable={false}
                exportReason="oss.part3"
              />
            )}
          </AnalyticsSection>

          <AnalyticsSection id="return-part4" title="Part 4: balance per Member State" description="Part 2 plus Part 3. A negative balance is reimbursed by that Member State and is never set off against another: it is not counted in Part 5.">
            <DataTable
              caption="Balance per Member State"
              columns={[
                { key: "ms", label: "Member State of consumption", cell: (b) => b.memberState },
                { key: "p2", label: "Part 2 VAT (EUR)", align: "right", cell: (b) => eur(b.part2VatEur) },
                { key: "p3", label: "Part 3 VAT (EUR)", align: "right", cell: (b) => eur(b.part3VatEur) },
                { key: "bal", label: "Balance (EUR)", align: "right", cell: (b) => eur(b.balanceEur) },
                { key: "note", label: "Note", cell: (b) => (b.reimbursed ? "Reimbursed by the Member State, not counted in Part 5" : NO_FIGURE) },
              ]}
              rows={data.part4}
              rowKey={(b) => b.memberState}
              empty={`No balance for ${label}.`}
              exportable={false}
              exportReason="oss.part4"
            />
          </AnalyticsSection>

          <AnalyticsSection
            id="return-rates"
            title="Euro rates"
            description="Each currency is converted once for each part, Member State and rate, at the ECB's reference rate of the period's last day, or of the next day it published one. A corrected period uses its own last day. The ECB publishes its rates for information only."
          >
            <RatesTable rates={data.rates} actions={isOwner ? actions : null} />
            {!isOwner ? <p className="text-sm text-muted">Only an owner can fetch a rate from the ECB or enter one.</p> : null}
            <ConversionGroups groups={data.groups} eur={eur} locale={locale} />
          </AnalyticsSection>

          <AnalyticsSection id="return-left-out" title="Not in this return" description="Sales in the period that belong somewhere else, with the reason. Amounts are in the document currency, invoices less credit notes.">
            <DataTable
              caption="Sales left out of the return"
              columns={[
                { key: "reason", label: "Reason", cell: (n) => <span className="whitespace-normal">{n.text}</span> },
                { key: "currency", label: "Currency", cell: (n) => n.currency },
                { key: "lines", label: "Document lines", align: "right", cell: (n) => formatCount(n.documentLines) },
                { key: "taxable", label: "Net", align: "right", cell: (n) => moneyWriter(n.currency, locale)(n.taxableMinor).replace(/^-/, MINUS) },
                { key: "vat", label: "VAT", align: "right", cell: (n) => moneyWriter(n.currency, locale)(n.vatMinor).replace(/^-/, MINUS) },
              ]}
              rows={data.notIncluded}
              rowKey={(n) => `${n.reason}|${n.currency}`}
              empty="Everything in the period is in this return."
              exportable={false}
              exportReason="oss.left_out"
            />
          </AnalyticsSection>

          <AnalyticsSection
            id="return-registration"
            title="Registration"
            description={`Your tax profile records ${REGISTRATION_WORD[data.registration]}.`}
          >
            <p className="text-sm text-muted">
              Registrations are entered under{" "}
              <Link href={settingsTax} className="font-medium text-(--brand-text) underline-offset-2 hover:underline">
                Settings, Tax
              </Link>
              . Nothing here checks a number against a register.
            </p>
          </AnalyticsSection>

          <AnalyticsSection id="return-export" title="Files for your accountant" description="The return data is what the return asks for in its boxes. The conversion detail shows each conversion with its rate, for your records.">
            {canExport ? (
              <div className="flex flex-wrap items-center gap-3">
                <ExportButton base={base} kind={scheme} fields={exportFields} disabled={data.incomplete} primary>
                  {`Export ${word} return data (CSV)`}
                </ExportButton>
                <ExportButton base={base} kind={`${scheme}_detail`} fields={exportFields}>
                  Export conversion detail (CSV)
                </ExportButton>
              </div>
            ) : (
              <ExportsNeedWrite />
            )}
            {data.incomplete && canExport ? <p className="text-sm text-muted">The return data is not offered while a euro rate is missing. The conversion detail is: it shows the gap.</p> : null}
            {lastExportedAt ? <p className="text-sm text-muted">{`Last exported on ${longDate(lastExportedAt.slice(0, 10))}.`}</p> : null}
            {drift ? (
              <Note tone="warning" title="This period has changed since you exported it">
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

function sourceText(rate: RateCard): ReactNode {
  if (!rate.choice) return <span className="text-(--chart-bad)">Missing</span>;
  return rate.choice.source === "owner" ? `Owner's rate: ${rate.choice.reason ?? ""}` : "ECB reference rate";
}

function RatesTable({ rates, actions }: { rates: readonly RateCard[]; actions: RateActions | null }) {
  const columns: Column<RateCard>[] = [
    { key: "currency", label: "Currency", cell: (r) => r.currency },
    { key: "for", label: "For", cell: (r) => (r.for === "correction" ? "A correction of an earlier period" : "This period") },
    { key: "day", label: "Day asked", cell: (r) => longDate(r.day) },
    { key: "rate", label: "Rate (per 1 EUR)", align: "right", cell: (r) => (r.choice ? r.choice.rate : NO_FIGURE) },
    { key: "date", label: "Rate of", cell: (r) => (r.choice ? longDate(r.choice.date) : NO_FIGURE) },
    { key: "source", label: "Source", cell: (r) => <span className="whitespace-normal">{sourceText(r)}</span> },
    ...(actions
      ? [
          {
            key: "act",
            label: "Rate",
            cell: (r: RateCard) => <RateForms rate={r} actions={actions} />,
          } satisfies Column<RateCard>,
        ]
      : []),
  ];
  return <DataTable caption="Euro rates used" columns={columns} rows={rates} rowKey={(r) => `${r.currency}|${r.day}|${r.for}`} empty="Every amount of this period is in euro: no conversion is needed." exportable={false} exportReason="oss.rates" />;
}

/** An owner's two ways to a rate: ask the ECB for the day, or enter a rate of their own with a reason (it wins over the ECB's for this store). */
function RateForms({ rate, actions }: { rate: RateCard; actions: RateActions }) {
  return (
    <div className="flex min-w-48 flex-col gap-2 whitespace-normal">
      {!rate.choice ? (
        <ActionForm action={actions.fetch} className="flex flex-col gap-1" successMessage="Stored.">
          <input type="hidden" name="currency" value={rate.currency} />
          <input type="hidden" name="day" value={rate.day} />
          <div>
            <SubmitButton variant="secondary">
              Fetch from the ECB<span className="sr-only">{` for ${rate.currency} on ${rate.day}`}</span>
            </SubmitButton>
          </div>
        </ActionForm>
      ) : null}
      <details className="text-xs">
        <summary className="cursor-pointer font-medium text-(--brand-text)">{rate.choice?.source === "owner" ? "Change your rate" : "Enter a rate"}</summary>
        <ActionForm action={actions.override} className="mt-2 flex flex-col gap-2" successMessage="Saved. The figures follow it.">
          <input type="hidden" name="currency" value={rate.currency} />
          <input type="hidden" name="day" value={rate.day} />
          <label className="flex flex-col gap-1 font-medium">
            {`Rate: ${rate.currency} per 1 EUR`}
            <input name="rate" required inputMode="decimal" autoComplete="off" placeholder="10.9015" className={`${field} tabular-nums`} />
          </label>
          <label className="flex flex-col gap-1 font-medium">
            Why (at least 10 characters, shown wherever the rate is used)
            <input name="reason" required minLength={10} maxLength={300} autoComplete="off" className={field} />
          </label>
          <div>
            <SubmitButton>Save the rate</SubmitButton>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}

/** Every conversion behind the return, so the euro figures can be followed back to an amount and a rate. */
function ConversionGroups({ groups, eur, locale }: { groups: readonly ConversionGroup[]; eur: (minor: number | null) => ReactNode; locale: string }) {
  if (groups.length === 0) return null;
  const columns: Column<ConversionGroup>[] = [
    { key: "part", label: "Part", cell: (g) => (g.correctionPeriod ? `3 (${g.correctionPeriod})` : g.part) },
    { key: "ms", label: "Member State", cell: (g) => g.memberState },
    { key: "rate", label: "VAT rate", align: "right", cell: (g) => `${ratePercent(g.rate)} %` },
    { key: "cur", label: "Currency", cell: (g) => g.currency },
    { key: "net", label: "Taxable (document currency)", align: "right", cell: (g) => moneyWriter(g.currency, locale)(g.taxableMinor).replace(/^-/, MINUS) },
    { key: "vat", label: "VAT (document currency)", align: "right", cell: (g) => moneyWriter(g.currency, locale)(g.vatMinor).replace(/^-/, MINUS) },
    { key: "neteur", label: "Taxable (EUR)", align: "right", cell: (g) => eur(g.taxableEur) },
    { key: "vateur", label: "VAT (EUR)", align: "right", cell: (g) => eur(g.vatEur) },
  ];
  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-muted">Each conversion, in the document currency and in euro</summary>
      <div className="mt-2">
        <DataTable caption="Conversions behind the return" columns={columns} rows={groups} rowKey={(g, i) => `${g.part}|${g.memberState}|${g.rate}|${g.currency}|${g.correctionPeriod ?? ""}|${i}`} exportable={false} exportReason="oss.conversions" />
        <p className="mt-2 text-xs text-muted">Taxable amount and VAT are each added up in the document currency and converted once, so the euro VAT can differ from the taxable amount times the rate by a few cents.</p>
      </div>
    </details>
  );
}
