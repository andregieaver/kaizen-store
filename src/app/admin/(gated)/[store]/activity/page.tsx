import type { Metadata } from "next";

import { ActivityFilters, ActivityList, valuesFromQuery } from "@/components/admin/activity-view";
import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { activityActions, activityPeople, listActivity, readableAreas } from "@/server/activity";
import { holderOf } from "@/server/auth";
import { requireMemberAny } from "@/server/permissions";

export const metadata: Metadata = { title: "Activity log" };

/**
 * Who did what, and when (wave 1, 1f, docs/wave-1-trust.md 2.9). Every member opens it: an owner sees every entry of the store, anyone else the
 * areas they can read and their own. Filters are in the address, so a filtered log is a link; owners can download it as CSV.
 */
export default async function ActivityPage({ params, searchParams }: PageProps<"/admin/[store]/activity">) {
  const member = await requireMemberAny((await params).store);
  const query = await searchParams;
  const values = valuesFromQuery(query);
  const before = typeof query.before === "string" && /^\d{1,15}$/.test(query.before) ? Number(query.before) : null;
  const problem = typeof query.problem === "string" ? query.problem.slice(0, 300) : "";
  const zone = member.store.timeZone || "Europe/Oslo";
  const filters = {
    accountId: values.person || null,
    area: isAuditArea(values.area) ? values.area : null,
    action: values.action || null,
    from: values.from || null,
    to: values.to || null,
  };
  const [page, people, actions] = await Promise.all([listActivity(member, filters, before), activityPeople(member), activityActions(member)]);
  const base = `/admin/${member.store.slug}/activity`;
  const owner = can(holderOf(member), "owner");
  const canSee = new Set(readableAreas(member));
  const areas = (["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "settings", "billing", "staff"] as const).filter((a) => owner || canSee.has(a));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Activity log</h1>
        <p className="max-w-2xl text-sm text-muted">
          What people changed in the store, and when: products, prices, pages, coupons, shipping, the team and the payment settings.{" "}
          {owner ? "You see every entry." : "You see your own entries and those of the parts of the admin you can open."} Entries are kept for 24 months and cannot be changed.
        </p>
      </div>
      {problem && (
        <p role="alert" className="rounded-lg border border-border bg-background p-3 text-sm">
          {problem}
        </p>
      )}
      <ActivityFilters
        action={base}
        values={values}
        people={people}
        areas={areas}
        actions={actions}
        exportAction={owner ? `${base}/export` : undefined}
        zoneName={zone}
      />
      <ActivityList
        entries={page.entries}
        zone={zone}
        older={page.next === null ? null : `${base}${activityQuery({ person: values.person, area: values.area, action: values.action, from: values.from, to: values.to, before: page.next })}`}
      />
    </div>
  );
}
