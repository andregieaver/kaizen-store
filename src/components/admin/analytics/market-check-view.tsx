import type { ReactNode } from "react";

import { adminDay } from "@/lib/admin-date";
import { countWords, fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { MarketCheckMessages } from "@/lib/admin-messages/market-check.en";
import { formatCount, formatPercent } from "@/lib/analytics-core";
import { formatAmount } from "@/lib/analytics-format";
import { languageNames } from "@/lib/legal-admin-words";
import {
  askAboutFinding,
  conversionOf,
  FINDINGS_SHOWN,
  findingId,
  findingText,
  FIX_PATHS,
  MIN_ORDERS,
  MIN_VISITS,
  missRateOf,
  SWOT_PARTS,
  swotOf,
  type MarketFacts,
  type MarketFinding,
  type MarketFindingKind,
  type SwotPart,
} from "@/lib/market-check";
import type { MarketCheck } from "@/server/market-check";

import { buttonClass } from "../ui/button";
import { CARD_CLASS } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { AdminLink } from "../ui/link";
import { AskAboutAlert } from "./ask-about-alert";
import { DataTable, StatusPill, type Column, type PillTone } from "./data-table";
import { AnalyticsSection, Note } from "./section";

/**
 * Analytics → Markets (D900 M1, `docs/market-check.md` 3.3), drawn on the server from the check as read. Homer gets *What to do in your
 * markets*: the first three findings, each one sentence with its figures, *Make a plan* (the AI manager opened with the finding written in
 * by code, sent by the person) and a link to the page that fixes it. Lisa opens *Every country, side by side* for the figures behind them,
 * every finding drawn as a SWOT (D900 M2: only a way of drawing the findings, never a text of its own), and the searches that found nothing
 * in each country. Nothing here reads data or works out a figure.
 */

const TONE: Record<MarketFindingKind, PillTone> = {
  weak_market: "warning",
  unmet_demand: "info",
  rival_cheaper: "warning",
  untranslated: "info",
  unpriced: "warning",
  rival_out: "info",
  strong_market: "good",
  rival_dearer: "good",
};

/** Each SWOT part's rule along its top, in the charts' colours every admin scheme defines: good and bad news, and the first series for chances. */
const SWOT_RULE: Record<SwotPart, string> = {
  strengths: "border-t-(--chart-good)",
  weaknesses: "border-t-(--chart-warn)",
  opportunities: "border-t-(--chart-1)",
  threats: "border-t-(--chart-bad)",
};

const linkClass = "text-sm font-medium text-(--brand-text) underline-offset-2 hover:underline";

export type MarketCheckViewProps = {
  base: string;
  lang: AdminLang;
  /** The locale amounts are written in (as the Traffic page: the first market's in English, the admin's otherwise). */
  locale: string;
  check: MarketCheck;
  /** The period's own words ("Last 30 days"), for the AI manager's message. */
  periodLabel: string;
  words: MarketCheckMessages;
  /** The rivals' section (`MarketRivalsSection`), drawn by the page with its forms; left out where prices do not apply. */
  rivals?: ReactNode;
};

/** A language code's name in the reader's language: `de-DE` is "German". */
const languageOf = (lang: AdminLang) => (locale: string) => languageNames([locale.split("-")[0]], lang);

/** The period's words inside a sentence: its first letter in lower case ("last 30 days"). */
const inSentence = (label: string) => label.charAt(0).toLocaleLowerCase() + label.slice(1);

function FindingCard({ finding, text, base, periodLabel, words }: { finding: MarketFinding; text: string } & Pick<MarketCheckViewProps, "base" | "periodLabel" | "words">) {
  return (
    <li data-finding={finding.kind} className={`flex flex-col gap-3 p-5 ${CARD_CLASS}`}>
      <StatusPill tone={TONE[finding.kind]}>{words.kinds[finding.kind]}</StatusPill>
      <p className="flex-1 text-body text-ink">{text}</p>
      {/* The button above its link in every card, so the three cards end alike whatever the link's words. */}
      <div className="flex flex-col items-start gap-2">
        <AskAboutAlert
          message={askAboutFinding(text, inSentence(periodLabel), words.ask)}
          label={words.makePlan}
          srLabel={fillWords(words.makePlanFor, { text })}
          className={buttonClass("strong", "card")}
        />
        <AdminLink href={`${base}${FIX_PATHS[finding.kind]}`} className={linkClass}>
          {words.open[finding.kind]}
        </AdminLink>
      </div>
    </li>
  );
}

/** A figure that may not be known: the words for *not counted* or *does not apply* instead of a zero. */
type Line = { kind: MarketFindingKind; f: MarketFinding; text: string };

/** One finding as a line of the SWOT: its kind, its sentence, the page that fixes it and *Make a plan*. */
function FindingLine({ f, text, base, periodLabel, words }: Line & Pick<MarketCheckViewProps, "base" | "periodLabel" | "words">) {
  return (
    <li data-finding={f.kind} className="flex flex-col items-start gap-2 px-4 py-3 text-sm">
      <StatusPill tone={TONE[f.kind]}>{words.kinds[f.kind]}</StatusPill>
      <span className="text-ink">{text}</span>
      <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <AdminLink href={`${base}${FIX_PATHS[f.kind]}`} className={linkClass}>
          {words.open[f.kind]}
        </AdminLink>
        <AskAboutAlert message={askAboutFinding(text, inSentence(periodLabel), words.ask)} label={words.makePlan} srLabel={fillWords(words.makePlanFor, { text })} />
      </span>
    </li>
  );
}

function cell(value: number | null, write: (n: number) => string, missing: string) {
  return value === null ? <span className="text-muted">{missing}</span> : <span className="tabular-nums">{write(value)}</span>;
}

export function MarketCheckView({ base, lang, locale, check, periodLabel, words, rivals }: MarketCheckViewProps) {
  const w = words;
  const names = new Map(check.markets.map((m) => [m.code, m.name]));
  const languageName = languageOf(lang);
  const amount = (minor: number, currency: string) => formatAmount(minor, currency, locale);
  const findings: Line[] = check.findings.map((f) => ({ kind: f.kind, f, text: findingText(f, w.finding, names, languageName, amount) }));
  const first = findings.slice(0, FINDINGS_SHOWN);
  const rest = findings.length - first.length;
  const swot = swotOf(findings);
  const counted = check.coverage.counting && check.coverage.days > 0;
  const money = (n: number) => formatAmount(n, check.currency, locale);
  const e = w.every;

  const columns: Column<MarketFacts>[] = [
    {
      key: "country",
      label: e.country,
      cell: (m) => (
        <span className="flex flex-wrap items-center gap-2">
          <span>{m.name}</span>
          {!m.sells ? <StatusPill>{e.notSold}</StatusPill> : null}
        </span>
      ),
    },
    { key: "visits", label: e.visits, align: "right", cell: (m) => cell(m.visits, formatCount, e.notCounted) },
    { key: "conversion", label: e.conversion, align: "right", cell: (m) => cell(conversionOf(m), (r) => formatPercent(r), e.notCounted) },
    ...(check.sells
      ? ([
          { key: "orders", label: e.orders, align: "right", cell: (m) => cell(m.orders, formatCount, e.notApplicable) },
          { key: "revenue", label: e.revenue, align: "right", cell: (m) => cell(m.revenueMinor, money, e.notApplicable) },
          {
            key: "aov",
            label: e.aov,
            align: "right",
            cell: (m) => cell(m.orders && m.revenueMinor !== null ? Math.round(m.revenueMinor / m.orders) : null, money, e.notApplicable),
          },
        ] satisfies Column<MarketFacts>[])
      : []),
    { key: "searches", label: e.searches, align: "right", cell: (m) => cell(m.searches, formatCount, e.notCounted) },
    { key: "found_nothing", label: e.foundNothing, align: "right", cell: (m) => cell(missRateOf(m), (r) => formatPercent(r), e.notApplicable) },
    ...(check.sells ? ([{ key: "unpriced", label: e.unpriced, align: "right", cell: (m) => cell(m.unpriced, formatCount, e.notApplicable) }] satisfies Column<MarketFacts>[]) : []),
    ...(check.house ? [] : ([{ key: "untranslated", label: e.untranslated, align: "right", cell: (m) => cell(m.untranslated, formatCount, e.notApplicable) }] satisfies Column<MarketFacts>[])),
  ];
  const withTerms = check.markets.filter((m) => m.missedTerms.length > 0);
  // What does not apply to this store, said once above everything else.
  const scopeNote = check.house ? w.notes.house : check.sells ? null : w.notes.noShop;

  return (
    <div className="flex flex-col gap-8" data-market-check>
      {scopeNote ? <Note>{scopeNote}</Note> : null}
      {!check.coverage.counting ? (
        <Note>
          {w.notes.countingOff}{" "}
          <AdminLink href={`${base}/analytics/settings`} className={linkClass}>
            {w.notes.countingOffLink}
          </AdminLink>
        </Note>
      ) : check.coverage.partial && check.coverage.from ? (
        <Note>{fillWords(w.notes.partial, { date: adminDay(check.coverage.from, "day", lang) })}</Note>
      ) : null}

      <AnalyticsSection id="market-todo" title={w.todoTitle} description={w.todoDescription}>
        {first.length === 0 ? (
          <EmptyState title={w.nothingToDo} />
        ) : (
          <ol className="grid gap-3 md:grid-cols-3">
            {first.map(({ f, text }) => (
              <FindingCard key={findingId(f)} finding={f} text={text} base={base} periodLabel={periodLabel} words={w} />
            ))}
          </ol>
        )}
      </AnalyticsSection>

      <details className="group flex flex-col gap-6" data-every-country>
        <summary className="cursor-pointer select-none text-body-strong text-ink">
          {e.summary}
          {rest > 0 ? <span className="ml-2 text-sm font-normal text-muted">{countWords(rest, w.more, { n: formatCount(rest) })}</span> : null}
        </summary>
        <div className="mt-4 flex flex-col gap-8">
          <AnalyticsSection id="market-swot" title={w.swot.title} description={w.swot.description} level={3}>
            <div className="grid gap-3 md:grid-cols-2">
              {SWOT_PARTS.map((part) => {
                const p = w.swot.parts[part];
                const none = part === "threats" && check.house ? w.swot.house : p.none;
                return (
                  <section key={part} aria-labelledby={`swot-${part}`} data-swot={part} className={`flex flex-col border-t-4 ${SWOT_RULE[part]} ${CARD_CLASS}`}>
                    <div className="px-4 pt-3 pb-2">
                      <h4 id={`swot-${part}`} className="text-body-strong text-ink">
                        {p.title}
                      </h4>
                      <p className="text-xs text-muted">{p.hint}</p>
                    </div>
                    {swot[part].length > 0 ? (
                      <ul className="divide-y divide-line border-t border-line">
                        {swot[part].map((line) => (
                          <FindingLine key={findingId(line.f)} {...line} base={base} periodLabel={periodLabel} words={w} />
                        ))}
                      </ul>
                    ) : (
                      <div className="px-4 pb-4">
                        <EmptyState compact title={none} />
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          </AnalyticsSection>

          <AnalyticsSection id="market-countries" title={e.title} description={e.description} level={3}>
            <DataTable caption={e.caption} columns={columns} rows={check.markets} rowKey={(m) => m.code} exportable={false} exportReason="markets.countries" />
            {counted ? <p className="text-xs text-muted">{fillWords(e.compared, { visits: formatCount(MIN_VISITS), orders: formatCount(MIN_ORDERS) })}</p> : null}
          </AnalyticsSection>

          {rivals}

          <AnalyticsSection
            id="market-terms"
            title={w.terms.title}
            description={w.terms.description}
            level={3}
            action={
              <AdminLink href={`${base}/search`} className={linkClass}>
                {w.terms.open}
              </AdminLink>
            }
          >
            {check.searchesEmpty ? (
              <Note>{w.notes.searchesEmpty}</Note>
            ) : withTerms.length === 0 ? (
              <EmptyState compact title={w.terms.none} />
            ) : (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {withTerms.map((m) => (
                  <div key={m.code} className={`p-4 ${CARD_CLASS}`} data-market-terms={m.code}>
                    <h4 className="text-body-strong text-ink">{m.name}</h4>
                    <ul className="mt-2 space-y-1 text-sm">
                      {m.missedTerms.map((t) => (
                        <li key={t.term} className="flex items-baseline justify-between gap-3">
                          <span className="min-w-0 break-words">{t.term}</span>
                          <span className="shrink-0 tabular-nums text-muted">{countWords(t.misses, w.terms.times, { n: formatCount(t.misses) })}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
            {check.searchesClamped && !check.searchesEmpty ? <p className="text-xs text-muted">{fillWords(w.notes.searchesClamped, { date: adminDay(check.searchesFrom, "day", lang) })}</p> : null}
          </AnalyticsSection>
        </div>
      </details>
    </div>
  );
}

