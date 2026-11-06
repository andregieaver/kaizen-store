import Link from "next/link";

import { ButtonLink, Card } from "@/components/admin/ui";
import { todayList } from "@/lib/activities";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { todayActivities } from "@/server/activities";
import type { Membership } from "@/server/auth";

import { ActivityRow, type ActivityActions } from "./activities-card";
import { activityViews } from "./activity-view";

/**
 * *Today* on the store's home (S3, D468): the viewer's calls, meetings and tasks that are late, due today and done today, each done with
 * one press and linked to its deal or person; the whole team's one step away (Lisa's). Read after the page is shown.
 */
export async function TodayCard({ member, team, lang, done }: { member: Membership; team: boolean; lang: AdminLang; done: ActivityActions["done"] | null }) {
  const { store, account } = member;
  const all = adminText(lang, "deals");
  const w = all.today;
  const now = new Date();
  const list = await todayActivities(store, team ? null : account.id, now);
  const base = `/admin/${store.slug}`;
  const views = new Map(
    activityViews(list, "today", { now, timeZone: store.timeZone, locale: ADMIN_LANG_FACTS[lang].locale, words: all.activities, base, me: account.id }).map((v) => [v.id, v]),
  );
  const sorted = todayList(list, now, store.timeZone);
  const actions = done ? { done } : null;
  const groups = [
    { key: "late", title: w.late, items: sorted.late },
    { key: "due", title: w.due, items: sorted.today },
    { key: "done", title: w.done, items: sorted.done },
  ].filter((g) => g.items.length > 0);
  const toggle = (
    <nav aria-label={w.show} className="flex items-center gap-3 text-sm">
      <Link href={`${base}?today=mine`} aria-current={team ? undefined : "page"} className={team ? "text-ink-2 underline" : "text-ink"}>
        {w.mine}
      </Link>
      <Link href={`${base}?today=team`} aria-current={team ? "page" : undefined} className={team ? "text-ink" : "text-ink-2 underline"}>
        {w.team}
      </Link>
    </nav>
  );
  return (
    <Card title={w.title} compact aside={toggle}>
      {groups.length === 0 ? (
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p className="text-muted">{team ? w.noneTeam : w.none}</p>
          <ButtonLink href={`${base}/deals`} size="dense">
            {w.deals}
          </ButtonLink>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {groups.map((g) => (
            <section key={g.key} aria-labelledby={`today-${g.key}`}>
              <h3 id={`today-${g.key}`} className={`text-sm ${g.key === "late" ? "text-danger-text" : "text-muted"}`}>
                {g.title}
              </h3>
              <ul className="flex flex-col divide-y divide-line">
                {g.items.map((a) => {
                  const view = views.get(a.id);
                  return view ? <ActivityRow key={a.id} activity={view} words={all.activities} actions={actions} team={[]} me={account.id} lateChip={false} /> : null;
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
