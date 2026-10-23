import type { Metadata } from "next";

import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { aiFor } from "@/server/ai";
import { requirePermission } from "@/server/permissions";
import { SEARCH_LOG_DAYS, searchStats } from "@/server/search";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Search" };


/**
 * What shoppers searched for in the store (Phase 2, S1, S2), over the last
 * 30 days: how often, how often nothing was found, how often meaning
 * helped, and the searches behind them. A search that finds nothing is a
 * product the store lacks, or a word its products do not use yet.
 */
export default async function SearchStatsPage({ params }: PageProps<"/admin/[store]/search">) {
  const gated = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const [stats, ai] = await Promise.all([searchStats(store.id), aiFor(store.id)]);
  const meaningOn = Boolean(ai?.space);
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "bookings").search;
  const percent = new Intl.NumberFormat(lang === "en" ? "en-GB" : ADMIN_LANG_FACTS[lang].locale, { style: "percent", maximumFractionDigits: 1 });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title={w.title}
        description={fillWords(w.description, { days: stats.days, kept: SEARCH_LOG_DAYS })}
      />
      <dl className="grid grid-cols-2 gap-4 sm:max-w-md">
        <div className={`p-4 ${CARD_CLASS}`}>
          <dt className="text-sm text-muted">{w.searches}</dt>
          <dd className="text-metric text-ink tabular-nums">{stats.searches}</dd>
        </div>
        <div className={`p-4 ${CARD_CLASS}`}>
          <dt className="text-sm text-muted">{w.foundNothing}</dt>
          <dd className="text-metric text-ink tabular-nums">{stats.searches === 0 ? "–" : percent.format(stats.zeroRate)}</dd>
        </div>
        <div className={`col-span-2 p-4 ${CARD_CLASS}`}>
          <dt className="text-sm text-muted">{w.meaning}</dt>
          <dd className="text-metric text-ink tabular-nums">
            {stats.meaningSearches === 0 ? "–" : percent.format(stats.meaningHelped / stats.meaningSearches)}
          </dd>
          <dd className="text-sm text-muted">
            {meaningOn
              ? fillWords(w.meaningOn, { n: stats.meaningHelped, of: stats.meaningSearches })
              : w.meaningOff}{" "}
            <Link href={`/admin/${store.slug}/settings/ai`} className="underline">
              {w.aiSettings}
            </Link>
          </dd>
        </div>
      </dl>

      <section aria-labelledby="zero-heading" className="flex flex-col gap-2">
        <h2 id="zero-heading" className="text-title text-ink">
          {w.zero}
        </h2>
        <p className="text-sm text-muted">
          {w.zeroHint}
          {meaningOn && ` ${fillWords(w.closestHint, { limit: ai?.minSimilarity.toFixed(2) ?? "" })}`}
        </p>
        {stats.zero.length === 0 ? (
          <p className="text-sm text-muted">{w.none}</p>
        ) : (
          <ol className={`divide-y divide-line text-sm ${CARD_CLASS}`}>
            {stats.zero.map((row) => (
              <li key={row.query} className="flex justify-between gap-3 p-3">
                <span className="break-all">{row.query}</span>
                <span className="flex gap-3 text-muted tabular-nums">
                  {row.closest !== null && (
                    <span title={w.closestTitle}>{fillWords(w.closest, { n: row.closest.toFixed(2) })}</span>
                  )}
                  <span>{row.count}×</span>
                </span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section aria-labelledby="top-heading" className="flex flex-col gap-2">
        <h2 id="top-heading" className="text-title text-ink">
          {w.top}
        </h2>
        {stats.top.length === 0 ? (
          <p className="text-sm text-muted">{w.noSearches}</p>
        ) : (
          <table className="w-full rounded-panel border border-line bg-card text-sm">
            <thead className="text-left text-muted">
              <tr>
                <th className="p-3 font-normal">{w.search}</th>
                <th className="p-3 text-right font-normal">{w.times}</th>
                <th className="p-3 text-right font-normal">{w.found}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
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
