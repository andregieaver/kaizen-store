import type { Metadata } from "next";
import Link from "next/link";

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
  const [rows, glance, drain, peaks] = await Promise.all([platformUsage(month), databaseGlance(), drainConnected(), upcomingPeaks()]);
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
