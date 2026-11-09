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
import { platformSalesView } from "@/server/platform-sales";
import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import type { SalesMonth } from "@/lib/platform-sales";

import { readSalesAction } from "./actions";

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
  const year = new Date().getUTCFullYear();
  const [a, sales] = await Promise.all([planAnalytics(days), platformSalesView(year)]);
  const sw = w.sales;
  const monthName = (month: string) => new Date(`${month}-01T12:00:00Z`).toLocaleDateString(locale, { month: "long", timeZone: "UTC" });
  const cell = "px-3 py-2 text-right tabular-nums whitespace-nowrap";
  // What Kaizena Flow sold (D507): a month a row, each currency apart, the year's totals at the foot.
  const salesTable = (months: SalesMonth[], totals: SalesMonth[]) => (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[40rem] border-collapse text-sm">
        <thead>
          <tr className="border-b border-line text-muted">
            <th scope="col" className="px-3 py-2 text-left font-normal">
              {sw.month}
            </th>
            {[sw.plans, sw.themes, sw.domains, sw.other, sw.vat, sw.total, sw.credited].map((h) => (
              <th key={h} scope="col" className={`${cell} font-normal`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {months.map((m) => (
            <tr key={`${m.month}-${m.currency}`}>
              <th scope="row" className="px-3 py-2 text-left font-normal">
                {monthName(m.month)}
              </th>
              {[m.byKind.plan, m.byKind.theme, m.byKind.domain, m.byKind.other, m.vat, m.total, m.credited].map((v, i) => (
                <td key={i} className={cell}>
                  {formatMoney(v, m.currency, locale)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-line font-medium">
          {totals.map((t) => (
            <tr key={t.currency}>
              <th scope="row" className="px-3 py-2 text-left">
                {sw.year}
              </th>
              {[t.byKind.plan, t.byKind.theme, t.byKind.domain, t.byKind.other, t.vat, t.total, t.credited].map((v, i) => (
                <td key={i} className={cell}>
                  {formatMoney(v, t.currency, locale)}
                </td>
              ))}
            </tr>
          ))}
        </tfoot>
      </table>
    </div>
  );
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

      <Card title={fillWords(sw.title, { year })} description={sw.description}>
        <div className="flex flex-col gap-4">
          {sales.live.months.length === 0 ? <p className="text-sm text-muted">{sw.none}</p> : salesTable(sales.live.months, sales.live.totals)}
          {sales.test.months.length > 0 && (
            <details>
              <summary className="w-fit cursor-pointer text-sm text-muted underline underline-offset-2">{sw.testTitle}</summary>
              <div className="mt-2">{salesTable(sales.test.months, sales.test.totals)}</div>
            </details>
          )}
          <ActionForm action={readSalesAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="year" value={year} />
            <SubmitButton variant="secondary">{sw.read}</SubmitButton>
            <span className="text-sm text-muted">{sw.readHelp}</span>
          </ActionForm>
        </div>
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
