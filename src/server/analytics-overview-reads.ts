import "server-only";

import type { AnalyticsPeriod } from "@/lib/analytics-period";

import type { StoredAnalyticsSettings } from "./analytics-settings";
import { dailyHistory, type DailyHistory } from "./analytics-insights";
import { marketingReport, trafficReport, type MarketingReport, type TrafficReport } from "./analytics-traffic-data";
import type { Store } from "./stores";

/**
 * The reads the Overview's streamed sections share (D152). Each section loads its own data, in parallel with the others, but a report
 * two sections both need is read once for the request: the daily history (the alerts, the target and the forecast), and the traffic
 * and marketing reports of a period (the funnel and the channels, and the diagnosis, which compares the same period with another).
 * The reads fit `diagnosisFor()`'s `reads` as they are. Nothing is read until a section asks, and a section never waits for a read it did not ask for. Make one per request: the reads are
 * kept for as long as the object is.
 */
export type OverviewReads = {
  /** The daily history, started on the first call and shared after that. */
  history: () => Promise<DailyHistory>;
  traffic: (period: AnalyticsPeriod) => Promise<TrafficReport>;
  marketing: (period: AnalyticsPeriod) => Promise<MarketingReport>;
};

/** A reader of a period's report that reads each period once: the promise is kept, so two askers share one read (and one failure). */
export function oncePerPeriod<T>(read: (period: AnalyticsPeriod) => Promise<T>): (period: AnalyticsPeriod) => Promise<T> {
  const kept = new Map<string, Promise<T>>();
  return (period) => {
    const key = `${period.from}|${period.to}`;
    let promise = kept.get(key);
    if (!promise) kept.set(key, (promise = read(period)));
    return promise;
  };
}

export function overviewReads(store: Store, now: Date, settings: StoredAnalyticsSettings): OverviewReads {
  let history: Promise<DailyHistory> | null = null;
  const traffic = oncePerPeriod((period) => trafficReport(store, period, now));
  const marketing = oncePerPeriod((period) => marketingReport(store, period, now));
  return {
    history: () => (history ??= dailyHistory(store, now, settings)),
    traffic,
    marketing,
  };
}
