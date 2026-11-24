import type { ReactNode } from "react";

import { adminDate, adminDay } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, type AdminLang } from "@/lib/admin-lang";
import type { RegisterFactsMessages } from "@/lib/admin-messages/register-facts.en";
import { compactMoney, revenueChange, type RegisterView } from "@/lib/register-facts";

import { Card, Chip } from "./ui";

/**
 * A company's facts from Brønnøysundregistrene (D891), drawn on the server from plain props: on a store's business customer, on a store's
 * own business in the platform's admin. A red flag (bankrupt, being wound up, dissolved, deleted) comes first, with what to do when the
 * company buys on payment terms; then what it is (industry, size, age, place, website) and its latest accounts. The register's words are
 * text, never markup. Homer reads it at a glance; there is nothing to set.
 */

export type RegisterFactsCardProps = {
  /** What is kept of the number; null when the register has not answered yet. */
  view: RegisterView | null;
  words: RegisterFactsMessages;
  lang: AdminLang;
  /** The company buys on payment terms: a red flag then says to turn them off. */
  termsOn?: boolean;
  /** Something to draw above the facts (the platform's legal name and number). */
  lead?: ReactNode;
  title?: string;
};

/** A signed whole percent, "+12 %" / "−8 %". */
function signedPercent(change: number, locale: string): string {
  const text = new Intl.NumberFormat(locale, { style: "percent", signDisplay: "exceptZero", maximumFractionDigits: 0 }).format(change / 100);
  return text.replace("-", "−");
}

export function RegisterFactsCard({ view, words: w, lang, termsOn = false, lead, title }: RegisterFactsCardProps) {
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const day = (iso: string | null) => (iso ? adminDay(iso, "day", lang) : "");
  const money = (minor: number | null, currency: string) => (minor === null ? null : compactMoney(minor, currency, locale));
  const body = (() => {
    if (!view) return <p className="text-sm text-muted">{w.notLookedUp}</p>;
    if (view.status === "not_found") return <p className="text-sm text-muted">{w.notFound}</p>;
    if (view.status === "sole_trader" || !view.facts) return <p className="text-sm text-muted">{w.soleTrader}</p>;
    const f = view.facts;
    const a = view.accounts;
    const change = a ? revenueChange(a) : null;
    const rows: { label: string; value: ReactNode }[] = [];
    if (f.industryName) rows.push({ label: w.industry, value: f.industryName });
    if (f.employees !== null) rows.push({ label: w.employees, value: new Intl.NumberFormat(locale).format(f.employees) });
    if (f.founded) rows.push({ label: w.founded, value: day(f.founded) });
    if (f.municipality) rows.push({ label: w.place, value: f.municipality });
    if (f.website) {
      rows.push({
        label: w.website,
        value: (
          <a href={`https://${f.website}`} className="underline" rel="noopener noreferrer nofollow" target="_blank">
            {f.website}
          </a>
        ),
      });
    }
    if (a && a.revenueMinor !== null) {
      rows.push({
        label: fillWords(w.revenue, { year: a.year }),
        value: (
          <>
            {money(a.revenueMinor, a.currency)}
            {change !== null ? <span className="text-muted"> · {fillWords(w.change, { change: signedPercent(change, locale) })}</span> : null}
          </>
        ),
      });
    }
    if (a && a.operatingResultMinor !== null) rows.push({ label: w.operatingResult, value: money(a.operatingResultMinor, a.currency) });
    if (a && a.profitMinor !== null) rows.push({ label: w.profit, value: money(a.profitMinor, a.currency) });
    if (a && a.equityMinor !== null) rows.push({ label: w.equity, value: money(a.equityMinor, a.currency) });
    return (
      <div className="flex flex-col gap-3">
        {f.redFlag ? (
          <div role="alert" className="flex flex-col gap-1 rounded-panel border border-(--chart-bad) bg-danger-soft px-3 py-2 text-sm text-danger-text">
            <p className="font-medium">{fillWords(w.flags[f.redFlag], { day: day(f.redFlagOn) })}</p>
            {termsOn ? <p>{w.termsAdvice}</p> : null}
          </div>
        ) : null}
        {rows.length > 0 ? (
          <dl className="grid grid-cols-[minmax(8rem,auto)_1fr] gap-x-6 gap-y-1 text-sm">
            {rows.map((row) => (
              <div key={row.label} className="contents">
                <dt className="text-muted">{row.label}</dt>
                <dd className="text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        ) : null}
        {a && a.equityMinor !== null && a.equityMinor < 0 && !f.redFlag ? <p className="text-sm text-warning-text">{w.negativeEquity}</p> : null}
        {!a ? <p className="text-sm text-muted">{w.noAccounts}</p> : null}
        <p className="text-caption text-muted">{fillWords(w.source, { date: adminDate(null, view.checkedAt, "day", lang) })}</p>
      </div>
    );
  })();
  const flag = view?.facts?.redFlag ?? null;
  return (
    <Card title={title ?? w.title} compact aside={flag ? <Chip signal="danger" dot>{w.shortFlags[flag]}</Chip> : undefined}>
      <div className="flex flex-col gap-3">
        {lead}
        {body}
      </div>
    </Card>
  );
}

/**
 * A visiting company's facts in a line (D891, the Visiting companies page): its latest revenue and the year it was founded, and its red flag
 * as a chip. Nothing for a number the register has not answered, a sole trader or one it does not know.
 */
export function RegisterLine({ view, words: w, lang }: { view: RegisterView | undefined; words: RegisterFactsMessages; lang: AdminLang }) {
  if (!view || view.status !== "company" || !view.facts) return null;
  const locale = ADMIN_LANG_FACTS[lang].locale;
  const parts: string[] = [];
  const a = view.accounts;
  if (a && a.revenueMinor !== null) parts.push(fillWords(w.line.revenue, { amount: compactMoney(a.revenueMinor, a.currency, locale), year: a.year }));
  if (view.facts.founded) parts.push(fillWords(w.line.founded, { year: view.facts.founded.slice(0, 4) }));
  const flag = view.facts.redFlag;
  if (parts.length === 0 && !flag) return null;
  return (
    <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
      {flag ? <Chip signal="danger" dot>{w.shortFlags[flag]}</Chip> : null}
      {parts.length > 0 ? <span>{parts.join(" · ")}</span> : null}
    </p>
  );
}
