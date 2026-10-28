import { formatCount } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { countWords, fillWords } from "@/lib/admin-fill";
import { analyticsEn, type AnalyticsMessages } from "@/lib/admin-messages/analytics.en";
import type { LiveFigures } from "@/server/analytics-live";

import { DataTable, type Column } from "./data-table";
import { KpiCard, type KpiCardProps } from "./kpi-card";

/** A country's name in the admin's language; the code itself when the runtime does not know it. */
function countryName(code: string, locale: string, unknown: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return unknown;
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * The Live page's body (wave 8 unit C, D347): who is in the store now, today so far, carts and checkouts in progress, and where the
 * visitors are by country (a visit keeps no place finer than that, so there is no map). Without visit counting the visitor figures say
 * what is missing and link to switching it on, never a zero. Presentational: the page reads `liveFigures()` and hands them in.
 */
export function LiveView({ base, locale, live, words = analyticsEn }: { base: string; locale: string; live: LiveFigures; words?: AnalyticsMessages }) {
  const w = words.live;
  const off = { text: w.countingOff, action: { label: w.countingLink, href: `${base}/analytics/settings#visits` } };
  const visitorCard = (label: string, value: number | null, help: string, emphasis = false): KpiCardProps =>
    value === null ? { label, value: null, state: "missing", missing: off, help } : { label, value: formatCount(value), help, emphasis };
  const cards: KpiCardProps[] = [
    visitorCard(w.visitorsNow, live.visitorsNow, w.visitorsNowHelp, true),
    visitorCard(w.visitsToday, live.visitsToday, w.visitsTodayHelp),
    { label: w.ordersToday, value: formatCount(live.ordersToday), help: w.ordersTodayHelp, emphasis: true },
    {
      label: w.revenueToday,
      value: formatAmount(live.revenueTodayMinor, live.currency, locale),
      help: fillWords(w.revenueTodayHelp, { currency: live.currency }),
      hint: live.unconverted > 0 ? countWords(live.unconverted, w.unconverted, { n: formatCount(live.unconverted), currencies: live.missingCurrencies.join(", ") }) : undefined,
    },
    { label: w.carts, value: formatCount(live.cartsInUse), help: w.cartsHelp },
    { label: w.checkouts, value: formatCount(live.checkoutsInProgress), help: w.checkoutsHelp },
  ];
  const columns: Column<LiveFigures["byCountry"][number]>[] = [
    { key: "country", label: w.country, cell: (r) => countryName(r.code, locale, w.unknownCountry) },
    { key: "visitors", label: w.visitors, align: "right", cell: (r) => formatCount(r.visitors) },
  ];
  const time = new Intl.DateTimeFormat(locale, { timeStyle: "medium" }).format(new Date(live.at));
  return (
    <div className="flex flex-col gap-6" data-live>
      <p className="text-caption text-muted" aria-live="polite">
        {fillWords(w.updated, { time })}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <KpiCard key={c.label} {...c} />
        ))}
      </div>
      {live.counting ? (
        <div className="space-y-2">
          <h2 className="text-title text-ink">{w.countriesTitle}</h2>
          {live.byCountry.length === 0 ? (
            <p className="text-sm text-muted">{w.noVisitors}</p>
          ) : (
            <DataTable caption={w.countriesCaption} columns={columns} rows={live.byCountry} rowKey={(r) => r.code} exportable={false} exportReason="live.countries" />
          )}
        </div>
      ) : null}
    </div>
  );
}
