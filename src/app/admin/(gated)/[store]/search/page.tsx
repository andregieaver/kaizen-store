import type { Metadata } from "next";

import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { aiFor } from "@/server/ai";
import { listProductChoices } from "@/server/discounts";
import { listPublishedPages } from "@/server/pages";
import { memberCan, requirePermission } from "@/server/permissions";
import { SEARCH_LOG_DAYS, searchStats } from "@/server/search";
import { listRules } from "@/server/search-rules";
import { listSynonyms } from "@/server/search-synonyms";
import { siteTerms } from "@/server/taxonomy";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { languageNames } from "@/lib/legal-admin-words";

import { deleteRuleAction, deleteSynonymAction, saveRuleAction, saveSynonymAction } from "./actions";
import { RulesCard } from "./rules-card";
import { SynonymsCard } from "./synonyms-card";

export const metadata: Metadata = { title: "Search" };


/**
 * What shoppers searched for in the store (Phase 2, S1, S2), over the last
 * 30 days: how often, how often nothing was found, how often meaning
 * helped, and the searches behind them. A search that finds nothing is a
 * product the store lacks, or a word its products do not use yet: each
 * offers a synonym or a page to send it to (D324), which the cards below
 * keep (`?synonym=` and `?send=` start them with the search's words).
 */
export default async function SearchStatsPage({ params, searchParams }: PageProps<"/admin/[store]/search">) {
  const gated = await requirePermission((await params).store, "settings:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  const locale = store.markets[0]?.locale ?? "nb-NO";
  const [stats, ai, synonyms, rules, products, terms, pages] = await Promise.all([
    searchStats(store.id),
    aiFor(store.id),
    listSynonyms(store.id),
    listRules(store.id, locale),
    listProductChoices(store.id, locale),
    siteTerms(store.id, "product"),
    listPublishedPages(store.id),
  ]);
  const asked = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value.slice(0, 100) : null);
  const canWrite = memberCan(gated, "settings:write");
  const meaningOn = Boolean(ai?.space);
  const lang = adminLangOf(gated.account.adminLocale);
  const w = adminText(lang, "bookings").search;
  const kept = store.localization.keptLocales;
  // A group in a language the store no longer keeps is still listed, to be removed (D324).
  const languages = [...kept, ...synonyms.map((row) => row.locale).filter((locale) => !kept.includes(locale))]
    .filter((locale, i, all) => all.indexOf(locale) === i)
    .map((locale) => ({ locale, name: languageNames([locale], lang), kept: kept.includes(locale) }));
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
                <span className="flex flex-wrap items-center justify-end gap-3 text-muted tabular-nums">
                  {canWrite && (
                    <>
                      <Link href={`?synonym=${encodeURIComponent(row.query)}#synonyms`} className="underline">
                        {w.zeroActions.addSynonym}
                      </Link>
                      <Link href={`?send=${encodeURIComponent(row.query)}#rules`} className="underline">
                        {w.zeroActions.sendToPage}
                      </Link>
                    </>
                  )}
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

      <SynonymsCard
        words={w.synonyms}
        lines={synonyms.map((row) => ({ ...row, remove: deleteSynonymAction.bind(null, store.slug, row.id) }))}
        languages={languages}
        canWrite={canWrite}
        save={saveSynonymAction.bind(null, store.slug)}
        prefill={one(asked.synonym)}
      />

      <RulesCard
        words={w.rules}
        lines={rules.map((row) => ({ ...row, remove: deleteRuleAction.bind(null, store.slug, row.id) }))}
        products={products}
        terms={terms.map((term) => ({ id: term.id, name: term.name, kind: term.kind }))}
        pages={[
          ...pages.map((page) => ({ path: `/${page.slug}`, label: page.content.title })),
          ...terms.map((term) => ({ path: `/${term.kind}/${term.slug}`, label: fillWords(term.kind === "tag" ? w.rules.tag : w.rules.category, { name: term.name }) })),
        ]}
        canWrite={canWrite}
        save={saveRuleAction.bind(null, store.slug)}
        prefill={one(asked.send)}
      />

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
                  <td className="p-3 text-right tabular-nums">{row.redirected && row.results === 0 ? w.sentOn : row.results}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
