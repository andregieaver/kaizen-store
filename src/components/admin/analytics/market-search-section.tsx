import { ActionForm, SubmitButton, type FormState } from "@/components/admin/action-form";
import { adminDate } from "@/lib/admin-date";
import { fillWords } from "@/lib/admin-fill";
import type { AdminLang } from "@/lib/admin-lang";
import type { MarketCheckMessages } from "@/lib/admin-messages/market-check.en";
import { formatCount } from "@/lib/analytics-core";
import type { KeptSearchTerm } from "@/server/market-search";

import { CARD_CLASS } from "../ui/card";
import { EmptyState } from "../ui/empty-state";
import { Field, Select, TextInput } from "../ui/field";
import { StatusPill } from "./data-table";
import { AnalyticsSection, Note } from "./section";

/**
 * Where you come up in search, on Analytics → Markets (D905 M5b, `docs/market-check.md` 7.3): the words the store follows in each country,
 * and where its site and each rival's came up on the first page when last searched, each place counted by code (`placesIn()`), with the
 * store's change since the search before. Following a word is a person's act; the dispatcher searches it monthly. Drawn on the server; the
 * forms post to the page's one rivals action.
 */

type Action = (state: FormState, form: FormData) => Promise<FormState>;

export type MarketSearchProps = {
  lang: AdminLang;
  timeZone: string;
  words: MarketCheckMessages["search"];
  terms: readonly KeptSearchTerm[];
  countries: readonly { code: string; name: string }[];
  /** The store's own most searched words, offered as ideas. */
  ideas: readonly string[];
  /** Whether the platform's search service is set up: words wait until it is. */
  searchOn: boolean;
  actions: { add: Action; remove: Action } | null;
};

export function MarketSearchSection({ lang, timeZone, words: w, terms, countries, ideas, searchOn, actions }: MarketSearchProps) {
  const names = new Map(countries.map((c) => [c.code, c.name]));
  const place = (n: number | null) => (n === null ? w.notFound : fillWords(w.number, { n: formatCount(n) }));
  const day = (iso: string) => adminDate(timeZone, iso, "day", lang);
  const line = (t: KeptSearchTerm) => {
    if (!t.checkedAt) return t.problem === "failed" && t.triedAt ? fillWords(w.failed, { date: day(t.triedAt) }) : w.waiting;
    const moved = t.previous !== null && t.own !== null && t.previous !== t.own ? ` (${fillWords(t.previous > t.own ? w.up : w.down, { n: formatCount(Math.abs(t.previous - t.own)) })})` : "";
    return [`${w.you}: ${place(t.own)}${moved}`, ...t.rivals.map((r) => `${r.name}: ${place(r.position)}`), fillWords(w.checked, { date: day(t.checkedAt) })].join(" · ");
  };
  return (
    <AnalyticsSection id="market-search" title={w.title} description={w.description} level={3}>
      {searchOn ? null : <Note>{w.off}</Note>}
      {terms.length === 0 ? (
        <EmptyState compact title={w.none} />
      ) : (
        <ul className={`divide-y divide-line ${CARD_CLASS}`} data-search-terms>
          {terms.map((t) => (
            <li key={t.id} data-search-term={t.term} className="flex flex-col gap-1 px-4 py-3 text-sm">
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <StatusPill>{names.get(t.market) ?? t.market}</StatusPill>
                <span className="text-body-strong text-ink">{t.term}</span>
                {actions ? (
                  <ActionForm action={actions.remove} className="ml-auto" successMessage={w.removed}>
                    <input type="hidden" name="term" value={t.id} />
                    <SubmitButton variant="secondary">
                      {w.remove}
                      <span className="sr-only">{` ${t.term}`}</span>
                    </SubmitButton>
                  </ActionForm>
                ) : null}
              </span>
              <span className="text-muted">{line(t)}</span>
            </li>
          ))}
        </ul>
      )}
      {actions ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <ActionForm action={actions.add} replaceOnSuccess className={`flex flex-col gap-3 p-4 ${CARD_CLASS}`}>
            <Field label={w.country} required>
              {(control) => (
                <Select name="market" {...control} full defaultValue={countries[0]?.code}>
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label={w.term} required>
              {(control) => <TextInput name="term" maxLength={80} placeholder={w.termHint} list="search-term-ideas" autoComplete="off" full {...control} />}
            </Field>
            {ideas.length > 0 ? (
              <datalist id="search-term-ideas">
                {ideas.map((idea) => (
                  <option key={idea} value={idea} />
                ))}
              </datalist>
            ) : null}
            <div>
              <SubmitButton>{w.add}</SubmitButton>
            </div>
          </ActionForm>
        </div>
      ) : null}
    </AnalyticsSection>
  );
}
