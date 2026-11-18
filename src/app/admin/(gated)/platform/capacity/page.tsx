import type { Metadata } from "next";
import Link from "next/link";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { OwnSpeedView } from "@/components/admin/own-speed-view";
import { PlatformFlagsCard } from "@/components/admin/platform-flags-card";
import { ButtonLink, Card, Chip, List, ListRow, PageHeader, RowFact, RowLead } from "@/components/admin/ui";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import type { CapacityMessages } from "@/lib/admin-messages/capacity.en";
import { styleOver, styleSummary, type StyleRow } from "@/lib/style-reading";
import { formatUsage } from "@/lib/usage-format";
import { USAGE_METRIC_IDS, type UsageMetric } from "@/lib/usage-metrics";
import { shiftMonth, usageMonth } from "@/lib/usage-month";
import { platformCan, requirePlatformReader } from "@/server/auth";
import { recordingsOpenNow } from "@/server/recordings-admin";
import { upcomingPeaks } from "@/server/capacity-events";
import { databaseGlance, drainConnected, platformUsage } from "@/server/usage";
import { cacheEventsWeek, type CacheEventRow } from "@/server/cache-events";
import { cronJobRows } from "@/server/cron-runs";
import { ownSpeedReport } from "@/server/own-speed";
import { currentFlags } from "@/server/platform-flags";
import { adminFromDublin } from "@/server/status";
import { styleReading } from "@/server/style-reading";
import { cronHealth } from "@/lib/cron-health";
import { COSTLY_ALLOWED, WHOLE_READ_ALLOWED } from "@/lib/platform-flags";

import { recordingsOpenAction } from "./actions";

export const metadata: Metadata = { title: "Usage and limits" };

const BASE = "/admin/platform/capacity";

/**
 * Every store's usage this month (D314, `docs/capacity.md` step 1.6): one row per store, Kaizena Flow's own site first, metrics in
 * columns to compare, sortable through the address; the database at a glance; a CSV of the month.
 */
