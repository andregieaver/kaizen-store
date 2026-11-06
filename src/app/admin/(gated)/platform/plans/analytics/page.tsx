import type { Metadata } from "next";
import { connection } from "next/server";

import { Stat, StatGrid } from "@/components/admin/overview-parts";
import { Card, PageHeader } from "@/components/admin/ui";
import { ShareBar } from "@/components/admin/ui/bars";
import { countWords, fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { formatMoney } from "@/lib/money";
import { share, type CurrencyFigure, type MovementFigure, type PlanSummary } from "@/lib/plan-analytics";
import { requirePlatformAdmin } from "@/server/auth";
import { planAnalytics } from "@/server/plan-analytics";

export const metadata: Metadata = { title: "Plan analytics" };

const PERIODS = [30, 90, 365] as const;

/**
 * Analytics of Kaizena Flow's plans (C2 of `docs/platform-parity-plan.md`, D470): what the stores' plans earn every month, how that moved,
 * and the way from an application to a paying store. Homer reads the first row; Lisa chooses the period, reads each plan and the test mode.
 */
export default async function PlanAnalyticsPage({ searchParams }: PageProps<"/admin/platform/plans/analytics">) {
  await connection();
  const admin = await requirePlatformAdmin();
  const lang = adminLangOf(admin.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "console").planAnalytics;
  const asked = Number((await searchParams).days);
  const days = (PERIODS as readonly number[]).includes(asked) ? asked : 30;
  const a = await planAnalytics(days);
  const money = (list: CurrencyFigure[]) => (list.length === 0 ? formatMoney(0, "NOK", locale) : list.map((f) => formatMoney(f.mrrMinor, f.currency, locale)).join(" · "));
  // The tile's figure: each currency on a line of its own, in whole units (the lines below keep the øre).
  const whole = (f: CurrencyFigure) => formatMoney(Math.round(f.mrrMinor / 100) * 100, f.currency, locale, { decimals: "hide_whole" });
  const tile = (list: CurrencyFigure[]) =>
    list.length === 0 ? (
      formatMoney(0, "NOK", locale, { decimals: "hide_whole" })
    ) : (
      <span className="flex flex-col">
        {list.map((f) => (
          <span key={f.currency} className="whitespace-nowrap">
            {whole(f)}
          </span>
        ))}
      </span>
    );
  const moved = (list: MovementFigure[]) => list.filter((m) => m.count > 0);
  const since = a.since ? new Date(a.since).toLocaleDateString(locale, { dateStyle: "medium", timeZone: "Europe/Oslo" }) : null;

  const summary = (s: PlanSummary) => (
    <StatGrid>
      <Stat label={w.mrr} value={tile(s.mrr)} sub={w.mrrSub} />
      <Stat label={w.paying} value={s.paying} sub={s.late > 0 ? fillWords(w.late, { n: s.late }) : undefined} />
      <Stat label={w.trialing} value={s.trialing} />
      <Stat label={w.cancelling} value={s.cancelling} sub={w.cancellingSub} />
    </StatGrid>
  );

  return (
    <div className="flex flex-col gap-8">
      <PageHeader title={w.title} description={w.description} />

      <nav aria-label={w.period} className="flex flex-wrap gap-2">
        {PERIODS.map((d) => (
          <a
            key={d}
            href={`/admin/platform/plans/analytics?days=${d}`}
            aria-current={d === a.days ? "page" : undefined}
            className={`inline-flex min-h-10 items-center rounded-pill border px-4 text-sm ${d === a.days ? "border-ink bg-ink text-canvas" : "border-edge bg-card hover:bg-sunken"}`}
          >
            {fillWords(w.days, { n: d })}
          </a>
        ))}
      </nav>

      <section aria-labelledby="live-heading" className="flex flex-col gap-4">
        <h2 id="live-heading" className="text-title text-ink">
          {w.live}
        </h2>
        {summary(a.live)}
      </section>

      <Card title={fillWords(w.funnelTitle, { n: a.days })} description={w.funnelDescription}>
        <div className="flex flex-col gap-3">
          {(
            [
              [w.asked, a.funnel.asked],
              [w.approved, a.funnel.approved],
              [w.opened, a.funnel.opened],
              [w.payingStep, a.funnel.paying],
            ] as const
          ).map(([label, n]) => (
            <ShareBar key={label} label={label} figure={n} share={(share(n, a.funnel.asked) ?? 0) / 100} signal="positive" />
          ))}
        </div>
      </Card>

      <Card title={fillWords(w.movesTitle, { n: a.days })} description={since ? fillWords(w.movesSince, { date: since }) : w.movesNone}>
        {moved(a.moves.live).length === 0 ? (
          <p className="text-sm text-muted">{w.noMoves}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {moved(a.moves.live).map((m) => (
              <li key={m.kind} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>
                  {w.kinds[m.kind]} · {m.count}
                </span>
                <span className="tabular-nums text-ink-2">
                  {m.byCurrency.map((c) => `${c.deltaMinor > 0 ? "+" : ""}${formatMoney(c.deltaMinor, c.currency, locale)}`).join(" · ")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title={w.byPlanTitle} description={w.byPlanDescription}>
        {a.live.byPlan.length === 0 ? (
          <p className="text-sm text-muted">{w.noPlans}</p>
        ) : (
          <ul className="flex flex-col divide-y divide-line">
            {a.live.byPlan.map((p) => (
              <li key={p.plan} className="flex flex-wrap items-baseline justify-between gap-2 py-2 text-sm">
                <span>
                  {p.plan} · {countWords(p.stores, w.stores)}
                </span>
                <span className="tabular-nums text-ink-2">{money(p.mrr)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {(a.test.paying > 0 || a.test.trialing > 0) && (
        <section aria-labelledby="test-heading" className="flex flex-col gap-4">
          <h2 id="test-heading" className="text-title text-ink">
            {w.test}
          </h2>
          <p className="text-sm text-muted">{w.testText}</p>
          {summary(a.test)}
        </section>
      )}
    </div>
  );
}
