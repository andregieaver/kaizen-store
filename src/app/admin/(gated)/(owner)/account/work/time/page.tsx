import type { Metadata } from "next";

import { OwnerTimeView } from "@/components/admin/work/owner-time";
import { OwnerWorkStart } from "@/components/admin/work/owner-settings";
import { todayIn } from "@/lib/work-dates";
import { activeStoreSlug, parseStoreParam, scopeStores, timeVisibility } from "@/lib/work-owner";
import { parseTimeFilters } from "@/lib/work-ui";
import { requireAccount } from "@/server/auth";
import { getOwnerSettings, listOwnerClients, listOwnerPeople, listOwnerTime, workStoresFor } from "@/server/work-owner";

import { switchActionsFor } from "../owner-page";

export const metadata: Metadata = { title: "Time" };

const PAGE_SIZE = 50;

/**
 * The time logged in all the account's stores (D123), newest first: everyone's in the stores the account owns,
 * only its own in the others (the store pages' rule, decided by the membership and never by the address). Totals
 * count everything the filters match, not just the page.
 */
export default async function OwnerTimePage({ searchParams }: PageProps<"/admin/account/work/time">) {
  const account = await requireAccount();
  const { using, off } = await workStoresFor(account);
  if (using.length === 0) {
    const rows = await getOwnerSettings(off);
    return <OwnerWorkStart title="Time" rows={rows} actions={switchActionsFor(rows)} />;
  }
  const query = await searchParams;
  const storeSlug = activeStoreSlug(using, parseStoreParam(query));
  const scoped = scopeStores(using, storeSlug);
  const filters = parseTimeFilters(query);
  const rawPage = Number(Array.isArray(query.page) ? query.page[0] : query.page);
  const page = Number.isInteger(rawPage) && rawPage > 1 ? rawPage : 1;
  const someOwner = timeVisibility(scoped).everyone.length > 0;

  const [list, people, clients] = await Promise.all([
    listOwnerTime(account, scoped, {
      clientId: filters.clientId || undefined,
      assignmentId: filters.assignmentId || undefined,
      accountId: filters.accountId || undefined,
      from: filters.from || undefined,
      to: filters.to || undefined,
      billable: filters.billable === "all" ? undefined : filters.billable === "yes",
      billing: filters.billing,
      query: filters.query,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    someOwner ? listOwnerPeople(scoped) : Promise.resolve(null),
    storeSlug ? listOwnerClients(scoped, { archived: "all" }) : Promise.resolve(null),
  ]);
  return (
    <OwnerTimeView
      stores={using}
      list={list}
      filters={filters}
      storeSlug={storeSlug}
      clients={(clients?.clients ?? []).map((c) => ({ id: c.id, label: c.name }))}
      people={people ? people.map((p) => ({ id: p.id, label: p.name })) : null}
      today={todayIn(scoped[0].timeZone)}
      page={page}
      pageSize={PAGE_SIZE}
      showPerson={someOwner}
    />
  );
}
