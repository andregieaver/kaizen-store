"use client";

import { useEffect, useState, useTransition, type FormEvent } from "react";

import type { DomainsMessages } from "@/lib/admin-messages/domains.en";
import type { RegistrantPrefill } from "@/lib/domain-registrant";
import type { DomainOffer, SearchAnswer } from "@/lib/domain-search";
import { formatMoney } from "@/lib/money";

import { ActionForm, SubmitButton } from "./action-form";
import { RegistrantFields } from "./domain-buyer";
import type { CheckoutActions, CheckoutBuyer, CheckoutQuote } from "./domain-types";
import { Button, Card, Chip } from "./ui";

const input = "min-h-10 w-full rounded-md border border-line bg-card px-3 text-sm";

/**
 * Buying a domain without a store (D317 3 and 6): a search, then who buys (a private person in Norway, or a business anywhere with its VAT
 * number in the EU), the price with the VAT the invoice will carry worked out on the server, a consumer's consent that registration starts
 * once it is paid, and Pay, which opens Stripe's page for the invoice.
 */
export function DomainCheckout({
  words,
  get,
  locale,
  initialQuery,
  registrant,
  actions,
}: {
  words: DomainsMessages["checkout"];
  get: DomainsMessages["get"];
  locale: string;
  initialQuery: string;
  registrant: RegistrantPrefill;
  actions: CheckoutActions;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [chosen, setChosen] = useState<DomainOffer | null>(null);
  const [buyer, setBuyer] = useState<CheckoutBuyer>({ kind: "consumer", country: registrant.country || "NO", vatNumber: "" });
  const [quote, setQuote] = useState<CheckoutQuote | null>(null);
  const [pending, startTransition] = useTransition();
  const money = (minor: number, currency: string) => formatMoney(minor, currency, locale);

  const search = (text: string) => {
    if (!text.trim()) return;
    setChosen(null);
    startTransition(async () => setAnswer(await actions.search(text)));
  };
  useEffect(() => {
    if (!chosen) return;
    let live = true;
    const timer = setTimeout(() => {
      void actions.quote(chosen.domain, buyer).then((q) => live && setQuote(q));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [chosen, buyer, actions]);

  const run = (event: FormEvent) => {
    event.preventDefault();
    search(query);
  };

  if (chosen) {
    const q = quote?.ok && quote.domain === chosen.domain ? quote : null;
    return (
      <Card title={get.buyTitle.replace("{domain}", chosen.domain)} description={words.intro}>
        <ActionForm action={actions.buy} className="flex flex-col gap-4">
          <input type="hidden" name="domain" value={chosen.domain} />
          <input type="hidden" name="years" value="1" />
          <input type="hidden" name="agreed" value={q ? `${q.currency}:${q.amountMinor}` : ""} />
          <fieldset className="flex flex-col gap-2">
            <legend className="text-body-strong text-ink">{words.who}</legend>
            {(["consumer", "business"] as const).map((kind) => (
              <label key={kind} className="flex items-center gap-2 text-body">
                <input type="radio" name="buyer" value={kind} checked={buyer.kind === kind} onChange={() => setBuyer({ ...buyer, kind })} />
                {words[kind]}
              </label>
            ))}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="flex flex-col gap-1 text-sm">
              {words.country}
              <input name="buyerCountry" value={buyer.country} maxLength={2} onChange={(e) => setBuyer({ ...buyer, country: e.target.value.toUpperCase() })} className={input} required />
            </label>
            {buyer.kind === "business" && buyer.country !== "NO" && (
              <label className="flex flex-col gap-1 text-sm">
                {words.vatNumber}
                <input name="vatNumber" value={buyer.vatNumber} onChange={(e) => setBuyer({ ...buyer, vatNumber: e.target.value })} className={input} />
                <span className="text-caption text-muted">{words.vatNumberHint}</span>
              </label>
            )}
          </div>
          <div aria-live="polite" className="flex flex-col gap-1 rounded-panel bg-sunken p-4 text-body">
            {quote && !quote.ok && <p className="text-danger-text">{quote.problems.join(" ")}</p>}
            {q && (
              <>
                <span>{words.price.replace("{price}", money(q.amountMinor, q.currency))}</span>
                <span className="text-ink-2">
                  {q.vatKind === "mva"
                    ? words.vat.replace("{rate}", String(q.ratePercent)).replace("{amount}", money(q.vatMinor, q.currency))
                    : q.vatKind === "reverse_charge"
                      ? words.reverseCharge
                      : words.outsideScope}
                </span>
                <span className="text-body-strong text-ink">{words.total.replace("{price}", money(q.totalMinor, q.currency))}</span>
              </>
            )}
          </div>
          <RegistrantFields registrant={registrant} words={get} />
          {buyer.kind === "consumer" && (
            <label className="flex items-start gap-2 text-body">
              <input type="checkbox" name="consent" required className="mt-1" />
              {words.consent}
            </label>
          )}
          <p className="text-caption text-muted">{words.payNote}</p>
          <div className="flex flex-wrap gap-2">
            <SubmitButton disabled={!q}>{q ? words.pay.replace("{price}", money(q.totalMinor, q.currency)) : words.open}</SubmitButton>
            <Button kind="secondary" type="button" onClick={() => setChosen(null)}>
              {get.back}
            </Button>
          </div>
        </ActionForm>
      </Card>
    );
  }

  return (
    <Card title={words.title} description={words.intro}>
      <div className="flex flex-col gap-4">
        <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row sm:items-end" aria-busy={pending}>
          <label className="flex flex-1 flex-col gap-1 text-sm">
            {get.label}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={get.placeholder}
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={input}
              maxLength={200}
            />
          </label>
          <Button kind="strong" type="submit" disabled={pending || !query.trim()}>
            {pending ? get.searching : get.search}
          </Button>
        </form>
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
                <Chip signal={offer.state === "available" ? "positive" : offer.state === "yours" ? "insight" : "neutral"}>{get.states[offer.state]}</Chip>
                {offer.state === "available" && offer.firstYear !== null && answer.currency && (
                  <span className="text-body text-ink-2">{get.firstYear.replace("{price}", money(offer.firstYear, answer.currency))}</span>
                )}
                {offer.state === "available" && offer.firstYear !== null && (
                  <Button kind="secondary" type="button" onClick={() => setChosen(offer)}>
                    {get.choose}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
