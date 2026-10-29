import type { Metadata } from "next";
import Link from "next/link";

import { OwnSpeedView } from "@/components/admin/own-speed-view";
import { ButtonLink, Card, PageHeader } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { formatUsage } from "@/lib/usage-format";
import { USAGE_METRIC_IDS, type UsageMetric } from "@/lib/usage-metrics";
import { shiftMonth, usageMonth } from "@/lib/usage-month";
import { requirePlatformAdmin } from "@/server/auth";
import { upcomingPeaks } from "@/server/capacity-events";
import { databaseGlance, drainConnected, platformUsage } from "@/server/usage";
import { cronJobRows } from "@/server/cron-runs";
import { ownSpeedReport } from "@/server/own-speed";
import { cronHealth } from "@/lib/cron-health";

export const metadata: Metadata = { title: "Usage and limits" };

const BASE = "/admin/platform/capacity";

/**
 * Every store's usage this month (D314, `docs/capacity.md` step 1.6): one row per store, Kaizena Flow's own site first, metrics in
 * columns to compare, sortable through the address; the database at a glance; a CSV of the month.
 */
export default async function PlatformCapacityPage({ searchParams }: PageProps<"/admin/platform/capacity">) {
  const admin = await requirePlatformAdmin();
  const query = await searchParams;
  const month = usageMonth(query.month);
  const sort = USAGE_METRIC_IDS.find((m) => m === query.sort) ?? null;
  const lang = adminLangOf(admin.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "capacity");
  const [rows, glance, drain, peaks, jobs, platformSpeed, adminSpeed] = await Promise.all([
    platformUsage(month),
    databaseGlance(),
    drainConnected(),
    upcomingPeaks(),
    cronJobRows(),
    ownSpeedReport("platform"),
    ownSpeedReport("admin"),
  ]);
  const now = new Date();
  const ordered = sort ? [...rows].sort((a, b) => (b.values[sort] ?? 0) - (a.values[sort] ?? 0)) : rows;
  const cell = (metric: UsageMetric, value: number | undefined) => (value === undefined ? "" : formatUsage(metric, value, locale));
  const current = new Date().toISOString().slice(0, 7);
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.platform.title}
        description={w.platform.description}
        actions={<ButtonLink href={`${BASE}/csv?month=${month}`} prefetch={false}>{w.platform.csv}</ButtonLink>}
      />
      <Card title={w.platform.database} compact>
        <p className="text-body text-ink-2">
          {fillWords(w.platform.connections, { n: glance.active })} · {fillWords(w.platform.size, { size: formatUsage("storage_bytes", glance.bytes, locale) })}
        </p>
        {!drain && <p className="mt-2 text-body text-muted">{w.platform.drainOff}</p>}
      </Card>
      {/* Scheduled jobs (PSI 2026-10-24, REL-06): the platform home links here when one is late or failing. */}
      <div id="jobs">
        <Card title={w.jobs.title} description={w.jobs.description} compact>
          {jobs.length === 0 ? (
            <p className="text-body text-muted">{w.jobs.none}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-caption">
                <thead className="text-muted">
                  <tr>
                    <th scope="col" className="py-2 pr-4">{w.jobs.job}</th>
                    <th scope="col" className="py-2 pr-4">{w.jobs.lastRun}</th>
                    <th scope="col" className="py-2 pr-4">{w.jobs.status}</th>
                    <th scope="col" className="py-2 pr-4">{w.jobs.lastError}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {jobs.map((job) => {
                    const health = cronHealth(job, now);
                    return (
                      <tr key={job.job}>
                        <th scope="row" className="py-2 pr-4 font-mono text-ink">{job.job}</th>
                        <td className="py-2 pr-4 text-ink-2 tabular-nums">
                          {job.lastFinishedAt ? new Date(job.lastFinishedAt).toLocaleString(locale, { dateStyle: "short", timeStyle: "short" }) : w.jobs.never}
                        </td>
                        <td className={`py-2 pr-4 ${health === "ok" ? "text-ink-2" : "text-danger-text"}`}>{w.jobs[health]}</td>
                        <td className="max-w-md truncate py-2 pr-4 text-muted" title={job.failures > 0 ? (job.lastError ?? "") : ""}>
                          {job.failures > 0 ? job.lastError : ""}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
      {/* How fast Kaizena Flow's own pages and the admin are for the people using them (D390, PSI PERF-01, PERF-02). */}
      <div id="speed">
        <OwnSpeedView
          reports={[
            { site: "platform", report: platformSpeed },
            { site: "admin", report: adminSpeed },
          ]}
          locale={locale}
          words={w.speed}
          speed={adminText(lang, "analytics").speed}
        />
      </div>
      {peaks.length > 0 && (
        <Card title={w.peaks.upcoming} compact>
          <ul className="grid gap-2 text-body">
            {peaks.map((p) => (
              <li key={p.id} className="flex flex-wrap gap-2">
                <Link href={`/admin/platform/stores/${p.slug}`} className="rounded-pill text-ink hover:underline">
                  {p.name}
                </Link>
                <span className="text-ink-2">
                  {p.startsAt.slice(0, 10)} – {p.endsAt.slice(0, 10)} · {p.expected === "very_busy" ? w.peaks.veryBusy : w.peaks.busy}
                  {p.note ? ` · ${p.note}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <Card
        title={month}
        aside={
          <nav className="flex gap-2 text-body">
            <Link href={`${BASE}?month=${shiftMonth(month, -1)}`} className="rounded-pill px-3 py-1 text-ink-2 hover:bg-sunken">
              {w.platform.previous}
            </Link>
            {month < current && (
              <Link href={`${BASE}?month=${shiftMonth(month, 1)}`} className="rounded-pill px-3 py-1 text-ink-2 hover:bg-sunken">
                {w.platform.next}
              </Link>
            )}
          </nav>
        }
        compact
      >
        <div className="overflow-x-auto">
          <table className="w-full text-left text-caption">
            <thead className="text-muted">
              <tr>
                <th scope="col" className="py-2 pr-4">{w.platform.store}</th>
                <th scope="col" className="py-2 pr-4">{w.platform.plan}</th>
                {USAGE_METRIC_IDS.map((m) => (
                  <th key={m} scope="col" className="py-2 pr-4 text-right">
                    <Link href={`${BASE}?month=${month}&sort=${m}`} aria-label={fillWords(w.platform.sortBy, { metric: w.metrics[m] })} className={`rounded-pill hover:text-ink ${sort === m ? "text-ink" : ""}`}>
                      {w.metrics[m]}
                    </Link>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {ordered.map((row) => (
                <tr key={row.storeId ?? "kaizen"}>
                  <th scope="row" className="py-2 pr-4 text-ink">
                    {row.storeId && row.slug ? (
                      <Link href={`/admin/platform/stores/${row.slug}`} className="rounded-pill hover:underline">
                        {row.name}
                      </Link>
                    ) : (
                      w.platform.kaizen
                    )}
                  </th>
                  <td className="py-2 pr-4 text-ink-2">{row.plan ?? ""}</td>
                  {USAGE_METRIC_IDS.map((m) => (
                    <td key={m} className="py-2 pr-4 text-right tabular-nums">{cell(m, row.values[m])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
