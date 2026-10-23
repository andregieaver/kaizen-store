import type { Metadata } from "next";

import { ActivityFilters, ActivityList, valuesFromQuery } from "@/components/admin/activity-view";
import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { listPlatformActivity, platformActivityFilters } from "@/server/activity";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Activity log" };

/**
 * What the platform's admins and the platform did, with no store (wave 1, 1f): two-step events, recovery codes used, resets, approvals.
 * Platform admins only. A store's own log is on its own page; nothing of a store is ever here.
 */
export default async function PlatformActivityPage({ searchParams }: PageProps<"/admin/platform/activity">) {
  const account = await requirePlatformAdmin();
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "platform").activity;
  const staffWords = adminText(lang, "staff");
  const query = await searchParams;
  const values = valuesFromQuery(query);
  const before = typeof query.before === "string" && /^\d{1,15}$/.test(query.before) ? Number(query.before) : null;
  const [page, choices] = await Promise.all([
    listPlatformActivity(
      { accountId: values.person || null, area: isAuditArea(values.area) ? values.area : null, action: values.action || null, from: values.from || null, to: values.to || null },
      before,
    ),
    platformActivityFilters(),
  ]);
  const base = "/admin/platform/activity";
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={w.description}
      />
      <ActivityFilters action={base} values={values} people={choices.people} areas={["platform", "account"]} actions={choices.actions} zoneName="UTC" words={staffWords} />
      <ActivityList
        entries={page.entries}
        zone="UTC"
        words={staffWords}
        older={page.next === null ? null : `${base}${activityQuery({ person: values.person, area: values.area, action: values.action, from: values.from, to: values.to, before: page.next })}`}
      />
    </div>
  );
}
