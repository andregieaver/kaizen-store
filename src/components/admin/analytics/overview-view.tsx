import type { Alert } from "@/lib/analytics-alerts";
import type { OverviewData } from "@/server/analytics-totals";
import type { MarketingReport, TrafficReport } from "@/server/analytics-traffic-data";

import { AlertsSection } from "./alerts";
import { AnswerSection, ChannelsSection, ChartsSection, DiagnosisSection, ForecastSection, FunnelSection, OverviewLayout, ProductsSection, TargetSection, type OverviewFrame } from "./overview-sections";
import { type OverviewDiagnosis, type OverviewForecast, type OverviewTarget } from "./overview-text";

/**
 * The Overview's body (D152) from complete data: everything under the page's header, drawn from the report objects it is handed and
 * nothing else (no data access, so it can be rendered on fixture data). It answers three things in order: are we making money (a plain
 * sentence and twelve cards, the first four the main ones), why are sales moving (the charts, the funnel, best sellers, channels), and
 * are we on target. The page itself does not use this: it draws the same sections (`overview-sections.tsx`) in the same order
 * (`OverviewLayout`), each in a `<Suspense>` with its own data (`overview-streams.tsx`), so the first screen does not wait for the rest.
 * The helpers and types the sections share are in `overview-text.ts` and re-exported here.
 */

export { dayText, factorRows, forecastLines, formatTimes, moneyLines, moneyWriter, targetLines } from "./overview-text";
export type { OverviewDiagnosis, OverviewForecast, OverviewTarget } from "./overview-text";

export type OverviewViewProps = {
  /** The store's admin address, `/admin/{store}`. */
  base: string;
  /** The store's main currency: every amount is in it, without VAT. */
  currency: string;
  /** The store's first market's locale, for writing amounts. */
  locale: string;
  /** Only an owner can open Analytics settings. */
  isOwner: boolean;
  data: OverviewData;
  traffic: TrafficReport;
  marketing: MarketingReport;
  target: OverviewTarget;
  /** What needs a look today (`alertsFor()`), most pressing first; empty draws nothing. */
  alerts: readonly Alert[];
  /** Null when the forecast could not be worked out: the section is left out. */
  forecast: OverviewForecast | null;
  /** Null when the explanation could not be worked out: the section is left out. */
  diagnosis: OverviewDiagnosis | null;
};

export function OverviewView({ base, currency, locale, isOwner, data, traffic, marketing, target, alerts, forecast, diagnosis }: OverviewViewProps) {
  const frame: OverviewFrame = { base, currency, locale, isOwner, params: data.params };
  // Counting is the store's setting, which every report carries.
  const visitCounting = traffic.counting;
  return (
    <OverviewLayout
      currency={currency}
      slots={{
        alerts: <AlertsSection alerts={alerts} base={base} />,
        answer: <AnswerSection frame={frame} data={data} visitCounting={visitCounting} />,
        why: <DiagnosisSection frame={frame} diagnosis={diagnosis} />,
        charts: <ChartsSection frame={frame} data={data} />,
        funnel: <FunnelSection frame={frame} traffic={traffic} />,
        products: <ProductsSection frame={frame} top={data.topProducts} />,
        channels: <ChannelsSection frame={frame} marketing={marketing} />,
        target: <TargetSection frame={frame} target={target} />,
        forecast: <ForecastSection frame={frame} forecast={forecast} />,
      }}
    />
  );
}

