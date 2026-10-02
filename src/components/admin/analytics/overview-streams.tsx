import type { ReactNode } from "react";

import { AlertsSection } from "./alerts";
import {
  ChannelsSection,
  DiagnosisSection,
  ForecastSection,
  FunnelSection,
  ProductsSection,
  SectionUnavailable,
  TargetSection,
  type OverviewFrame,
} from "./overview-sections";
import type { OverviewDiagnosis, OverviewForecast, OverviewTarget } from "./overview-text";
import type { AnalyticsContext } from "@/server/analytics-context";
import { alertsForStore, diagnosisFor, forecastForStore, monthTargetMinor, targetFrom, type StoreDiagnosis, type StoreForecast } from "@/server/analytics-insights";
import type { OverviewReads } from "@/server/analytics-overview-reads";
import { topProducts } from "@/server/analytics-totals";

/**
 * The Overview's sections that load their own data (D152), each an async server component for the page to put in a `<Suspense>`. They
 * all start when the page's first screen is drawn and run side by side; the reports two of them need are read once, through the
 * request's `OverviewReads`. A section whose data cannot be read draws a calm note in its own place and the others carry on.
 */

export type StreamProps = {
  ctx: AnalyticsContext;
  frame: OverviewFrame;
  reads: OverviewReads;
};

/** Loads a section's data and draws it; if the read fails, the section says so in its own place and nothing else is touched. */
export async function Streamed<T>({ id, title, load, children }: { id: string; title: string; load: () => Promise<T>; children: (value: T) => ReactNode }) {
  let value: T;
  try {
    value = await load();
  } catch (error) {
    // Only the kind of error is logged: a database message can carry values.
    console.warn(`analytics overview: ${title} could not be read (${error instanceof Error ? error.name : "error"})`);
    return <SectionUnavailable id={id} title={title} />;
  }
  return <>{children(value)}</>;
}

const MONTH_NAME = new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const monthLabel = (monthStart: string) => MONTH_NAME.format(new Date(`${monthStart}T00:00:00Z`));

/** The forecast as the view takes it (words for the month; nothing from the server module's own types). */
export function forecastView(f: StoreForecast | null): OverviewForecast | null {
  return f ? { monthLabel: monthLabel(f.monthStart), forecast: f.forecast, targetMinor: f.targetMinor } : null;
}

/** The diagnosis as the view takes it, with what it is compared with in words. */
export function diagnosisView(d: StoreDiagnosis | null): OverviewDiagnosis | null {
  if (!d) return null;
  return {
    explanation: d.explanation,
    comparedWith: `${d.compare === "year" ? "the same period last year" : "the previous period"} (${d.comparedWith.label})`,
    basis: d.basis,
    notes: d.notes,
  };
}

/** What needs you today. Never throws on its own; an empty list draws nothing. */
export function AlertsStream({ ctx, frame, reads }: StreamProps) {
  return (
    <Streamed id="overview-today" title="Needs you today" load={() => alertsForStore(ctx.store, ctx.now, { history: reads.history() })}>
      {(alerts) => <AlertsSection alerts={alerts} base={frame.base} />}
    </Streamed>
  );
}

/** This month's net revenue against its target, whatever period the page shows: the shared daily history and one read of the target. */
export function TargetStream({ ctx, frame, reads }: StreamProps) {
  const load = async (): Promise<OverviewTarget> => {
    const history = await reads.history();
    const target = await monthTargetMinor(ctx.store, history.today);
    return { monthLabel: monthLabel(`${history.today.slice(0, 7)}-01`), progress: targetFrom(history, target) };
  };
  return (
    <Streamed id="overview-target" title="Target" load={load}>
      {(target) => <TargetSection frame={frame} target={target} />}
    </Streamed>
  );
}

export function ForecastStream({ ctx, frame, reads }: StreamProps) {
  return (
    <Streamed id="overview-forecast" title="Forecast" load={async () => forecastView(await forecastForStore(ctx.store, ctx.now, { history: reads.history() }))}>
      {(forecast) => <ForecastSection frame={frame} forecast={forecast} />}
    </Streamed>
  );
}

/** Why sales changed; the traffic and marketing reports it reads are the funnel's and the channels', read once. */
export function DiagnosisStream({ ctx, frame, reads }: StreamProps) {
  return (
    <Streamed id="overview-why" title="Why did sales change?" load={async () => diagnosisView(await diagnosisFor(ctx.store, ctx.params, ctx.now, reads))}>
      {(diagnosis) => <DiagnosisSection frame={frame} diagnosis={diagnosis} />}
    </Streamed>
  );
}

export function FunnelStream({ ctx, frame, reads }: StreamProps) {
  return (
    <Streamed id="overview-funnel" title="From visit to purchase" load={() => reads.traffic(ctx.params.period)}>
      {(traffic) => <FunnelSection frame={frame} traffic={traffic} />}
    </Streamed>
  );
}

export function ProductsStream({ ctx, frame }: StreamProps) {
  return (
    <Streamed id="overview-products" title="Best sellers" load={() => topProducts(ctx.store, ctx.params.period)}>
      {(top) => <ProductsSection frame={frame} top={top} />}
    </Streamed>
  );
}

export function ChannelsStream({ ctx, frame, reads }: StreamProps) {
  return (
    <Streamed id="overview-channels" title="Where sales come from" load={() => reads.marketing(ctx.params.period)}>
      {(marketing) => <ChannelsSection frame={frame} marketing={marketing} />}
    </Streamed>
  );
}
