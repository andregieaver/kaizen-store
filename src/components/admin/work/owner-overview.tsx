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
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

import { CurrencyNote, StoreTag } from "./owner-common";
import { NewInStoreButton } from "./owner-parts";
import { workText } from "@/lib/work-text";
import { fillWords } from "@/lib/admin-fill";

const table = "w-full text-sm";
const th = "px-4 py-2 text-left text-eyebrow text-muted uppercase";
const card = "overflow-x-auto rounded-lg border border-line bg-card";

function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-panel border border-line bg-card p-4 text-sm text-muted">{children}</p>;
}

function Figures({ f, many }: { f: CurrencyFigures; many: boolean }) {
  const tw = workText().ownerOverview;
  const money = (minor: number) => formatMoney(minor, f.currency, WORK_LOCALE);
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
              ? `${formatDuration(f.unbilled.minutes)} at your rates, without VAT`
              : tw.nothingWaitingToBe
          }
          href={`${WORK_ROOT}/time?billing=unbilled`}
        />
        <Stat
          label={tw.invoiceDrafts}
          value={f.drafts.count}
          sub={f.drafts.count > 0 ? `${money(f.drafts.minor)} with VAT` : tw.noDrafts}
          href={`${WORK_ROOT}/invoices?show=drafts`}
        />
        <Stat
          label={tw.owedToYou}
          value={money(f.receivables.outstandingMinor)}
          sub={overdue.count > 0 ? `${money(overdue.minor)} is overdue` : tw.nothingOverdue}
          href={`${WORK_ROOT}/invoices?show=overdue`}
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

/**
 * The combined Work overview (D123, docs/work.md 6.5): what is unbilled, drafted and owed across the account's
 * stores, one set of figures per currency (never added across currencies), each store's own beside them, what
 * needs attention, the overdue invoices, unbilled time by client and the timers running. Every row links to its
 * store's own screen.
 */
export function OwnerOverviewBody({ view, stores }: { view: OwnerOverviewView; stores: WorkStore[] }) {
  const tw = workText().ownerOverview;
  const { combined } = view;
  const many = stores.length > 1;
  const name = (clientId: string) => view.clientNames[clientId] ?? "A client";
  const noClients = combined.clientCount === 0;
  const choices = stores.map(({ slug, name: storeName }) => ({ slug, name: storeName }));

  return (
    <div className="flex max-w-5xl flex-col gap-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PageHeader
          title={tw.work}
          description={<>{many ? tw.yourClientsHoursAnd : tw.yourClientsTheHours}</>}
        />
        <div className="flex flex-wrap gap-2">
          <NewInStoreButton kind="client" stores={choices} defaultSlug="" primary={false} />
          <NewInStoreButton kind="invoice" stores={choices} defaultSlug="" />
        </div>
      </div>

      {view.missing.length > 0 && (
        <section aria-labelledby="ready-heading" className={`p-4 text-sm ${CARD_CLASS}`}>
          <h2 id="ready-heading" className="mb-2 text-title text-ink">
            {tw.beforeTheFirstInvoice}
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
                  {fillWords(tw.openStoreSettings, { store: store.name })}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {noClients ? (
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
            <NewInStoreButton kind="client" stores={choices} defaultSlug="" />
          </div>
        </section>
      ) : (
        <>
          <Attention items={combined.attention} empty={tw.nothingNeedsYourAttention} />

          {combined.currencies.length > 0 ? (
            <section aria-labelledby="figures-heading" className="flex flex-col gap-4">
              <h2 id="figures-heading" className="text-title text-ink">
                {many ? tw.whereAllStores : tw.whereThingsStand}
              </h2>
              {combined.currencies.map((f) => (
                <Figures key={f.currency} f={f} many={combined.currencies.length > 1} />
              ))}
              {(combined.currencies.length > 1 || many) && <CurrencyNote />}
            </section>
          ) : (
            <Empty>{tw.nothingToCountYet}</Empty>
          )}

          {many && (
            <Section id="stores-heading" title={tw.byStore}>
              <div className={card}>
                <table className={table}>
                  <caption className="sr-only">{tw.workFiguresForEach}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        {tw.store}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.unbilled}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.drafts}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.owed}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.overdue}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.timers}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
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
            title={tw.unbilledTimeByClient}
            action={
              <Link href={`${WORK_ROOT}/time?billing=unbilled`} className="text-sm underline">
                {tw.time}
              </Link>
            }
          >
            {combined.unbilledByClient.length === 0 ? (
              <Empty>{tw.noUnbilledTime}</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        {tw.client}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.time}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.amount}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
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
            title={tw.overdueInvoices}
            action={
              <Link href={`${WORK_ROOT}/invoices?show=overdue`} className="text-sm underline">
                {tw.allOverdue}
              </Link>
            }
          >
            {combined.overdueInvoices.length === 0 ? (
              <Empty>{tw.noInvoiceIsOverdue}</Empty>
            ) : (
              <div className={card}>
                <table className={table}>
                  <thead>
                    <tr>
                      <th scope="col" className={th}>
                        {tw.invoice}
                      </th>
                      <th scope="col" className={th}>
                        {tw.client}
                      </th>
                      <th scope="col" className={th}>
                        {tw.wasDue}
                      </th>
                      <th scope="col" className={`${th} text-right`}>
                        {tw.stillOwed}
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
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

          <Section id="timers-heading" title={tw.runningTimers}>
            {combined.runningTimers.length === 0 ? (
              <Empty>{tw.noTimerIsRunning}</Empty>
            ) : (
              <ul className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
                {combined.runningTimers.map((timer) => {
                  const assignment = view.assignmentNames[timer.assignmentId];
                  return (
                    <li
                      key={`${timer.storeSlug}:${timer.accountId}:${timer.assignmentId}`}
                      className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
                    >
                      <span>
                        {fillWords(tw.isWorkingOn, { name: view.people[timer.accountId] ?? tw.someone })}{" "}
                        <Link
                          href={`${workBase(timer.storeSlug)}/assignments/${timer.assignmentId}`}
                          className="font-medium underline"
                        >
                          {assignment?.name ?? "an assignment"}
                        </Link>
                        {assignment && <span className="text-muted"> for {assignment.clientName}</span>}
                        {many && <span className="text-muted"> ({timer.storeName})</span>}
                      </span>
                      <span className="tabular-nums text-muted">{fillWords(tw.soFar, { time: formatDuration(timer.elapsedMinutes) })}</span>
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
