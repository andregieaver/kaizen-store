import type { Metadata } from "next";
import Link from "next/link";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { QuickTimer } from "@/components/admin/work/quick-timer";
import { TimeEntryList } from "@/components/admin/work/time-entry-list";
import { TimeFiltersForm } from "@/components/admin/work/time-filters";
import { WorkOff } from "@/components/admin/work/work-off";
import { todayIn } from "@/lib/work-dates";
import { formatDuration } from "@/lib/work-time";
import { parseTimeFilters, timeFilterQuery } from "@/lib/work-ui";
import { listAssignments, listClients } from "@/server/work";
import { listAssignmentChoices, listPeople } from "@/server/work-choices";
import { listTimeEntries } from "@/server/work-time";
import { workBase } from "@/lib/work-paths";
import { memberCan, requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { workWords } from "@/server/work-words";
import { workText } from "@/lib/work-text";

export const metadata: Metadata = { title: "Time" };

const PAGE_SIZE = 50;

/**
 * Time (D122): the person's timer and the time logged across every assignment,
 * newest first, narrowed by client, assignment, person, days, billable and
 * whether it is on an invoice. Owners see everyone's time; others their own.
 * Totals count everything the filters match, not just the page.
 */
export default async function WorkTimePage({ params, searchParams }: PageProps<"/admin/account/work/s/[store]/time">) {
  await workWords();
  const tw = workText().pageStoreTimePage;
  const viewer = await requirePermission((await params).store, "settings:read");
  const { store, account } = viewer;
  const off = (await workWords()).w.off;
  if (!store.workOn) return <WorkOff storeSlug={store.slug} title={off.titles.time} words={off} />;
  const query = await searchParams;
  const owner = memberCan(viewer, "owner");
  // Others see their own time whatever the address says; the form and the links do not show that as a filter.
  const shown = { ...parseTimeFilters(query), ...(owner ? {} : { accountId: "" }) };
  const filters = owner ? shown : { ...shown, accountId: account.id };
  const rawPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  const pageNo = Number.isInteger(rawPage) && rawPage > 1 ? rawPage : 1;

  const [list, choices, clients, assignments, people] = await Promise.all([
    listTimeEntries(store.id, {
      clientId: filters.clientId || undefined,
      assignmentId: filters.assignmentId || undefined,
      accountId: filters.accountId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      billable: filters.billable === "all" ? undefined : filters.billable === "yes",
      billing: filters.billing,
      query: filters.query,
      limit: PAGE_SIZE,
      offset: (pageNo - 1) * PAGE_SIZE,
    }),
    listAssignmentChoices(store.id),
    listClients(store.id, { archived: "all" }),
    listAssignments(store.id, { status: "all", includeArchivedClients: true }),
    owner ? listPeople(store.id) : Promise.resolve(null),
  ]);

  const base = workBase(store.slug);
  const locale = store.markets[0]?.locale ?? "en";
  const today = todayIn(store.timeZone);
  const { totals } = list;
  const pages = Math.max(1, Math.ceil(totals.count / PAGE_SIZE));
  const link = (n: number) => `${base}/time${timeFilterQuery(shown, n > 1 ? { page: String(n) } : {})}`;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={tw.time}
        description={<>{owner ? tw.timeLoggedByEveryone : tw.yourTime} {tw.startATimer}</>}
      />

      <QuickTimer storeSlug={store.slug} choices={choices} today={today} />

      <TimeFiltersForm
        base={base}
        filters={shown}
        today={today}
        clients={clients.map((c) => ({ id: c.id, label: c.name }))}
        assignments={assignments.map((a) => ({ id: a.id, label: `${a.clientName}: ${a.name}` }))}
        people={people ? people.map((p) => ({ id: p.id, label: p.name })) : null}
      />

      <section aria-labelledby="entries-heading" className="flex flex-col gap-3">
        <h2 id="entries-heading" className="sr-only">
          {tw.loggedTime}
        </h2>
        <StatGrid>
          <Stat label={tw.entries} value={totals.count} />
          <Stat label={tw.time} value={formatDuration(totals.minutes)} />
          <Stat label={tw.billable} value={formatDuration(totals.billableMinutes)} />
          <Stat
            label={tw.notInvoiced}
            value={totals.unbilledMinutes > 0 ? formatDuration(totals.unbilledMinutes) : "Nothing"}
          />
        </StatGrid>
        {list.truncated && (
          <p role="status" className="text-sm text-muted">
            {tw.thereIsMoreTime}
          </p>
        )}
        <TimeEntryList
          storeSlug={store.slug}
          entries={list.entries}
          viewer={{ accountId: account.id, owner }}
          showPerson={owner}
          locale={locale}
          empty={
            totals.count === 0 && pageNo === 1
              ? tw.noTimeMatchesLog
              : tw.thereIsNoTime
          }
        />
        {pages > 1 && (
          <nav aria-label={tw.pagesOfTime} className="flex items-center justify-between gap-3 text-sm">
            {pageNo > 1 ? (
              <Link href={link(pageNo - 1)} className="underline">
                {tw.newer}
              </Link>
            ) : (
              <span />
            )}
            <span className="text-muted">
              Page {pageNo} of {pages}
            </span>
            {pageNo < pages ? (
              <Link href={link(pageNo + 1)} className="underline">
                {tw.older}
              </Link>
            ) : (
              <span />
            )}
          </nav>
        )}
      </section>
    </div>
  );
}