export default async function PlatformCapacityPage({ searchParams }: PageProps<"/admin/platform/capacity">) {
  const admin = await requirePlatformReader();
  const query = await searchParams;
  // The style text owners add is a reading taken on demand (bloat review step 1.23), so the ordinary view sends no statement for it.
  const reading = query.reading === "styles" ? await styleReading() : null;
  const month = usageMonth(query.month);
  const sort = USAGE_METRIC_IDS.find((m) => m === query.sort) ?? null;
  const lang = adminLangOf(admin.adminLocale);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const w = adminText(lang, "capacity");
  const [rows, glance, drain, peaks, jobs, platformSpeed, adminSpeed, dublin, recordingsOpen, flagged, cacheWeek] = await Promise.all([
    platformUsage(month),
    databaseGlance(),
    drainConnected(),
    upcomingPeaks(),
    cronJobRows(),
    ownSpeedReport("platform"),
    ownSpeedReport("admin"),
    adminFromDublin(),
    recordingsOpenNow(),
    currentFlags(),
    cacheEventsWeek(),
  ]);
  const now = new Date();
  const ordered = sort ? [...rows].sort((a, b) => (b.values[sort] ?? 0) - (a.values[sort] ?? 0)) : rows;
  const cell = (metric: UsageMetric, value: number | undefined) => (value === undefined ? "" : formatUsage(metric, value, locale));
  const current = new Date().toISOString().slice(0, 7);
  // One row per day, kind, family and caller, the subjects summed (bloat review step 1.25).
  const cacheRows = [
    ...cacheWeek.rows
      .reduce((all, r) => {
        const key = `${r.day}|${r.kind}|${r.family}|${r.source}`;
        const sum = all.get(key);
        if (sum) {
          sum.count += r.count;
          sum.statements += r.statements;
        } else all.set(key, { ...r, subject: "" });
        return all;
      }, new Map<string, CacheEventRow>())
      .values(),
  ];
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
      <Card title={w.platform.styles.title} description={w.platform.styles.description} compact>
        {reading === null ? (
          <ButtonLink href={`${BASE}?month=${month}&reading=styles`} prefetch={false}>{w.platform.styles.take}</ButtonLink>
        ) : (
          <StylesReading reading={reading} words={w.platform.styles} kaizen={w.platform.kaizen} locale={locale} />
        )}
      </Card>
      <PlatformFlagsCard
        flags={flagged?.flags ?? []}
        difference={flagged?.difference ?? null}
        allowed={{ wholeRead: WHOLE_READ_ALLOWED, costly: COSTLY_ALLOWED }}
        words={w.flags}
        locale={locale}
      />
      {/* Recordings of visits (D656): the platform's hold, open to every store or Kaizena Flow's own only. */}
      <div id="recordings">
        <Card title={w.recordings.title} description={w.recordings.description} compact>
          <p className="text-body text-ink-2">{recordingsOpen ? w.recordings.open : w.recordings.closed}</p>
          {platformCan(admin, "settings", "write") ? (
            <ActionForm action={recordingsOpenAction} className="mt-3 flex flex-col gap-2">
              <div>
                <SubmitButton name="open" value={recordingsOpen ? "off" : "on"} variant="secondary">
                  {recordingsOpen ? w.recordings.closeIt : w.recordings.openIt}
                </SubmitButton>
              </div>
            </ActionForm>
          ) : null}
        </Card>
      </div>
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
      {/* Refreshes of cache tags and draws of store layouts (bloat review step 1.25, `docs/capacity.md`). */}
      <div id="cache">
        <Card title={w.cache.title} description={w.cache.description} compact>
          {cacheRows.length === 0 ? (
            <p className="text-body text-muted">{w.cache.none}</p>
          ) : (
            <>
              {cacheWeek.flagged.map((r) => (
                <p key={`${r.day}|${r.family}|${r.subject}`} className="mb-2 text-body text-danger-text">
                  {fillWords(w.cache.flag, { subject: r.subject, family: r.family, n: r.count, day: r.day })}
                </p>
              ))}
              <div className="overflow-x-auto">
                <table className="w-full text-left text-caption">
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-2 pr-4">{w.cache.day}</th>
                      <th scope="col" className="py-2 pr-4">{w.cache.kind}</th>
                      <th scope="col" className="py-2 pr-4">{w.cache.family}</th>
                      <th scope="col" className="py-2 pr-4">{w.cache.source}</th>
                      <th scope="col" className="py-2 pr-4">{w.cache.count}</th>
                      <th scope="col" className="py-2 pr-4">{w.cache.statements}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {cacheRows.map((r) => (
                      <tr key={`${r.day}|${r.kind}|${r.family}|${r.source}`}>
                        <th scope="row" className="py-2 pr-4 tabular-nums text-ink">{r.day}</th>
                        <td className="py-2 pr-4 text-ink-2">{r.kind === "draw" ? w.cache.draw : w.cache.refresh}</td>
                        <td className="py-2 pr-4 font-mono text-ink-2">{r.family}</td>
                        <td className="py-2 pr-4 text-ink-2">{w.cache.sources[r.source as keyof typeof w.cache.sources] ?? r.source}</td>
                        <td className="py-2 pr-4 text-ink-2 tabular-nums">{r.count}</td>
                        <td className="py-2 pr-4 text-ink-2 tabular-nums">{r.statements}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
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
      {/* The admin timed from Dublin by the status checks (PSI PERF-02). */}
      <Card title={w.dublin.title} compact>
        <p className="text-body text-ink-2">
          {dublin.checks === 0 || dublin.p50 === null
            ? w.dublin.none
            : fillWords(w.dublin.text, { p50: dublin.p50, p95: dublin.p95 ?? dublin.p50, checks: dublin.checks })}
        </p>
      </Card>
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

const kilobytes = (bytes: number, locale: string) =>
  new Intl.NumberFormat(locale, { style: "unit", unit: "kilobyte", maximumFractionDigits: 1 }).format(bytes / 1000);

/** The reading of the style text each store adds to every document: the summary, the lines it has passed and a row for each store. */
function StylesReading({ reading, words, kaizen, locale }: { reading: StyleRow[]; words: CapacityMessages["platform"]["styles"]; kaizen: string; locale: string }) {
  const summary = styleSummary(reading);
  return (
    <div className="flex flex-col gap-3">
      <p className="text-body text-ink-2">
        {fillWords(words.summary, { median: kilobytes(summary.medianBytes, locale), over: summary.over, share: summary.motionShare === null ? "" : Math.round(summary.motionShare * 100) })}
        {summary.motionShare === null ? ` ${words.noPages}` : ""}
      </p>
      {summary.triggers.map((trigger) => (
        <p key={trigger} className="text-body text-danger-text">{words.triggers[trigger]}</p>
      ))}
      <List label={words.title}>
        {reading.map((row) => (
          <ListRow key={row.storeId ?? "kaizen"}>
            <RowLead title={row.name ?? kaizen} sub={words.store} />
            {styleOver(row) ? <Chip signal="warning">{words.over}</Chip> : null}
            <RowFact sub={words.bytes}>{kilobytes(row.cssBytes, locale)}</RowFact>
            <RowFact sub={words.pages}>{row.pages}</RowFact>
            <RowFact sub={words.motion}>{row.motionPages}</RowFact>
          </ListRow>
        ))}
      </List>
    </div>
  );
}
