import Link from "next/link";
import type { ReactNode } from "react";

import { Attention, Section, Stat, StatGrid } from "@/components/admin/overview-parts";
import { formatMoney } from "@/lib/money";
import { formatDay } from "@/lib/work-dates";
import { WORK_LOCALE, type WorkStore } from "@/lib/work-owner";
import type { CurrencyFigures } from "@/lib/work-overview";
import { WORK_ROOT, workBase } from "@/lib/work-paths";
import { formatDuration } from "@/lib/work-time";
import type { OwnerOverviewView } from "@/server/work-owner";

import { CurrencyNote, StoreTag } from "./owner-common";
import { NewInStoreButton } from "./owner-parts";

const table = "w-full text-sm";
const th = "px-4 py-2 text-left text-xs font-medium tracking-wide text-muted uppercase";
const card = "overflow-x-auto rounded-lg border border-border bg-background";

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-border bg-background p-4 text-sm text-muted">{children}</p>;
}

function Figures({ f, many }: { f: CurrencyFigures; many: boolean }) {
  const money = (minor: number) => formatMoney(minor, f.currency, WORK_LOCALE);
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
              ? `${formatDuration(f.unbilled.minutes)} at your rates, without VAT`
              : "Nothing waiting to be invoiced"
          }
          href={`${WORK_ROOT}/time?billing=unbilled`}
        />
        <Stat
          label="Invoice drafts"
          value={f.drafts.count}
          sub={f.drafts.count > 0 ? `${money(f.drafts.minor)} with VAT` : "No drafts"}
          href={`${WORK_ROOT}/invoices?show=drafts`}
        />
        <Stat
          label="Owed to you"
          value={money(f.receivables.outstandingMinor)}
          sub={overdue.count > 0 ? `${money(overdue.minor)} is overdue` : "Nothing overdue"}
          href={`${WORK_ROOT}/invoices?show=overdue`}
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

/**
 * The combined Work overview (D123, docs/work.md 6.5): what is unbilled, drafted and owed across the account's
 * stores, one set of figures per currency (never added across currencies), each store's own beside them, what
 * needs attention, the overdue invoices, unbilled time by client and the timers running. Every row links to its
 * store's own screen.
 */
