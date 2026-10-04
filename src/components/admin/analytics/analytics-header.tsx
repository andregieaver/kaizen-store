import type { ReactNode } from "react";

import { addDays } from "@/lib/analytics-period";
import type { AnalyticsContext } from "@/server/analytics-context";

import { PeriodPicker } from "./period-picker";
import { Note } from "./section";

/**
 * The top of an analytics page (D152): its title and line, the period and comparison picker, what the address was changed to if it
 * had to be, and what the page's figures are in (the store's main currency, without VAT). Every page under Analytics starts with it.
 */
export function AnalyticsHeader({
  ctx,
  path,
  title,
  description,
  picker = true,
  preserve,
  showCompare = true,
  explicitPeriod = false,
  amountsNote,
  children,
}: {
  ctx: AnalyticsContext;
  /** The page's address after the store's (`/analytics/finance`). */
  path: string;
  title: string;
  description?: ReactNode;
  /** A page that is not about a period (the settings) leaves the picker out. */
  picker?: boolean;
  /** Other parameters the page keeps when a period is picked (a sort, a tab). */
  preserve?: Record<string, string>;
  /** False where there is no comparison (the VAT reports): the control, and the words about it, are left out. */
  showCompare?: boolean;
  /** True where the page's own default period is not the default preset (see `PeriodPicker`). */
  explicitPeriod?: boolean;
  /** What the amounts are in, when it is not the usual "main currency without VAT" (the VAT reports show the VAT itself, with it). */
  amountsNote?: string;
  children?: ReactNode;
}) {
  const { params, store } = ctx;
  const { period, compare } = params;
  const lastDay = addDays(period.to, -1);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: store.timeZone }).format(ctx.now);
  return (
    <header className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {picker ? (
        <>
          <PeriodPicker basePath={`${ctx.base}${path}`} preset={period.preset} from={period.from} to={lastDay} compare={compare.mode} preserve={preserve} max={today} showCompare={showCompare} explicitPeriod={explicitPeriod} />
          <p className="text-sm text-muted">
            {period.label}
            {showCompare && compare.previous ? ` · compared with ${compare.previous.label}` : ""}
            {showCompare && compare.lastYear ? ` · compared with ${compare.lastYear.label}` : ""}
            {amountsNote ? ` · ${amountsNote}` : ` · amounts in ${store.markets[0]?.nativeCurrency ?? ""} without VAT`}
          </p>
          {params.notice ? <Note tone="info">{params.notice}</Note> : null}
        </>
      ) : null}
      {children}
    </header>
  );
}
