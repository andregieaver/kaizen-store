import Link from "next/link";
import type { ReactNode } from "react";

import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import type { CurrencyFigures, WorkOverview } from "@/lib/work-overview";
import type { ReadinessProblem } from "@/lib/work-vat";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

/** What the overview shows, from the reader's rows and the names to put on them (`getWorkOverview`). */
export type OverviewProps = {
  /** `workBase(store)`. */
  base: string;
  settingsHref: string;
  locale: string;
  today: string;
  overview: WorkOverview;
  clientCount: number;
  clientNames: Record<string, string>;
  invoiceNumbers: Record<string, string>;
  assignmentNames: Record<string, { name: string; clientName: string }>;
  people: Record<string, string>;
  /** What is missing before the first invoice; empty when ready. */
  missing: ReadinessProblem[];
};

const table = "w-full text-sm";
const th = "px-4 py-2 text-left text-eyebrow text-muted uppercase";
const card = "overflow-x-auto rounded-lg border border-line bg-card";

const hours = (minutes: number) => formatDuration(minutes);

function Figures({ f, locale, base, many }: { f: CurrencyFigures; locale: string; base: string; many: boolean }) {
  const tw = workText().workOverview;
  const money = (minor: number) => formatMoney(minor, f.currency, locale);
  const overdue = f.receivables.overdue;
  return (
    <div className="flex flex-col gap-2">
      {many && <h3 className="text-muted text-body-strong text-ink">{f.currency}</h3>}
      <StatGrid>
        <Stat
          label={tw.unbilledTime}
          value={money(f.unbilled.amountMinor)}
          sub={
            f.unbilled.minutes > 0
              ? `${hours(f.unbilled.minutes)} at your rates, without VAT`
              : tw.nothingWaitingToBe
          }
          href={`${base}/invoices`}
        />
        <Stat
          label={tw.invoiceDrafts}
          value={f.drafts.count}
          sub={f.drafts.count > 0 ? `${money(f.drafts.minor)} with VAT` : tw.noDrafts}
          href={`${base}/invoices?show=drafts`}
        />
        <Stat
          label={tw.owedToYou}
          value={money(f.receivables.outstandingMinor)}
          sub={overdue.count > 0 ? `${money(overdue.minor)} is overdue` : tw.nothingOverdue}
          href={`${base}/invoices?show=overdue`}
        />
        <Stat
          label={tw.paidThisMonth}
          value={money(f.paidThisMonth.minor)}
          sub={`${f.paidThisMonth.count} ${f.paidThisMonth.count === 1 ? "invoice" : "invoices"}`}
        />
      </StatGrid>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-panel border border-line bg-card p-4 text-sm text-muted">{children}</p>;
}

/** The Work page (docs/work.md 6.5): what is unbilled, drafted and owed, what needs you, and what is running. */
export function OverviewBody(props: OverviewProps) {
  const tw = workText().workOverview;
  const { base, locale, overview } = props;
  const name = (clientId: string) => props.clientNames[clientId] ?? "A client";
  const hasFigures = overview.currencies.length > 0;
  const start = props.clientCount === 0;

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <PageHeader title={tw.work} description={<>{tw.yourClientsTheHours}</>} />

      {props.missing.length > 0 && (
        <section aria-labelledby="ready-heading" className={`p-4 text-sm ${CARD_CLASS}`}>
          <h2 id="ready-heading" className="mb-1 text-title text-ink">
            {tw.beforeYourFirstInvoice}
          </h2>
          <ul className="mb-2 list-disc pl-5">
            {props.missing.map((problem) => (
              <li key={problem.code}>{problem.message}</li>
            ))}
          </ul>
          <Link href={props.settingsHref} className="underline">
            {tw.openWorkSettings}
          </Link>
        </section>
      )}

      {start ? (
        <section
          aria-labelledby="start-heading"
          className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}
        >
          <h2 id="start-heading" className="text-title text-ink">
            {tw.addYourFirstClient}
          </h2>
          <p className="text-sm text-muted">
            {tw.clientsAreThePeople}
          </p>
          <div>
            <Link
              href={`${base}/clients`}
              className="inline-flex min-h-10 items-center rounded-pill bg-brand px-4 text-sm font-medium text-brand-ink"
            >
              {tw.addYourFirstClient}
            </Link>
          </div>
        </section>
      ) : (
        <>
          <Attention items={overview.attention} empty={tw.nothingNeedsYourAttention} />

          {hasFigures ? (
            <section aria-labelledby="figures-heading" className="flex flex-col gap-4">
              <h2 id="figures-heading" className="text-title text-ink">
                {tw.whereThingsStand}
              </h2>
              {overview.currencies.map((f) => (
                <Figures key={f.currency} f={f} locale={locale} base={base} many={overview.currencies.length > 1} />
              ))}
            </section>
          ) : (
            <Empty>{tw.nothingToCountYet}</Empty>
          )}

          <Section
            id="unbilled-heading"
            title={tw.unbilledTimeByClient}
            action={
              <Link href={`${base}/time`} className="text-sm underline">
                {tw.time}
              </Link>
            }
          >
            {overview.unbilledByClient.length === 0 ? (
              <Empty>{tw.noUnbilledTime}</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th className={th}>{tw.client}</th>
                      <th className={`${th} text-right`}>{tw.time}</th>
                      <th className={`${th} text-right`}>{tw.amount}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {overview.unbilledByClient.map((row) => (
                      <tr key={`${row.clientId}:${row.currency}`}>
                        <td className="px-4 py-2">
                          <Link href={`${base}/clients/${row.clientId}`} className="underline">
                            {name(row.clientId)}
                          </Link>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{hours(row.minutes)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(row.amountMinor, row.currency, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section
            id="overdue-heading"
            title={tw.overdueInvoices}
            action={
              <Link href={`${base}/invoices`} className="text-sm underline">
                {tw.allInvoices}
              </Link>
            }
          >
            {overview.overdueInvoices.length === 0 ? (
              <Empty>{tw.noInvoiceIsOverdue}</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th className={th}>{tw.invoice}</th>
                      <th className={th}>{tw.client}</th>
                      <th className={th}>{tw.wasDue}</th>
                      <th className={`${th} text-right`}>{tw.stillOwed}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {overview.overdueInvoices.map((row) => (
                      <tr key={row.invoiceId}>
                        <td className="px-4 py-2">
                          <Link href={`${base}/invoices/${row.invoiceId}`} className="underline">
                            {props.invoiceNumbers[row.invoiceId] || "Invoice"}
                          </Link>
                        </td>
                        <td className="px-4 py-2">{name(row.clientId)}</td>
                        <td className="px-4 py-2">
                          {formatDay(row.dueOn, locale)}
                          <span className="block text-xs text-muted">
                            {row.daysOverdue} {row.daysOverdue === 1 ? "day" : "days"} ago
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(row.outstandingMinor, row.currency, locale)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="timers-heading" title={tw.runningTimers}>
            {overview.runningTimers.length === 0 ? (
              <Empty>{tw.noTimerIsRunning}</Empty>
            ) : (
              <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
                {overview.runningTimers.map((timer) => {
                  const assignment = props.assignmentNames[timer.assignmentId];
                  return (
                    <li
                      key={`${timer.accountId}:${timer.assignmentId}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <span>
                        {fillWords(tw.isWorkingOn, { name: props.people[timer.accountId] ?? tw.someone })}{" "}
                        <span className="font-medium">{assignment?.name ?? tw.anAssignment}</span>
                        {assignment && <span className="text-muted"> {fillWords(tw.forClient, { client: assignment.clientName })}</span>}
                      </span>
                      <span className="tabular-nums text-muted">{fillWords(tw.soFar, { time: hours(timer.elapsedMinutes) })}</span>
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
