import { adminDate, adminDay } from "@/lib/admin-date";
import type { AdminLang } from "@/lib/admin-lang";
import { fillWords } from "@/lib/admin-fill";
import type { CompaniesMessages } from "@/lib/admin-messages/companies.en";
import { formatCount } from "@/lib/analytics-core";
import { pageLabel, type CompanySummary } from "@/lib/company-lookup";
import { OTHER_PAGE } from "@/lib/visit-record";
import type { VisitCompany } from "@/server/company-visits";

import { AdminLink } from "../ui/link";
import { ButtonLink } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { Note } from "./section";

/**
 * Which companies visited (D890, `docs/analytics.md` "Companies"), drawn on the server from plain props: one card per company, most recently
 * seen first, with what it is (industry, size, place, website), how often it came (visits, days, a bar per day of the period) and the pages
 * it looked at. Homer reads the list; there is nothing to set here. The figures are text beside the bars, so the bars are only a picture of
 * them (`aria-hidden`), and the timeline's days are its label.
 */

const card = "flex flex-col gap-4 rounded-lg border border-line bg-card p-5";

/** Pages shown on a company's card before "and n more". */
const PAGES_SHOWN = 4;

export type CompaniesState = "off" | "not_connected" | "waiting" | "on";

export type CompaniesViewProps = {
  base: string;
  lang: AdminLang;
  timeZone: string;
  /** Off, on without a connection, on with nothing counted yet, or on. */
  state: CompaniesState;
  owner: boolean;
  /** The store has no country in its addresses (D181): its pages are shown without one. */
  marketless: boolean;
  /** The period's days, oldest first (`YYYY-MM-DD`). */
  days: readonly string[];
  summaries: readonly CompanySummary[];
  companies: ReadonlyMap<string, VisitCompany>;
  words: CompaniesMessages;
};

/** A page as the owner reads it: the front page and the pages past the kept ones by name, the rest by their path. */
function pageText(page: string, marketless: boolean, w: CompaniesMessages): string {
  if (page === OTHER_PAGE) return w.otherPages;
  const label = pageLabel(page, marketless);
  return label === "/" || /^\/[a-z]{2}$/.test(label) ? w.frontPage : label;
}

/** What a company is, in one line: industry, headcount, place and country. */
function factsLine(c: VisitCompany, w: CompaniesMessages): string {
  return [c.industry, c.employees ? fillWords(w.employees, { range: c.employees }) : null, [c.city, c.countryCode].filter(Boolean).join(", ") || null]
    .filter((part): part is string => Boolean(part))
    .join(" · ");
}

/** A bar for each day of the period, as tall as the day's visits against the company's busiest day. */
function Timeline({ series, label }: { series: readonly number[]; label: string }) {
  const peak = Math.max(1, ...series);
  const width = Math.max(series.length * 6, 60);
  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${width} 28`} width="100%" height="28" preserveAspectRatio="none" aria-hidden="true" className="max-w-xs">
        <line x1="0" y1="27.5" x2={width} y2="27.5" stroke="var(--chart-grid)" strokeWidth="1" />
        {series.map((n, i) =>
          n > 0 ? <rect key={i} x={i * (width / series.length) + 0.5} y={28 - Math.max(3, (n / peak) * 26)} width={Math.max(1.5, width / series.length - 1.5)} height={Math.max(3, (n / peak) * 26)} rx="1" fill="var(--chart-1)" /> : null,
        )}
      </svg>
      <figcaption className="text-caption text-muted">{label}</figcaption>
    </figure>
  );
}

export function CompaniesView({ base, lang, timeZone, state, owner, marketless, days, summaries, companies, words: w }: CompaniesViewProps) {
  const settings = `${base}/analytics/settings#companies`;
  if (state === "off" && summaries.length === 0) {
    return (
      <EmptyState
        title={w.off}
        action={
          owner ? (
            <ButtonLink kind="main" href={settings}>
              {w.turnOnLink}
            </ButtonLink>
          ) : undefined
        }
      >
        {w.description}
      </EmptyState>
    );
  }
  const from = days[0] ? adminDay(days[0], "dayMonth", lang) : "";
  const to = days.length > 0 ? adminDay(days[days.length - 1], "dayMonth", lang) : "";
  const shown = summaries.filter((s) => companies.has(s.companyId));
  return (
    <div className="flex flex-col gap-6">
      {state === "off" ? (
        <Note title={w.off}>
          {owner ? (
            <AdminLink href={settings} className="underline">
              {w.turnOnLink}
            </AdminLink>
          ) : null}
        </Note>
      ) : null}
      {state === "not_connected" ? <Note tone="warning">{w.notConnected}</Note> : null}
      {shown.length === 0 ? (
        <EmptyState title={state === "waiting" ? w.waiting : w.emptyPeriod} />
      ) : (
        <ul className="flex flex-col gap-4" aria-label={w.phoneLead}>
          {shown.map((s) => {
            const c = companies.get(s.companyId)!;
            const facts = factsLine(c, w);
            const more = s.pages.length - PAGES_SHOWN;
            return (
              <li key={s.companyId} className={card}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-title break-words text-ink">{c.name}</h3>
                    {facts ? <p className="text-sm text-muted">{facts}</p> : null}
                    {c.domain ? (
                      <p className="text-sm">
                        <a href={`https://${c.domain}`} className="underline" rel="noopener noreferrer nofollow" target="_blank">
                          {c.domain}
                        </a>
                      </p>
                    ) : null}
                  </div>
                  <div className="sm:text-right">
                    <p className="text-body-strong text-ink">{s.visits === 1 ? w.visit : fillWords(w.visits, { n: formatCount(s.visits) })}</p>
                    <p className="text-sm text-muted">{s.days === 1 ? w.day : fillWords(w.days, { n: formatCount(s.days) })}</p>
                    <p className="text-caption text-muted">{fillWords(w.lastSeen, { date: adminDate(timeZone, s.lastSeen, "dayTime", lang) })}</p>
                  </div>
                </div>
                <Timeline series={s.series} label={fillWords(w.timeline, { from, to })} />
                {s.pages.length > 0 ? (
                  <div className="flex flex-col gap-1">
                    <h4 className="text-sm font-medium text-ink">{w.pagesTitle}</h4>
                    <ul className="flex flex-wrap gap-2 text-sm">
                      {s.pages.slice(0, PAGES_SHOWN).map((p) => (
                        <li key={p.page} className="rounded-pill border border-line bg-sunken px-3 py-1 break-all">
                          {pageText(p.page, marketless, w)} <span className="text-muted">· {formatCount(p.views)}</span>
                        </li>
                      ))}
                      {more > 0 ? <li className="px-1 py-1 text-muted">{fillWords(w.morePages, { n: formatCount(more) })}</li> : null}
                    </ul>
                  </div>
                ) : null}
                {c.doNotContact ? <p className="text-caption text-warning-text">{w.doNotContact}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
      <p className="text-caption text-muted">
        {w.note} {w.source}
      </p>
    </div>
  );
}
