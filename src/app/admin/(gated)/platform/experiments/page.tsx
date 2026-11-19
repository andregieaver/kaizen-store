import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import type { TargetKind } from "@/lib/ab-site";
import { adminDate, adminDay, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { STATE_SIGNAL } from "@/lib/experiment-list";
import { targetLabelText } from "@/lib/experiment-words";
import { GOAL_WORDS } from "@/lib/experiments";
import { daysBetween } from "@/lib/platform-experiments";
import { requirePlatformReader } from "@/server/auth";
import { platformExperiments } from "@/server/platform-experiments";
import { platformUnitTests } from "@/server/platform-unit-tests";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { Card, CARD_CLASS, Chip, List, ListRow, MiniBar, PageHeader, RowFact, RowLead } from "@/components/admin/ui";

export const metadata: Metadata = { title: "A/B tests" };


/**
 * Every store's A/B tests (D148, phase 5): what is running, what waits for a decision and what needs a look. Read-only: a
 * platform admin spots a stuck or harmful test here and tells the store; the store's owner changes it.
 */
export default async function PlatformExperimentsPage({ searchParams }: PageProps<"/admin/platform/experiments">) {
  await connection();
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "platformTools").experiments;
  const ex = adminText(lang, "experiments");
  const { show } = await searchParams;
  const everything = show === "all";
  const [{ tests, overview, truncated }, own] = await Promise.all([platformExperiments(everything), platformUnitTests()]);
  const now = new Date();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={<>{w.intro}</>}
      />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          [w.running, overview.running, countWords(overview.stores, w.inStores)],
          [w.scheduled, overview.scheduled, w.waitingStart],
          [w.stopped, overview.stopped, w.waitingDecision],
          [w.needLook, overview.needAttention, w.seeNotes],
        ].map(([label, value, note]) => (
          <div key={label} className={`p-4 ${CARD_CLASS}`}>
            <dt className="text-sm text-muted">{label}</dt>
            <dd className="text-metric text-ink tabular-nums">{value}</dd>
            <dd className="text-xs text-muted">{note}</dd>
          </div>
        ))}
      </dl>

      <div className="flex items-center gap-3 text-sm">
        <Link href="/admin/platform/experiments" aria-current={everything ? undefined : "page"} className={everything ? "underline" : "font-medium"}>
          {w.active}
        </Link>
        <Link href="/admin/platform/experiments?show=all" aria-current={everything ? "page" : undefined} className={everything ? "font-medium" : "underline"}>
          {w.everything}
        </Link>
      </div>

      {tests.length === 0 ? (
        <p className={`p-8 text-center text-sm text-muted ${CARD_CLASS}`}>
          {everything ? w.noneEver : w.noneActive}
        </p>
      ) : (
        <Card compact>
          <List label={w.list}>
            {tests.map((t) => (
              <ListRow key={t.id}>
                <RowLead
                  title={t.name}
                  sub={
                    <>
                      <Link href={`/admin/platform/stores/${t.store.slug}`} className="underline-offset-2 hover:underline">
                        {t.store.name}
                      </Link>
                      {" · "}
                      {/* Named as the store's own list names it: the address, the place (All products page), or the kind and its title. */}
                      {targetLabelText(t.target.type as TargetKind, t.target.slug, t.target.title, t.target.role, ex)} · {fillWords(w.versions, { n: t.versions })} · {ex.goals[t.goal]?.label ?? GOAL_WORDS[t.goal].label}
                      {t.headline && <span className="block text-ink-2">{t.headline}</span>}
                      {t.flags.map((f) => (
                        <span key={f.kind} className="block text-danger-text">
                          {f.words}
                        </span>
                      ))}
                    </>
                  }
                />
                <RowFact
                  className="hidden sm:block"
                  sub={t.card.state === "learning" && t.status === "running" && t.card.progress.readyAround ? fillWords(ex.list.readyAround, { date: adminDay(t.card.progress.readyAround, "day", lang) }) : undefined}
                >
                  {t.card.state === "learning" && t.status === "running" ? (
                    <span className="flex items-center gap-2" aria-label={ex.list.progress}>
                      <MiniBar share={t.card.progress.share} signal="warning" />
                      {fillWords(ex.list.dayOf, { days: t.card.progress.days, min: t.card.progress.minDays })}
                    </span>
                  ) : t.startedAt ? (
                    fillWords(w.days, { n: daysBetween(t.startedAt, t.stoppedAt ?? now) })
                  ) : t.scheduledStart ? (
                    fillWords(w.starts, { date: adminDate(PLATFORM_TIME_ZONE, t.scheduledStart, "day", lang) })
                  ) : (
                    w.notStarted
                  )}
                </RowFact>
                <RowFact className="hidden sm:block" sub={t.split ? t.split.map((s) => `${s.key.toUpperCase()} ${s.visitors.toLocaleString(locale)}`).join(" · ") : undefined}>
                  {countWords(t.exposed, w.visitors, { n: t.exposed.toLocaleString(locale) })}
                </RowFact>
                <Chip signal={STATE_SIGNAL[t.card.state]} dot>
                  {ex.card.states[t.card.state]}
                  {t.status === "applied" && t.appliedVariant ? `: ${t.appliedVariant.toUpperCase()}` : ""}
                  {t.stopReason === "guardrail" && t.status === "stopped" && w.guardrail}
                </Chip>
              </ListRow>
            ))}
          </List>
        </Card>
      )}
      {truncated && <p className="text-sm text-muted">{w.newest}</p>}

      <section aria-labelledby="own" className="flex flex-col gap-3">
        <div>
          <h2 id="own" className="text-title text-ink">
            {w.own}
          </h2>
          <p className="max-w-2xl text-sm text-muted">{w.ownText}</p>
        </div>
        {own.length === 0 ? (
          <p className={`p-6 text-center text-sm text-muted ${CARD_CLASS}`}>
            {w.noOwn}
          </p>
        ) : (
          <ul className={`flex flex-col divide-y divide-line ${CARD_CLASS}`}>
            {own.map((t) => (
              <li key={t.id} className="flex flex-col gap-1 px-4 py-3 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-medium">
                    {t.name}
                    {t.store && (
                      <>
                        {" · "}
                        <Link href={`/admin/platform/stores/${t.store.slug}`} className="underline-offset-2 hover:underline">
                          {t.store.name}
                        </Link>
                      </>
                    )}
                  </span>
                  <span className="text-xs text-muted">
                    {t.kind === "search" ? (t.status === "running" ? fillWords(w.runningSince, { date: adminDate(PLATFORM_TIME_ZONE, t.startedAt ?? now, "day", lang) }) : w.ended) : w.allTheTime}
                  </span>
                </div>
                <span>{t.headline}</span>
                <span className="text-xs text-muted">{t.detail}</span>
                {t.flags.length > 0 && (
                  <ul className="list-disc pl-4 text-xs text-danger-text">
                    {t.flags.map((f) => (
                      <li key={f.kind}>{f.words}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
