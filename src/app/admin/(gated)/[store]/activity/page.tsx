import type { Metadata } from "next";

import { ActivityFilters, ActivityList, valuesFromQuery } from "@/components/admin/activity-view";
import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { activityActions, activityPeople, activityWeek, listActivity, readableAreas } from "@/server/activity";
import Link from "next/link";
import { countWords, fillWords } from "@/lib/admin-fill";
import { CARD_CLASS } from "@/components/admin/ui";
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
  const [page, people, actions, week] = await Promise.all([listActivity(member, filters, before), activityPeople(member), activityActions(member), activityWeek(member)]);
  const base = `/admin/${member.store.slug}/activity`;
  const owner = can(holderOf(member), "owner");
  const canSee = new Set(readableAreas(member));
  const areas = (["orders", "products", "customers", "marketing", "analytics", "website", "bookings", "support", "settings", "billing", "staff"] as const).filter((a) => owner || canSee.has(a));

  const chip = (next: { person?: string; area?: string }) =>
    `${base}${activityQuery({ person: next.person ?? values.person, area: next.area ?? values.area, action: values.action, from: values.from, to: values.to })}`;
  const chipClass = (on: boolean) => `rounded-pill border px-3 py-1.5 text-sm ${on ? "border-ink bg-ink text-inverse-ink" : "border-line bg-card text-ink"}`;

  const drawnAt = new Date();
  return (
    <div className="flex flex-col gap-6">
      {/* Round 14 (D641): the week in a sentence; who and where as chips; the other filters and the CSV one fold away. */}
      <PageHeader
        title={w.title}
        meta={[
          <span key="lead">
            <span className="text-ink">
              {week.entries === 0
                ? w.leadNone
                : fillWords(w.leadWeek, { entries: countWords(week.entries, w.entriesN), people: countWords(week.people, w.peopleN) })}
            </span>
            {w.leadRest} {owner ? w.ownerSees : w.othersSee}
          </span>,
        ]}
      />
      <nav aria-label={w.person} className="flex flex-wrap gap-2">
        <Link href={chip({ person: "" })} aria-current={!values.person ? "page" : undefined} className={chipClass(!values.person)}>
          {w.everyone}
        </Link>
        {people
          .filter((p) => p.current)
          .slice(0, 8)
          .map((p) => (
            <Link key={p.accountId} href={chip({ person: p.accountId })} aria-current={values.person === p.accountId ? "page" : undefined} className={chipClass(values.person === p.accountId)}>
              {p.label}
            </Link>
          ))}
      </nav>
      <nav aria-label={w.area} className="flex flex-wrap gap-2">
        <Link href={chip({ area: "" })} aria-current={!values.area ? "page" : undefined} className={chipClass(!values.area)}>
          {w.allAreas}
        </Link>
        {areas.map((a) => (
          <Link key={a} href={chip({ area: a })} aria-current={values.area === a ? "page" : undefined} className={chipClass(values.area === a)}>
            {words.areas[a]}
          </Link>
        ))}
      </nav>
      {problem && (
        <p role="alert" className="rounded-panel border border-line bg-card p-3 text-sm">
          {problem}
        </p>
      )}
      <details className={`px-5 py-3 ${CARD_CLASS}`} open={Boolean(values.action || values.from || values.to)}>
        <summary className="flex min-h-10 cursor-pointer items-center text-body text-ink">{w.moreFilters}</summary>
        <div className="pt-3">
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
        </div>
      </details>
      <ActivityList
        now={drawnAt.getTime()}
        entries={page.entries}
        zone={zone}
        words={words}
        locale={ADMIN_LANG_FACTS[lang].locale}
        older={page.next === null ? null : `${base}${activityQuery({ person: values.person, area: values.area, action: values.action, from: values.from, to: values.to, before: page.next })}`}
      />
    </div>
  );
}
