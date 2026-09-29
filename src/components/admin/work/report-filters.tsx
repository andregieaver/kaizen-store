import Link from "next/link";

import {
  GROUP_LABELS,
  PRESET_LABELS,
  REPORT_GROUPS,
  REPORT_PRESETS,
  presetPeriod,
  reportQuery,
  type ReportParams,
  type ReportPreset,
} from "@/lib/work-reports";

import { control, primaryButton } from "./work-parts";

const chip = (current: boolean) =>
  `inline-flex min-h-9 items-center rounded-full border border-border px-3 text-sm ${
    current ? "bg-foreground text-background" : "bg-background"
  }`;

/**
 * The report's settings, all in the address so a view can be linked to and printed: the period as presets
 * (this month, last month, this quarter, this year) or a custom first and last day, grouped by client or by
 * assignment, and one client or all. Presets and groups are links; the form is for a custom period and a
 * client, and works without JavaScript. `today` is the store's, so "this month" is its month.
 */
export function ReportFilters({
  base,
  params,
  today,
  clients,
}: {
  /** `/admin/{store}/work/reports`. */
  base: string;
  params: ReportParams;
  today: string;
  clients: { id: string; name: string }[];
}) {
  const link = (change: Partial<Pick<ReportParams, "period" | "by">>) =>
    `${base}${reportQuery({ period: params.period, by: params.by, clientId: params.clientId, ...change })}`;
  return (
    <div className="flex flex-col gap-4">
      <nav aria-label="Period" className="flex flex-wrap gap-2">
        {REPORT_PRESETS.filter((p): p is Exclude<ReportPreset, "custom"> => p !== "custom").map((preset) => (
          <Link
            key={preset}
            href={link({ period: { preset, ...presetPeriod(preset, today) } })}
            aria-current={params.period.preset === preset ? "page" : undefined}
            className={chip(params.period.preset === preset)}
          >
            {PRESET_LABELS[preset]}
          </Link>
        ))}
        <span
          aria-current={params.period.preset === "custom" ? "page" : undefined}
          className={chip(params.period.preset === "custom")}
        >
          {PRESET_LABELS.custom}
        </span>
      </nav>

      <nav aria-label="Group by" className="flex flex-wrap gap-2">
        {REPORT_GROUPS.map((by) => (
          <Link key={by} href={link({ by })} aria-current={params.by === by ? "page" : undefined} className={chip(params.by === by)}>
            {GROUP_LABELS[by]}
          </Link>
        ))}
      </nav>

      <form method="get" action={base} className="flex flex-wrap items-end gap-3" role="search" aria-label="Choose days and client">
        <input type="hidden" name="period" value="custom" />
        {params.by !== "client" && <input type="hidden" name="by" value={params.by} />}
        <label className="flex flex-col gap-1 text-sm font-medium">
          From
          <input type="date" name="from" required defaultValue={params.period.from} className={`${control} font-normal`} />
        </label>
        <label className="flex flex-col gap-1 text-sm font-medium">
          To
          <input type="date" name="to" required defaultValue={params.period.to} className={`${control} font-normal`} />
        </label>
        <label className="flex min-w-40 flex-col gap-1 text-sm font-medium">
          Client
          <select name="client" defaultValue={params.clientId} className={`${control} font-normal`}>
            <option value="">All clients</option>
            {clients.map((client) => (
              <option key={client.id} value={client.id}>
                {client.name}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={primaryButton}>
          Show report
        </button>
      </form>
    </div>
  );
}
