import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

import { fillWords } from "@/lib/admin-fill";
import { addDays } from "@/lib/analytics-period";
import { analyticsWords } from "@/lib/analytics-words";
import type { AnalyticsContext } from "@/server/analytics-context";
import { PageHeader } from "@/components/admin/ui";

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
  lead,
  compact = false,
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
  /** Round 3 (D603): the page's answer in a sentence, in the header's line. */
  lead?: ReactNode;
  /** Round 3 (D603): the picker folded into one button that names the period, beside the title (the Overview). */
  compact?: boolean;
  children?: ReactNode;
}) {
  const { params, store } = ctx;
  const { period, compare } = params;
  const lastDay = addDays(period.to, -1);
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: store.timeZone }).format(ctx.now);
  const w = analyticsWords().header;
  const picked = (
    <PeriodPicker basePath={`${ctx.base}${path}`} preset={period.preset} from={period.from} to={lastDay} compare={compare.mode} preserve={preserve} max={today} showCompare={showCompare} explicitPeriod={explicitPeriod} />
  );
  if (compact) {
    return (
      <header className="space-y-4">
        <PageHeader
          title={<>{title}</>}
          meta={[lead ?? description]}
          actions={
            picker ? (
              <details className="group relative">
                <summary className="inline-flex h-11 cursor-pointer list-none items-center gap-2 rounded-pill border border-edge bg-card px-4 text-body text-ink hover:bg-sunken [&::-webkit-details-marker]:hidden">
                  {period.label}
                  <ChevronDown aria-hidden className="size-4" />
                </summary>
                <div className="absolute right-0 z-30 mt-2 w-[min(40rem,calc(100vw-2rem))] rounded-panel border border-line bg-card p-4 shadow-[var(--shadow-float)]">{picked}</div>
              </details>
            ) : undefined
          }
        />
        {params.notice ? <Note tone="info">{params.notice}</Note> : null}
        {children}
      </header>
    );
  }
  return (
    <header className="space-y-4">
      <div>
        <PageHeader title={<>{title}</>} />
        {description ? <p className="mt-1 max-w-3xl text-sm text-muted">{description}</p> : null}
      </div>
      {picker ? (
        <>
          {picked}
          <p className="text-sm text-muted">
            {period.label}
            {showCompare && compare.previous ? fillWords(w.comparedWith, { label: compare.previous.label }) : ""}
            {showCompare && compare.lastYear ? fillWords(w.comparedWith, { label: compare.lastYear.label }) : ""}
            {amountsNote ? ` · ${amountsNote}` : fillWords(w.amountsIn, { currency: store.markets[0]?.nativeCurrency ?? "" })}
          </p>
          {params.notice ? <Note tone="info">{params.notice}</Note> : null}
        </>
      ) : null}
      {children}
    </header>
  );
}
