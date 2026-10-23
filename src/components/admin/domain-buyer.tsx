"use client";

import { useState, useTransition, type FormEvent } from "react";

import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import type { RegistrantPrefill } from "@/lib/domain-registrant";
import type { DomainOffer, SearchAnswer } from "@/lib/domain-search";
import { formatMoney } from "@/lib/money";

import { ActionForm, SubmitButton } from "./action-form";
import type { DomainAction, DomainSearch } from "./domain-types";
import { Button, Card, Chip } from "./ui";



const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * Getting a domain here (D315 4.2 and 4.4): one search box already holding the store's name, the answers with what each costs, and for a
 * free one a buy button that names the price. The registrant is filled in from the store and the owner and folded away: Homer only
 * presses Buy; Lisa opens *Registered to* to change it.
 */
export function DomainBuyer({
  search,
  buy,
  words,
  locale,
  initialQuery,
  canBuy,
  closedWhy,
  registrant,
}: {
  search: DomainSearch;
  buy: DomainAction;
  words: DomainsMessages["get"];
  locale: string;
  initialQuery: string;
  /** The owner, with buying open for the store. */
  canBuy: boolean;
  /** Why nothing can be bought here, when not. */
  closedWhy: string | null;
  registrant: RegistrantPrefill;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [chosen, setChosen] = useState<DomainOffer | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (minor: number | null, currency: string | null) => (minor !== null && currency ? formatMoney(minor, currency, locale) : null);

  const run = (event: FormEvent) => {
    event.preventDefault();
    setChosen(null);
    startTransition(async () => setAnswer(await search(query)));
  };

  const currency = answer?.ok ? answer.currency : null;

  return (
    <Card title={words.title} description={words.intro}>
      {chosen && currency && chosen.firstYear !== null ? (
        <ActionForm action={buy} className="flex flex-col gap-4" replaceOnSuccess>
          <h3 className="text-title text-ink">{words.buyTitle.replace("{domain}", chosen.domain)}</h3>
          <input type="hidden" name="domain" value={chosen.domain} />
          <input type="hidden" name="years" value="1" />
          <input type="hidden" name="agreed" value={`${currency}:${chosen.firstYear}`} />
          <p className="text-body text-ink-2">
            {words.firstYear.replace("{price}", money(chosen.firstYear, currency)!)}
            {chosen.renewal !== null ? `, ${words.thenYearly.replace("{price}", money(chosen.renewal, currency)!)}` : ""}
          </p>
          <label className="flex items-center gap-2 text-body">
            <input type="checkbox" name="connect" defaultChecked />
            {words.connect}
          </label>
          <details className="rounded-panel border border-line p-4">
            <summary className="cursor-pointer text-body">
              {words.registrant}: {registrant.kind === "company" && registrant.companyName ? registrant.companyName : `${registrant.firstName} ${registrant.lastName}`.trim()}
              {registrant.email ? `, ${registrant.email}` : ""}
            </summary>
            <p className="mt-2 text-caption text-muted">{words.registrantNote}</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm">
                {words.registrant}
                <select name="kind" defaultValue={registrant.kind} className={input}>
                  <option value="person">{words.person}</option>
                  <option value="company">{words.company}</option>
                </select>
              </label>
              {(
                [
                  ["companyName", words.companyName, registrant.companyName, false],
                  ["orgNumber", words.orgNumber, registrant.orgNumber, false],
                  ["firstName", words.firstName, registrant.firstName, true],
                  ["lastName", words.lastName, registrant.lastName, true],
                  ["email", words.email, registrant.email, true],
                  ["phone", words.phone, registrant.phone, true],
                  ["address1", words.address1, registrant.address1, true],
                  ["address2", words.address2, "", false],
                  ["postalCode", words.postalCode, registrant.postalCode, true],
                  ["city", words.city, registrant.city, true],
                  ["state", words.state, "", false],
                  ["country", words.country, registrant.country, true],
                ] as const
              ).map(([name, label, value, required]) => (
                <label key={name} className="flex flex-col gap-1 text-sm">
                  {label}
                  <input name={name} defaultValue={value} required={required} className={input} autoComplete="off" />
                </label>
              ))}
            </div>
          </details>
          <p className="text-caption text-muted">{words.payNote}</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton>{words.buy.replace("{price}", money(chosen.firstYear, currency)!)}</SubmitButton>
            <Button kind="secondary" type="button" onClick={() => setChosen(null)}>
              {words.back}
            </Button>
          </div>
        </ActionForm>
      ) : (
        <div className="flex flex-col gap-4">
          <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-busy={pending}>
            <label className="flex flex-1 flex-col gap-1 text-sm">
              {words.label}
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={words.placeholder}
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
                className={input}
                maxLength={200}
              />
            </label>
            <Button kind="strong" type="submit" disabled={pending || !query.trim()}>
              {pending ? words.searching : words.search}
            </Button>
          </form>
          {closedWhy && <p className="text-body text-muted">{closedWhy}</p>}
          {answer && !answer.ok && (
            <p role="status" className="text-body text-ink-2">
              {answer.message}
            </p>
          )}
          {answer?.ok && (
            <ul className="flex flex-col divide-y divide-line" aria-live="polite">
              {answer.offers.map((offer) => (
                <li key={offer.domain} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 text-body-strong text-ink">{offer.domain}</span>
                  <Chip signal={offer.state === "available" ? "positive" : offer.state === "yours" ? "insight" : "neutral"}>{words.states[offer.state]}</Chip>
                  {offer.state === "available" && (
                    <span className="text-body text-ink-2">
                      {offer.firstYear !== null && currency ? words.firstYear.replace("{price}", money(offer.firstYear, currency)!) : words.noPrice}
                    </span>
                  )}
                  {offer.state === "available" && canBuy && offer.firstYear !== null && currency && (
                    <Button kind="secondary" type="button" onClick={() => setChosen(offer)}>
                      {words.choose}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
