import type { Metadata } from "next";

import Link from "next/link";

import { aiFor } from "@/server/ai";
import { requirePermission } from "@/server/permissions";
import { SEARCH_LOG_DAYS, searchStats } from "@/server/search";

export const metadata: Metadata = { title: "Search" };

const percent = new Intl.NumberFormat("en-GB", { style: "percent", maximumFractionDigits: 1 });

/**
 * What shoppers searched for in the store (Phase 2, S1, S2), over the last
 * 30 days: how often, how often nothing was found, how often meaning
 * helped, and the searches behind them. A search that finds nothing is a
 * product the store lacks, or a word its products do not use yet.
 */
export default async function SearchStatsPage({ params }: PageProps<"/admin/[store]/search">) {
  const { store } = await requirePermission((await params).store, "settings:read");
  const [stats, ai] = await Promise.all([searchStats(store.id), aiFor(store.id)]);
  const meaningOn = Boolean(ai?.space);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-sm text-muted">
          What shoppers searched for in the last {stats.days} days. Searches are kept {SEARCH_LOG_DAYS} days, as they can
          contain personal details.
        </p>
      </div>
      <dl className="grid grid-cols-2 gap-4 sm:max-w-md">
        <div className="rounded-lg border border-border bg-background p-4">
          <dt className="text-sm text-muted">Searches</dt>
          <dd className="text-2xl font-semibold tabular-nums">{stats.searches}</dd>
        </div>
        <div className="rounded-lg border border-border bg-background p-4">
          <dt className="text-sm text-muted">Found nothing</dt>
          <dd className="text-2xl font-semibold tabular-nums">{stats.searches === 0 ? "–" : percent.format(stats.zeroRate)}</dd>
        </div>
        <div className="col-span-2 rounded-lg border border-border bg-background p-4">
          <dt className="text-sm text-muted">Helped by meaning</dt>
          <dd className="text-2xl font-semibold tabular-nums">
            {stats.meaningSearches === 0 ? "–" : percent.format(stats.meaningHelped / stats.meaningSearches)}
          </dd>
          <dd className="text-sm text-muted">
            {meaningOn
              ? `Searches with products found by meaning, not by their words (${stats.meaningHelped} of ${stats.meaningSearches}).`
              : "Search by meaning is off: the store has no AI search model."}{" "}
            <Link href={`/admin/${store.slug}/settings/ai`} className="underline">
              AI settings
            </Link>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="zero-heading" className="flex flex-col gap-2">
        <h2 id="zero-heading" className="font-medium">
          Searches that found nothing
        </h2>
        <p className="text-sm text-muted">
          Add the product, or use the shoppers&apos; words in a product&apos;s title or description, or in a category name.
          {meaningOn &&
            ` “Closest” is how near meaning came (limit ${ai?.minSimilarity.toFixed(2)}): if the right product comes close to the limit, it may be set too high.`}
        </p>
        {stats.zero.length === 0 ? (
          <p className="text-sm text-muted">None.</p>
        ) : (
          <ol className="divide-y divide-border rounded-lg border border-border bg-background text-sm">
            {stats.zero.map((row) => (
              <li key={row.query} className="flex justify-between gap-3 p-3">
                <span className="break-all">{row.query}</span>
                <span className="flex gap-3 text-muted tabular-nums">
                  {row.closest !== null && (
                    <span title="How close the closest product came by meaning, from 0 to 1">closest {row.closest.toFixed(2)}</span>
                  )}
                  <span>{row.count}×</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="top-heading" className="flex flex-col gap-2">
        <h2 id="top-heading" className="font-medium">
          Most searched
        </h2>
        {stats.top.length === 0 ? (
          <p className="text-sm text-muted">No searches yet.</p>
        ) : (
          <table className="w-full rounded-lg border border-border bg-background text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3 font-normal">Search</th>
                <th className="p-3 text-right font-normal">Times</th>
                <th className="p-3 text-right font-normal">Products found</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {stats.top.map((row) => (
                <tr key={row.query}>
                  <td className="p-3 break-all">{row.query}</td>
                  <td className="p-3 text-right tabular-nums">{row.count}</td>
                  <td className="p-3 text-right tabular-nums">{row.results}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
