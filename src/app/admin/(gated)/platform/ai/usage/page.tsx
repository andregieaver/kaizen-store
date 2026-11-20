import type { Metadata } from "next";

import { PhoneRow } from "@/components/admin/phone-row";
import Link from "next/link";

import { PeriodLinks, UsageReport } from "@/components/admin/usage-report";
import { featureWords, usagePeriod } from "@/lib/ai-usage";
import { requirePlatformReader } from "@/server/auth";
import { roundStats, type RoundStats } from "@/server/ai-round-stats";
import { usageByDay, usageRows } from "@/server/ai-usage";
import { Card, EmptyState, List, ListRow, PageHeader, RowAmount, RowFact, RowLead } from "@/components/admin/ui";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import type { AdminAreaMessages } from "@/lib/admin-text";
import { PLATFORM_TOOLS_WORDS } from "@/lib/admin-words/platform-tools";

export const metadata: Metadata = { title: "AI usage" };

/**
 * Everything the platform's AI models were used for (D106): the total, per
 * provider and model, per store owner account and per store, in the period
 * chosen. Whose key paid is shown apart, since Kaizen pays for its own.
 */
export default async function PlatformAiUsagePage({ searchParams }: PageProps<"/admin/platform/ai/usage">) {
  // The page checks for itself: the layout's check redirects in the browser, after the page's own data would already be sent.
  const account = await requirePlatformReader();
  const lang = adminLangOf(account.adminLocale);
  const w = PLATFORM_TOOLS_WORDS[lang].usage;
  const { period } = await searchParams;
  const chosen = usagePeriod(typeof period === "string" ? period : undefined);
  const [rows, days, stats] = await Promise.all([usageRows({ days: chosen.days }), usageByDay({ days: chosen.days }), roundStats(30)]);
  const locale = ADMIN_LANG_FACTS[lang].locale;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <PageHeader
          title={w.title}
          description={<>{fillWords(w.platformIntro, { period: (w.periods[chosen.id] ?? chosen.label).toLowerCase() })}{" "}<Link href="/admin/platform/ai" className="underline">{w.aiSettings}</Link></>}
        />
        <PeriodLinks base="/admin/platform/ai/usage" period={chosen.id} words={w} />
      </div>
      {/* Round 66 (D835): on a phone tokens per call is a row, as the breakdowns under the figures are. */}
      <div className="max-sm:order-last max-sm:overflow-hidden max-sm:rounded-panel">
        <PhoneRow flat last title={w.perCall.title} change={w.phoneOpen} done={w.phoneClose}>
          <TokensPerCall stats={stats} words={w.perCall} locale={locale} />
        </PhoneRow>
      </div>
      <UsageReport rows={rows} days={days} scope="platform" words={w} locale={locale} />
    </div>
  );
}

type PerCallWords = AdminAreaMessages["platformTools"]["usage"]["perCall"];

/**
 * Tokens per call (bloat review step 1.19): a row per feature with the median and 90th percentile of a call's input and output, and the AI
 * manager's turns: the median input and calls per turn, the share read from the provider's cache and the share of turns that loaded tools.
 */
function TokensPerCall({ stats, words: w, locale }: { stats: RoundStats; words: PerCallWords; locale: string }) {
  const count = (value: number | null) => (value === null ? "–" : Math.round(value).toLocaleString(locale));
  const share = (value: number | null) => (value === null ? "–" : value.toLocaleString(locale, { style: "percent", maximumFractionDigits: 0 }));
  const m = stats.manager;
  return (
    <Card title={w.title} description={w.intro}>
      {stats.byFeature.length === 0 ? (
        <EmptyState compact title={w.empty} />
      ) : (
        <div className="flex flex-col gap-6">
          <List label={w.title}>
            {stats.byFeature.map((f) => (
              <ListRow key={f.feature}>
                <RowLead title={featureWords(f.feature)} sub={fillWords(w.calls, { count: count(f.calls) })} />
                <RowFact sub={w.input}>{fillWords(w.medianAnd90, { median: count(f.inputP50), p90: count(f.inputP90) })}</RowFact>
                <RowFact sub={w.output}>{fillWords(w.medianAnd90, { median: count(f.outputP50), p90: count(f.outputP90) })}</RowFact>
              </ListRow>
            ))}
          </List>
          {m.turns > 0 && (
            <div className="flex flex-col gap-2">
              <h3 className="text-body-strong text-ink">
                {w.manager} · {fillWords(w.turns, { count: count(m.turns) })}
              </h3>
              <List label={w.manager}>
                {(
                  [
                    [w.turnInput, count(m.turnInputP50)],
                    [w.callsPerTurn, count(m.turnCallsP50)],
                    [w.cachedShare, share(m.cachedShare)],
                    [w.cachedAfterFirst, share(m.cachedShareAfterFirst)],
                    [w.loadShare, share(m.loadShare)],
                  ] as const
                ).map(([label, value]) => (
                  <ListRow key={label}>
                    <RowLead title={label} />
                    <RowAmount>{value}</RowAmount>
                  </ListRow>
                ))}
              </List>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}
