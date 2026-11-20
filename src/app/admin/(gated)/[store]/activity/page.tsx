import { zoneOf } from "@/lib/admin-date";
import { CHIP_ITEM, CHIP_STRIP, chosenFirst } from "@/lib/chip-strip";
import type { Metadata } from "next";

import { ActivityFilters, ActivityList, valuesFromQuery } from "@/components/admin/activity-view";
import { activityQuery } from "@/lib/activity-text";
import { isAuditArea } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { activityActions, activityPeople, activityWeek, listActivity, readableAreas } from "@/server/activity";
import Link from "next/link";

import { SelectNav } from "@/components/admin/select-nav";
import { countWords, fillWords } from "@/lib/admin-fill";
import { CARD_CLASS } from "@/components/admin/ui";
import { holderOf } from "@/server/auth";
import { requireMemberAny } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { STAFF_WORDS } from "@/lib/admin-words/staff";

export const metadata: Metadata = { title: "Change log" };

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
  const zone = zoneOf(member.store);
  const lang = adminLangOf(member.account.adminLocale);
  const words = STAFF_WORDS[lang];
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
  const chipClass = (on: boolean) => `${CHIP_ITEM} rounded-pill border px-3 py-1.5 text-sm ${on ? "border-ink bg-ink text-inverse-ink" : "border-line bg-card text-ink"}`;

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
            {/* Round 32 (D706): on a phone the week alone; what is kept and who sees what goes under the list. */}
            <span className="max-sm:hidden">
              {w.leadRest} {owner ? w.ownerSees : w.othersSee}
            </span>
          </span>,
        ]}
      />
      {/* Round 29 (D702): on a phone who and where are one choice each; the chips from the small breakpoint up. */}
      <div className="grid grid-cols-2 gap-2 sm:hidden">
        <SelectNav
          label={w.person}
          options={[
            { label: w.everyone, href: chip({ person: "" }), current: !values.person },
            ...chosenFirst(people.filter((p) => p.current), (p) => values.person === p.accountId).map((p) => ({ label: p.label, href: chip({ person: p.accountId }), current: values.person === p.accountId })),
          ]}
        />
        <SelectNav
          label={w.area}
          options={[
            { label: w.allAreas, href: chip({ area: "" }), current: !values.area },
            ...areas.map((a) => ({ label: words.areas[a], href: chip({ area: a }), current: values.area === a })),
          ]}
        />
      </div>
      <nav aria-label={w.person} className={`${CHIP_STRIP} max-sm:hidden`}>
        <Link href={chip({ person: "" })} aria-current={!values.person ? "page" : undefined} className={chipClass(!values.person)}>
          {w.everyone}
        </Link>
        {chosenFirst(people.filter((p) => p.current).slice(0, 8), (p) => values.person === p.accountId)
          .map((p) => (
            <Link key={p.accountId} href={chip({ person: p.accountId })} aria-current={values.person === p.accountId ? "page" : undefined} className={chipClass(values.person === p.accountId)}>
              {p.label}
            </Link>
          ))}
      </nav>
      <nav aria-label={w.area} className={`${CHIP_STRIP} max-sm:hidden`}>
        <Link href={chip({ area: "" })} aria-current={!values.area ? "page" : undefined} className={chipClass(!values.area)}>
          {w.allAreas}
        </Link>
        {chosenFirst(areas, (a) => values.area === a).map((a) => (
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
      <details className={`px-5 py-3 max-sm:order-last ${CARD_CLASS}`} open={Boolean(values.action || values.from || values.to)}>
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
      <p className="order-last -mt-3 text-caption text-ink-2 sm:hidden">
        {w.leadRest.trim()} {owner ? w.ownerSees : w.othersSee}
      </p>
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
