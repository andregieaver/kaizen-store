import type { Metadata } from "next";

import { ActivityFilters, ActivityList, valuesFromQuery } from "@/components/admin/activity-view";
import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { activityActions, activityPeople, listActivity, readableAreas } from "@/server/activity";
import { holderOf } from "@/server/auth";
import { requireMemberAny } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

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
  const lang = adminLangOf(member.account.adminLocale);
  const words = adminText(lang, "staff");
  const w = words.activity;
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
  const areas = (["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "support", "settings", "billing", "staff"] as const).filter((a) => owner || canSee.has(a));

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.description} {owner ? w.ownerSees : w.othersSee} {w.kept}</>}
      />
      {problem && (
        <p role="alert" className="rounded-panel border border-line bg-card p-3 text-sm">
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
        words={words}
      />
      <ActivityList
        entries={page.entries}
        zone={zone}
        words={words}
        locale={ADMIN_LANG_FACTS[lang].locale}
        older={page.next === null ? null : `${base}${activityQuery({ person: values.person, area: values.area, action: values.action, from: values.from, to: values.to, before: page.next })}`}
      />
    </div>
  );
}
