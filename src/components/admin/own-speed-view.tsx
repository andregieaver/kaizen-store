import { Card } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import type { AnalyticsMessages } from "@/lib/admin-messages/analytics.en";
import type { CapacityMessages } from "@/lib/admin-messages/capacity.en";
import { formatCount } from "@/lib/analytics-core";
import { SPEED_METRICS, type OwnSpeedSite } from "@/lib/speed";
import type { SpeedReport } from "@/server/analytics-speed";

import { Figure } from "./analytics/speed-view";

/**
 * The speed of Kaizena Flow's own site and of the admin (wave 11 unit K, D390) on Platform → Usage and limits: per kind of page and
 * screen, the 75th percentile with Google's rating, or how many page loads there are of the 20 a figure needs (`speedRows()`).
 */
export function OwnSpeedView({
  reports,
  locale,
  words,
  speed,
}: {
  reports: { site: OwnSpeedSite; report: SpeedReport }[];
  locale: string;
  words: CapacityMessages["speed"];
  speed: AnalyticsMessages["speed"];
}) {
  return (
    <Card title={words.title} description={words.description} compact>
      <div className="flex flex-col gap-6">
        {reports.map(({ site, report }) => (
          <section key={site} aria-labelledby={`speed-${site}`} data-own-speed={site}>
            <h3 id={`speed-${site}`} className="text-body-strong text-ink">
              {words.sites[site]}
              <span className="ml-2 text-caption text-muted">{fillWords(words.loads, { n: formatCount(report.loads) })}</span>
            </h3>
            {report.rows.length === 0 ? (
              <p className="mt-1 text-body text-muted">{words.none}</p>
            ) : (
              <div className="mt-2 overflow-x-auto">
                <table className="w-full text-left text-caption">
                  <thead className="text-muted">
                    <tr>
                      <th scope="col" className="py-2 pr-4">{words.page}</th>
                      <th scope="col" className="py-2 pr-4">{words.screen}</th>
                      {SPEED_METRICS.map((metric) => (
                        <th key={metric} scope="col" className="py-2 pr-4">{speed.metrics[metric].short}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {report.rows.map((row) => (
                      <tr key={`${row.screen}:${row.kind}`}>
                        <th scope="row" className="py-2 pr-4 text-ink">{words.kinds[site][row.kind]}</th>
                        <td className="py-2 pr-4 text-ink-2">{speed.screens[row.screen]}</td>
                        {row.cells.map((cell) => (
                          <td key={cell.metric} className="py-2 pr-4">
                            <Figure cell={cell} locale={locale} w={speed} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        ))}
      </div>
    </Card>
  );
}
