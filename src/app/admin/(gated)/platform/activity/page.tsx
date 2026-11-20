import type { Metadata } from "next";

import { PhoneRow, PhoneRows } from "@/components/admin/phone-row";
import { ActivityFilters, ActivityList, valuesFromQuery } from "@/components/admin/activity-view";
import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { listPlatformActivity, platformActivityFilters } from "@/server/activity";
import { requirePlatformReader } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";
import { PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
import { STAFF_WORDS } from "@/lib/admin-words/staff";

export const metadata: Metadata = { title: "Change log" };

/**
 * What the platform's admins and the platform did, with no store (wave 1, 1f): two-step events, recovery codes used, resets, approvals.
 * Platform admins only. A store's own log is on its own page; nothing of a store is ever here. Its days and times are on the platform's clock
 * (`PLATFORM_TIME_ZONE`, D812), as a store's log is on the store's.
 */
export default async function PlatformActivityPage({ searchParams }: PageProps<"/admin/platform/activity">) {
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_WORDS[lang].activity;
  const staffWords = STAFF_WORDS[lang];
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
  const drawnAt = new Date();
  const ph = w.phone;
  const aw = staffWords.activity;
  const person = choices.people.find((p) => p.accountId === values.person)?.label;
  const area = isAuditArea(values.area) ? staffWords.areas[values.area] : null;
  const period = values.from || values.to ? `${values.from || "…"} – ${values.to || "…"}` : ph.anyTime;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={
          <>
            <span className="sm:hidden">{ph.lead}</span>
            <span className="max-sm:hidden">{w.description}</span>
          </>
        }
      />
      {/* Round 67 (D837): on a phone the five filters sit behind one row that says what is chosen, so the entries start on the first screen. */}
      <PhoneRows>
        <PhoneRow last title={ph.filter} sub={[person ?? aw.everyone, area ?? aw.allAreas, period].join(" · ")} change={ph.change} done={ph.close}>
          <ActivityFilters action={base} values={values} people={choices.people} areas={["platform", "account"]} actions={choices.actions} zoneName={PLATFORM_TIME_ZONE} words={staffWords} />
        </PhoneRow>
      </PhoneRows>
      <ActivityList
        now={drawnAt.getTime()}
        entries={page.entries}
        zone={PLATFORM_TIME_ZONE}
        words={staffWords}
        locale={ADMIN_LANG_FACTS[lang].locale}
        older={page.next === null ? null : `${base}${activityQuery({ person: values.person, area: values.area, action: values.action, from: values.from, to: values.to, before: page.next })}`}
      />
    </div>
  );
}
