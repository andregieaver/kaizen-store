import Link from "next/link";
import type { ReactNode } from "react";

import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import type { CurrencyFigures, WorkOverview } from "@/lib/work-overview";
import type { ReadinessProblem } from "@/lib/work-vat";

/** What the overview shows, from the reader's rows and the names to put on them (`getWorkOverview`). */
export type OverviewProps = {
  /** `/admin/{store}/work`. */
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
const th = "px-4 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";
const card = "overflow-x-auto rounded-lg border border-border bg-background";

const hours = (minutes: number) => formatDuration(minutes);

function Figures({ f, locale, base, many }: { f: CurrencyFigures; locale: string; base: string; many: boolean }) {
  const money = (minor: number) => formatMoney(minor, f.currency, locale);
  const overdue = f.receivables.overdue;
  return (
    <div className="flex flex-col gap-2">
      {many && <h3 className="text-sm font-medium text-muted">{f.currency}</h3>}
      <StatGrid>
        <Stat
          label="Unbilled time"
          value={money(f.unbilled.amountMinor)}
          sub={
            f.unbilled.minutes > 0
              ? `${hours(f.unbilled.minutes)} at your rates, without VAT`
              : "Nothing waiting to be invoiced"
          }
          href={`${base}/invoices`}
        />
        <Stat
          label="Invoice drafts"
          value={f.drafts.count}
          sub={f.drafts.count > 0 ? `${money(f.drafts.minor)} with VAT` : "No drafts"}
          href={`${base}/invoices?show=drafts`}
        />
        <Stat
          label="Owed to you"
          value={money(f.receivables.outstandingMinor)}
          sub={overdue.count > 0 ? `${money(overdue.minor)} is overdue` : "Nothing overdue"}
          href={`${base}/invoices?show=overdue`}
        />
        <Stat
          label="Paid this month"
          value={money(f.paidThisMonth.minor)}
          sub={`${f.paidThisMonth.count} ${f.paidThisMonth.count === 1 ? "invoice" : "invoices"}`}
        />
      </StatGrid>
    </div>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">{children}</p>;
}

/** The Work page (docs/work.md 6.5): what is unbilled, drafted and owed, what needs you, and what is running. */
export function OverviewBody(props: OverviewProps) {
  const { base, locale, overview } = props;
  const name = (clientId: string) => props.clientNames[clientId] ?? "A client";
  const hasFigures = overview.currencies.length > 0;
  const start = props.clientCount === 0;

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div>
        <h1 className="text-2xl font-semibold">Work</h1>
        <p className="text-sm text-muted">Your clients, the hours you log for them and the invoices you send.</p>
      </div>

      {props.missing.length > 0 && (
        <section aria-labelledby="ready-heading" className="rounded-lg border border-border bg-background p-4 text-sm">
          <h2 id="ready-heading" className="mb-1 font-medium">
            Before your first invoice
          </h2>
          <ul className="mb-2 list-disc pl-5">
            {props.missing.map((problem) => (
              <li key={problem.code}>{problem.message}</li>
            ))}
          </ul>
          <Link href={props.settingsHref} className="underline">
            Open Work settings
          </Link>
        </section>
      )}

      {start ? (
        <section
          aria-labelledby="start-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-background p-5"
        >
          <h2 id="start-heading" className="font-medium">
            Add your first client
          </h2>
          <p className="text-sm text-muted">
            Clients are the people and companies you bill. Add one, log the hours you work for them, and turn those
            hours into an invoice.
          </p>
          <div>
            <Link
              href={`${base}/clients`}
              className="inline-flex min-h-10 items-center rounded-md bg-foreground px-4 text-sm font-medium text-background"
            >
              Add your first client
            </Link>
          </div>
        </section>
      ) : (
        <>
          <Attention items={overview.attention} empty="Nothing needs your attention." />

          {hasFigures ? (
            <section aria-labelledby="figures-heading" className="flex flex-col gap-4">
              <h2 id="figures-heading" className="text-lg font-semibold">
                Where things stand
              </h2>
              {overview.currencies.map((f) => (
                <Figures key={f.currency} f={f} locale={locale} base={base} many={overview.currencies.length > 1} />
              ))}
            </section>
          ) : (
            <Empty>Nothing to count yet. Log time or make an invoice draft and the figures show here.</Empty>
          )}

          <Section
            id="unbilled-heading"
            title="Unbilled time by client"
            action={
              <Link href={`${base}/time`} className="text-sm underline">
                Time
              </Link>
            }
          >
            {overview.unbilledByClient.length === 0 ? (
              <Empty>No unbilled time.</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th className={th}>Client</th>
                      <th className={`${th} text-right`}>Time</th>
                      <th className={`${th} text-right`}>Amount</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
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
            title="Overdue invoices"
            action={
              <Link href={`${base}/invoices`} className="text-sm underline">
                All invoices
              </Link>
            }
          >
            {overview.overdueInvoices.length === 0 ? (
              <Empty>No invoice is overdue.</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th className={th}>Invoice</th>
                      <th className={th}>Client</th>
                      <th className={th}>Was due</th>
                      <th className={`${th} text-right`}>Still owed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
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

          <Section id="timers-heading" title="Running timers">
            {overview.runningTimers.length === 0 ? (
              <Empty>No timer is running.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
                {overview.runningTimers.map((timer) => {
                  const assignment = props.assignmentNames[timer.assignmentId];
                  return (
                    <li
                      key={`${timer.accountId}:${timer.assignmentId}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <span>
                        {props.people[timer.accountId] ?? "Someone"} is working on{" "}
                        <span className="font-medium">{assignment?.name ?? "an assignment"}</span>
                        {assignment && <span className="text-muted"> for {assignment.clientName}</span>}
                      </span>
                      <span className="tabular-nums text-muted">{hours(timer.elapsedMinutes)} so far</span>
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
