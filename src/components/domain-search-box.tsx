"use client";

import { useState, useTransition, type CSSProperties, type FormEvent } from "react";

import type { DomainOffer, SearchAnswer } from "@/lib/domain-search";
import { formatMoney } from "@/lib/money";

export type DomainSearchWords = {
  heading: string;
  placeholder: string;
  search: string;
  searching: string;
  states: Record<DomainOffer["state"], string>;
  firstYear: string;
  thenYearly: string;
  cta: string;
  unavailable: string;
  note: string;
  label: string;
};

/**
 * The domain search on Kaizena Flow's own pages (D315, `docs/domains.md` 16), in the visitor's browser: a box, a button, and the answers from
 * `/api/domains/search`, each free name with what it costs a year and a button to sign up with the name kept. No cookie, no storage.
 */
export function DomainSearchBox({
  words,
  tlds,
  currency,
  locale,
  ctaHref,
  button,
}: {
  words: DomainSearchWords;
  tlds: readonly string[];
  currency: string;
  locale: string;
  ctaHref: string;
  /** The site's button look (`buttonLook()`), drawn by the server so the theme's buttons apply. */
  button: { className: string; style: CSSProperties };
}) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<SearchAnswer | null>(null);
  const [pending, startTransition] = useTransition();

  const run = (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim()) return;
    const params = new URLSearchParams({ q: query, currency });
    if (tlds.length > 0) params.set("tlds", tlds.join(","));
    startTransition(async () => {
      try {
        const response = await fetch(`/api/domains/search?${params}`, { cache: "no-store" });
        setAnswer(response.ok ? ((await response.json()) as SearchAnswer) : { ok: false, reason: "unavailable", message: words.unavailable });
      } catch {
        setAnswer({ ok: false, reason: "unavailable", message: words.unavailable });
      }
    });
  };
  const money = (minor: number | null) => (minor !== null && answer?.ok && answer.currency ? formatMoney(minor, answer.currency, locale) : null);
  const signUp = (domain: string) => `${ctaHref}${ctaHref.includes("?") ? "&" : "?"}domain=${encodeURIComponent(domain)}`;

  return (
    <div className="flex flex-col gap-4" data-domain-search>
      {words.heading && (
        <p className="text-lg font-heading" data-kz-text="title">
          {words.heading}
        </p>
      )}
      <form onSubmit={run} className="flex flex-col gap-2 sm:flex-row" role="search" aria-busy={pending}>
        <label className="sr-only" htmlFor="kz-domain-search">
          {words.label}
        </label>
        <input
          id="kz-domain-search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={words.placeholder}
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          maxLength={200}
          className="min-h-11 flex-1 rounded-button border border-current/20 bg-transparent px-4"
          data-kz-text="input"
        />
        <button type="submit" className={button.className} style={button.style} disabled={pending} data-kz-text="button">
          {pending ? words.searching : words.search}
        </button>
      </form>
      <div aria-live="polite">
        {answer && !answer.ok && <p>{answer.reason === "unavailable" ? words.unavailable : answer.message}</p>}
        {answer?.ok && (
          <>
            <ul className="flex flex-col divide-y divide-current/10">
              {answer.offers.map((offer) => (
                <li key={offer.domain} className="flex flex-wrap items-center gap-3 py-3">
                  <span className="min-w-0 flex-1 break-all font-medium" data-kz-text="name">
                    {offer.domain}
                  </span>
                  <span className="text-sm opacity-80">{words.states[offer.state]}</span>
                  {offer.state === "available" && money(offer.firstYear) && (
                    <span className="text-sm" data-kz-text="price">
                      {words.firstYear.replace("{price}", money(offer.firstYear)!)}
                      {money(offer.renewal) ? `, ${words.thenYearly.replace("{price}", money(offer.renewal)!)}` : ""}
                    </span>
                  )}
                  {offer.state === "available" && (
                    <a href={signUp(offer.domain)} className={button.className} style={button.style} data-kz-text="button">
                      {words.cta}
                    </a>
                  )}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-sm opacity-70">{words.note}</p>
          </>
        )}
      </div>
    </div>
  );
}
