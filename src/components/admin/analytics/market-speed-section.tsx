import { adminDate, adminDay } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { MarketCheckMessages } from "@/lib/admin-messages/market-check.en";
import { speedRating, speedText, type SpeedMetric } from "@/lib/site-speed";
import type { KeptSiteSpeed } from "@/server/site-speed";

import { DataTable, StatusPill, type Column, type PillTone } from "./data-table";
import { AnalyticsSection, Note } from "./section";

/**
 * How fast your site is, on Analytics → Markets (D905 M5c, `docs/market-check.md` 7.4): the store's own site and its rivals' by Google's
 * three Core Web Vitals, as Chrome's users met them over 28 days (the 75th percentile), each rated by Google's thresholds in code
 * (`speedRating()`). Read monthly by the dispatcher while the platform's key is set. Drawn on the server; nothing here is a form.
 */

export type MarketSpeedProps = {
  lang: AdminLang;
  locale: string;
  timeZone: string;
  words: MarketCheckMessages["speed"];
  sites: readonly KeptSiteSpeed[];
  /** Whether the platform's Chrome UX Report key is set: no site is read until it is. */
  keySet: boolean;
};

const TONE: Record<"good" | "needs" | "poor", PillTone> = { good: "good", needs: "warning", poor: "bad" };

export function MarketSpeedSection({ lang, locale, timeZone, words: w, sites, keySet }: MarketSpeedProps) {
  const figure = (metric: SpeedMetric, s: KeptSiteSpeed) => {
    const value = s[metric];
    if (!s.checkedAt || value === null) return <span className="text-muted">—</span>;
    const rating = speedRating(metric, value);
    return <StatusPill tone={TONE[rating]}>{`${speedText(metric, value, locale)} · ${w.ratings[rating]}`}</StatusPill>;
  };
  const columns: Column<KeptSiteSpeed>[] = [
    { key: "site", label: w.site, cell: (s) => <span>{s.rivalName ? `${s.rivalName} (${s.host})` : `${w.you} (${s.host})`}</span> },
    { key: "lcp", label: w.lcp, cell: (s) => figure("lcp", s) },
    { key: "inp", label: w.inp, cell: (s) => figure("inp", s) },
    { key: "cls", label: w.cls, cell: (s) => figure("cls", s) },
    {
      key: "measured",
      label: w.measured,
      cell: (s) =>
        s.checkedAt && s.periodEnd ? (
          <span>{adminDay(s.periodEnd, "day", lang)}</span>
        ) : (
          <span className="text-muted">{s.problem === "none" ? w.none : s.problem === "failed" ? fillWords(w.failed, { date: adminDate(timeZone, s.triedAt, "day", lang) }) : w.waiting}</span>
        ),
    },
  ];
  return (
    <AnalyticsSection id="market-speed" title={w.title} description={w.description} level={3}>
      {keySet ? null : <Note>{w.noKey}</Note>}
      {sites.length > 0 ? <DataTable caption={w.caption} columns={columns} rows={sites} rowKey={(s) => s.host} exportable={false} exportReason="markets.speed" /> : null}
    </AnalyticsSection>
  );
}
