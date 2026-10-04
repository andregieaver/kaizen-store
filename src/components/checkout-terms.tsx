"use client";

import { useId } from "react";

import { sentenceParts, type TermsDisplay, type TermsPage } from "@/lib/checkout-terms";

import { setTicked, termsKey, useTicked } from "./terms-choice";

/**
 * The sentence by the pay button (wave 1, 1e, `docs/wave-1-trust.md` 2.4): in `link` mode "By ordering you accept {the
 * terms}" with the store's pages as links, in `checkbox` mode the same words next to a box the shopper ticks. The links
 * open in a new tab so the checkout is not lost. The words come in `template`, with the links' places marked, in the
 * shopper's language; nothing here is a legal text of ours, the pages are the store's. The tick lives in memory (`terms-choice.ts`).
 */
export function CheckoutTerms({
  store,
  market,
  display,
  template,
  newTab,
}: {
  store: string;
  market: string;
  display: TermsDisplay;
  /** The sentence for this mode with `{terms}` and `{privacy}` where the links go (`termsTemplate()`). */
  template: string;
  /** "(opens in a new tab)", read by a screen reader after each link. */
  newTab: string;
}) {
  const id = useId();
  const key = termsKey(store, market);
  const ticked = useTicked(key);
  const pageOf = (role: TermsPage["role"]) => display.pages.find((page) => page.role === role);
  const sentence = sentenceParts(template).map((part, index) => {
    if ("text" in part) return <span key={index}>{part.text}</span>;
    const page = pageOf(part.role);
    return page ? (
      <a key={index} href={page.href} target="_blank" rel="noopener" className="underline">
        {page.title}
        <span className="sr-only"> {newTab}</span>
      </a>
    ) : null;
  });
  if (display.mode === "checkbox") {
    return (
      <div className="flex items-start gap-3 text-sm" data-terms="checkbox">
        <input
          id={`${id}-tick`}
          type="checkbox"
          required
          checked={ticked}
          onChange={(event) => setTicked(key, event.target.checked)}
          className="mt-0.5 size-5 shrink-0"
        />
        <label htmlFor={`${id}-tick`}>{sentence}</label>
      </div>
    );
  }
  return (
    <p className="text-sm text-muted" data-terms="link">
      {sentence}
    </p>
  );
}
