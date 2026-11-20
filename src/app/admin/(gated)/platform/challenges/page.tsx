import type { Metadata } from "next";
import { connection } from "next/server";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { ButtonLink, Card, Chip, KpiTile, PageHeader } from "@/components/admin/ui";
import { adminDate, PLATFORM_TIME_ZONE } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf, type AdminLang } from "@/lib/admin-lang";
import type { ConsoleMessages } from "@/lib/admin-messages/console.en";
import { STAFF_EMAILS_WORDS } from "@/lib/admin-words/staff-emails";
import { formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { budgetShare, waitedHours, type ChallengePhase } from "@/lib/challenge-console";
import { INTERVENTION_CLASSES } from "@/lib/interventions";
import { CONSOLE_WORDS } from "@/lib/admin-words/console";
import { requirePlatformReader } from "@/server/auth";
import { challengeStores, type ChallengeStore, type Queue } from "@/server/challenge-console";

import { endChallengeAction } from "./actions";
import { ChallengeForm } from "./challenge-form";

export const metadata: Metadata = { title: "100-day challenge" };

const SIGNAL: Record<ChallengePhase, "positive" | "warning" | "neutral"> = { on: "positive", rehearsal: "warning", upcoming: "neutral", ended: "neutral" };

/**
 * The 100-day challenge's console (`docs/100-day-challenge.md` H2, D613): every store with a challenge, running first. For each its phase and
 * day, what holds it up (the stall watch, A6), what waits on its owner and since when, the autopilot's AI cost this month against the
 * challenge's budget, what people did by class (A5) and the three ratios since Day 1 (3.3); setting, changing and ending a challenge (an
 * owner of the platform; every role reads).
 */
export default async function PlatformChallengesPage() {
  await connection();
  const admin = await requirePlatformReader();
  const lang = adminLangOf(admin.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = CONSOLE_WORDS[lang].challenges;
  const stores = await challengeStores();
  const canWrite = admin.platformAdmin;
  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />
      {stores.length === 0 && <p className="text-body text-muted">{w.none}</p>}
      {stores.map((s) => (
        <StoreCard key={s.storeId} s={s} w={w} lang={lang} locale={locale} canWrite={canWrite} />
      ))}
      {canWrite && (
        <Card title={w.setTitle} description={w.setText}>
          <ChallengeForm w={w} />
        </Card>
      )}
    </div>
  );
}

function StoreCard({ s, w, lang, locale, canWrite }: { s: ChallengeStore; w: ConsoleMessages["challenges"]; lang: AdminLang; locale: string; canWrite: boolean }) {
  const now = new Date();
  const stallWords = STAFF_EMAILS_WORDS[lang].challengeStall.kinds;
  const usd = (micros: number) => new Intl.NumberFormat(locale, { style: "currency", currency: "USD" }).format(micros / 1_000_000);
  const share = budgetShare(s.ai.spentMicros, s.ai.budgetUsd);
  const queue = (q: Queue) => (q.count === 0 ? w.queueEmpty : fillWords(w.queueCount, { n: q.count, hours: waitedHours(q.oldestAt, now) ?? 0 }));
  const r = s.ratios;
  const money = (minor: number | null) => (minor === null || !r ? null : formatAmount(minor, r.currency, locale));
  return (
    <Card
      title={s.name}
      aside={
        <span className="flex flex-wrap items-center gap-2">
          <Chip signal={SIGNAL[s.phase]} dot>
            {w.phases[s.phase]}
          </Chip>
          {s.day !== null && s.phase === "on" && <span className="text-sm text-ink-2 tabular-nums">{fillWords(w.day, { day: s.day })}</span>}
        </span>
      }
      description={fillWords(w.dates, { starts: s.challenge.startsOn, ends: s.challenge.endsOn, dayOne: s.challenge.dayOne })}
    >
      <div className="flex flex-col gap-6">
        {s.paused && <p className="text-body text-danger-text">{w.pausedNote}</p>}

        <section aria-label={w.stalls}>
          <h3 className="mb-2 text-sm font-medium text-ink">{w.stalls}</h3>
          {s.stalls.length === 0 ? (
            <p className="text-body text-ink-2">{w.noStalls}</p>
          ) : (
            <ul className="flex list-disc flex-col gap-1 pl-5 text-body text-danger-text">
              {s.stalls.map((st) => (
                <li key={`${st.kind}:${st.ref}`}>{fillWords(stallWords[st.kind], { store: s.name, count: String(st.count) })}</li>
              ))}
            </ul>
          )}
        </section>

        <div className="grid gap-6 md:grid-cols-2">
          <section aria-label={w.waiting}>
            <h3 className="mb-2 text-sm font-medium text-ink">{w.waiting}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
              {(["decisions", "escalations", "faults"] as const).map((k) => (
                <div key={k} className="contents">
                  <dt className="text-ink-2">{w.queues[k]}</dt>
                  <dd className="text-ink tabular-nums">{queue(s.queues[k])}</dd>
                </div>
              ))}
            </dl>
          </section>
          <section aria-label={w.people}>
            <h3 className="mb-2 text-sm font-medium text-ink">{w.people}</h3>
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-body">
              {INTERVENTION_CLASSES.map((cls) => (
                <div key={cls} className="contents">
                  <dt className="text-ink-2">{w.classes[cls]}</dt>
                  <dd className={`tabular-nums ${cls === "other" && s.interventions.other > 0 ? "text-danger-text" : "text-ink"}`}>{s.interventions[cls]}</dd>
                </div>
              ))}
            </dl>
            {s.other.length > 0 && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-danger-text">{w.otherTitle}</summary>
                <ul className="mt-1 flex flex-col gap-0.5 text-ink-2">
                  {s.other.slice(-20).map((o) => (
                    <li key={`${o.ref}:${o.at}`} className="font-mono">
                      {adminDate(PLATFORM_TIME_ZONE, o.at, "dayTime", lang)} · {o.what}
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>

        <section aria-label={w.watch.title}>
          <h3 className="mb-2 text-sm font-medium text-ink">{w.watch.title}</h3>
          {s.rolledBack.length === 0 ? (
            <p className="text-body text-ink-2">{w.watch.none}</p>
          ) : (
            <ul className="flex flex-col gap-2 text-sm text-ink-2">
              {s.rolledBack.slice(0, 5).map((r) => (
                <li key={`${r.at}:${r.tool}`}>
                  <span className="tabular-nums">{adminDate(PLATFORM_TIME_ZONE, r.at, "dayTime", lang)}</span> · <span className="font-mono">{r.tool}</span> · {r.words}{" "}
                  <span className={r.undone.length > 0 ? "text-ink" : "text-warning-text"}>
                    {r.undone.length > 0 ? fillWords(w.watch.undone, { what: r.undone.join(", ") }) : w.watch.notUndone}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label={w.pin.title}>
          <h3 className="mb-2 text-sm font-medium text-ink">{w.pin.title}</h3>
          {s.challenge.pinned ? (
            <>
              <p className="text-body text-ink-2">
                {fillWords(w.pin.pinned, {
                  date: adminDate(PLATFORM_TIME_ZONE, s.challenge.pinned.at, "day", lang),
                  model: s.challenge.pinned.model ?? w.pin.noModel,
                  tools: s.challenge.pinned.tools,
                })}
              </p>
              {s.challenge.versionLog.length === 0 ? (
                <p className="text-body text-ink-2">{w.pin.unchanged}</p>
              ) : (
                <>
                  <p className="mt-1 text-body text-warning-text">{w.pin.changed}</p>
                  <ul className="mt-1 flex flex-col gap-0.5 text-sm text-ink-2">
                    {s.challenge.versionLog.slice(-5).map((entry) => (
                      <li key={`${entry.at}:${entry.what}`}>
                        <span className="tabular-nums">{adminDate(PLATFORM_TIME_ZONE, entry.at, "dayTime", lang)}</span> · {entry.what}
                      </li>
                    ))}
                  </ul>
                  {s.challenge.versionLog.length > 5 && <p className="text-caption text-muted">{fillWords(w.pin.more, { n: s.challenge.versionLog.length - 5 })}</p>}
                </>
              )}
            </>
          ) : (
            <p className="text-body text-muted">{w.pin.notPinned}</p>
          )}
        </section>

        <section aria-label={w.ai}>
          <h3 className="mb-2 text-sm font-medium text-ink">{w.ai}</h3>
          <p className="text-body text-ink-2 tabular-nums">{fillWords(w.aiSpent, { spent: usd(s.ai.spentMicros), budget: usd(s.ai.budgetUsd * 1_000_000), share: formatPercent(share, 0) })}</p>
          {s.ai.unpriced > 0 && <p className="mt-1 text-body text-danger-text">{fillWords(w.aiUnpriced, { n: s.ai.unpriced })}</p>}
        </section>

        <section aria-label={w.margin}>
          {r ? (
            <>
              <h3 className="mb-2 text-sm font-medium text-ink">{fillWords(w.ratios, { from: r.from, to: r.to })}</h3>
              <div className="grid gap-3 sm:grid-cols-3">
                <KpiTile label={w.margin} value={r.margin === null ? null : formatPercent(r.margin, 1)} context={r.margin === null ? w.notMeasured : undefined} />
                <KpiTile
                  label={w.perKrone}
                  value={r.perKrone === null ? null : r.perKrone.toLocaleString(locale, { maximumFractionDigits: 2, minimumFractionDigits: 2 })}
                  context={r.perKrone === null ? w.notMeasured : undefined}
                />
                <KpiTile label={w.perVisitor} value={money(r.perVisitorMinor)} context={r.perVisitorMinor === null ? w.notMeasured : undefined} />
              </div>
              <p className="mt-2 text-caption text-muted tabular-nums">
                {fillWords(w.totals, { sales: money(r.netRevenueMinor) ?? "", marketing: money(r.marketingMinor) ?? "", orders: r.orders })}
              </p>
            </>
          ) : (
            <p className="text-body text-muted">{s.phase === "upcoming" || s.phase === "rehearsal" ? w.ratiosBefore : w.ratiosFailed}</p>
          )}
        </section>

        <div className="flex flex-wrap items-start gap-3">
          <ButtonLink href={`/admin/platform/challenges/${s.storeId}`} kind="main">
            {w.openBoard}
          </ButtonLink>
          <ButtonLink href={`/admin/${s.slug}/assistant/autopilot`}>{w.openAutopilot}</ButtonLink>
          {canWrite && (
            <ActionForm action={endChallengeAction.bind(null, s.storeId)} successMessage={w.ended}>
              <SubmitButton variant="secondary">{w.end}</SubmitButton>
            </ActionForm>
          )}
        </div>
        {canWrite && (
          <details>
            <summary className="cursor-pointer text-sm text-ink-2">{w.change}</summary>
            <div className="mt-3">
              <ChallengeForm w={w} store={s.slug} current={s.challenge} />
            </div>
          </details>
        )}
      </div>
    </Card>
  );
}