export function OwnerOverviewBody({ view, stores }: { view: OwnerOverviewView; stores: WorkStore[] }) {
  const { combined } = view;
  const many = stores.length > 1;
  const name = (clientId: string) => view.clientNames[clientId] ?? "A client";
  const noClients = combined.clientCount === 0;
  const choices = stores.map(({ slug, name: storeName }) => ({ slug, name: storeName }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Work</h1>
          <p className="text-sm text-muted">
            {many
              ? "Your clients, hours and invoices across all your stores, in one place."
              : "Your clients, the hours you log for them and the invoices you send."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <NewInStoreButton kind="client" stores={choices} defaultSlug="" primary={false} />
          <NewInStoreButton kind="invoice" stores={choices} defaultSlug="" />
        </div>
      </div>

      {view.missing.length > 0 && (
        <section aria-labelledby="ready-heading" className="rounded-lg border border-border bg-background p-4 text-sm">
          <h2 id="ready-heading" className="mb-2 font-medium">
            Before the first invoice
          </h2>
          <ul className="flex flex-col gap-3">
            {view.missing.map(({ store, problems }) => (
              <li key={store.slug}>
                <p className="font-medium">{store.name}</p>
                <ul className="mb-1 list-disc pl-5">
                  {problems.map((problem) => (
                    <li key={problem.code}>{problem.message}</li>
                  ))}
                </ul>
                <Link href={`${workBase(store.slug)}/settings`} className="underline">
                  Open {store.name}&apos;s Work settings
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {noClients ? (
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
            <NewInStoreButton kind="client" stores={choices} defaultSlug="" />
          </div>
        </section>
      ) : (
        <>
          <Attention items={combined.attention} empty="Nothing needs your attention." />

          {combined.currencies.length > 0 ? (
            <section aria-labelledby="figures-heading" className="flex flex-col gap-4">
              <h2 id="figures-heading" className="text-lg font-semibold">
                Where things stand{many ? ", all stores" : ""}
              </h2>
              {combined.currencies.map((f) => (
                <Figures key={f.currency} f={f} many={combined.currencies.length > 1} />
              ))}
              {(combined.currencies.length > 1 || many) && <CurrencyNote />}
            </section>
          ) : (
            <Empty>Nothing to count yet. Log time or make an invoice draft and the figures show here.</Empty>
          )}

          {many && (
            <Section id="stores-heading" title="By store">
              <div className={card}>
                <table className={table}>
                  <caption className="sr-only">Work figures for each store</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        Store
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Unbilled
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Drafts
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Owed
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Overdue
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Timers
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {combined.perStore.map((row) => (
                      <tr key={row.store.id} className="align-top">
                        <th scope="row" className="px-4 py-2 text-left font-normal">
                          <Link href={workBase(row.store.slug)} className="font-medium underline">
                            {row.store.name}
                          </Link>
                          <span className="block text-xs text-muted">
                            {row.clientCount} {row.clientCount === 1 ? "client" : "clients"}
                          </span>
                        </th>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.currencies.map((f) => (
                            <span key={f.currency} className="block">
                              {formatMoney(f.unbilled.amountMinor, f.currency, WORK_LOCALE)}
                              {f.unbilled.minutes > 0 && (
                                <span className="block text-xs text-muted">{formatDuration(f.unbilled.minutes)}</span>
                              )}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.currencies.map((f) => (
                            <span key={f.currency} className="block">
                              {f.drafts.count}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.currencies.map((f) => (
                            <span key={f.currency} className="block">
                              {formatMoney(f.receivables.outstandingMinor, f.currency, WORK_LOCALE)}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {row.currencies.map((f) => (
                            <span key={f.currency} className="block">
                              {f.receivables.overdue.count > 0
                                ? formatMoney(f.receivables.overdue.minor, f.currency, WORK_LOCALE)
                                : "–"}
                            </span>
                          ))}
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{row.runningTimers}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          )}

          <Section
            id="unbilled-heading"
            title="Unbilled time by client"
            action={
              <Link href={`${WORK_ROOT}/time?billing=unbilled`} className="text-sm underline">
                Time
              </Link>
            }
          >
            {combined.unbilledByClient.length === 0 ? (
              <Empty>No unbilled time.</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        Client
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Time
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Amount
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {combined.unbilledByClient.map((row) => (
                      <tr key={`${row.storeSlug}:${row.clientId}:${row.currency}`}>
                        <td className="px-4 py-2">
                          <Link href={`${workBase(row.storeSlug)}/clients/${row.clientId}`} className="underline">
                            {name(row.clientId)}
                          </Link>
                          <span className="block">
                            <StoreTag name={row.storeName} show={many} />
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">{formatDuration(row.minutes)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(row.amountMinor, row.currency, WORK_LOCALE)}
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
              <Link href={`${WORK_ROOT}/invoices?show=overdue`} className="text-sm underline">
                All overdue
              </Link>
            }
          >
            {combined.overdueInvoices.length === 0 ? (
              <Empty>No invoice is overdue.</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        Invoice
                      </th>
                      <th scope="col" className={th}>
                        Client
                      </th>
                      <th scope="col" className={th}>
                        Was due
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        Still owed
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {combined.overdueInvoices.map((row) => (
                      <tr key={`${row.storeSlug}:${row.invoiceId}`}>
                        <td className="px-4 py-2">
                          <Link href={`${workBase(row.storeSlug)}/invoices/${row.invoiceId}`} className="underline">
                            {view.invoiceNumbers[row.invoiceId] || "Invoice"}
                          </Link>
                          <span className="block">
                            <StoreTag name={row.storeName} show={many} />
                          </span>
                        </td>
                        <td className="px-4 py-2">{name(row.clientId)}</td>
                        <td className="px-4 py-2">
                          {formatDay(row.dueOn, WORK_LOCALE)}
                          <span className="block text-xs text-muted">
                            {row.daysOverdue} {row.daysOverdue === 1 ? "day" : "days"} ago
                          </span>
                        </td>
                        <td className="px-4 py-2 text-right tabular-nums">
                          {formatMoney(row.outstandingMinor, row.currency, WORK_LOCALE)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Section>

          <Section id="timers-heading" title="Running timers">
            {combined.runningTimers.length === 0 ? (
              <Empty>No timer is running.</Empty>
            ) : (
              <ul className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
                {combined.runningTimers.map((timer) => {
                  const assignment = view.assignmentNames[timer.assignmentId];
                  return (
                    <li
                      key={`${timer.storeSlug}:${timer.accountId}:${timer.assignmentId}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <span>
                        {view.people[timer.accountId] ?? "Someone"} is working on{" "}
                        <Link
                          href={`${workBase(timer.storeSlug)}/assignments/${timer.assignmentId}`}
                          className="font-medium underline"
                        >
                          {assignment?.name ?? "an assignment"}
                        </Link>
                        {assignment && <span className="text-muted"> for {assignment.clientName}</span>}
                        {many && <span className="text-muted"> ({timer.storeName})</span>}
                      </span>
                      <span className="tabular-nums text-muted">{formatDuration(timer.elapsedMinutes)} so far</span>
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
