"use client";

import { useState } from "react";

import type { StoreAudience } from "@/lib/b2b";

export const AUDIENCE_LABELS: Record<StoreAudience, string> = {
  consumers: "Consumers",
  businesses: "Businesses",
  both: "Consumers and businesses",
};

const AUDIENCE_HINTS: Record<StoreAudience, string> = {
  consumers: "Prices are shown and entered with VAT.",
  businesses: "Prices are shown and entered without VAT. Every order takes a company name and organisation number.",
  both: "Shoppers choose Private or Business in the header; businesses see prices without VAT. Products can be for everyone, only private shoppers or only businesses.",
};

/** Who the store sells to (B2B), and for stores selling to both, whether first-time visitors are asked. */
export function AudienceFields({ audience, businessPopup }: { audience: StoreAudience; businessPopup: boolean }) {
  const [chosen, setChosen] = useState(audience);
  return (
    <>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">The store sells to</legend>
        {(Object.keys(AUDIENCE_LABELS) as StoreAudience[]).map((value) => (
          <label key={value} className="flex items-start gap-2">
            <input
              type="radio"
              name="audience"
              value={value}
              checked={chosen === value}
              onChange={() => setChosen(value)}
              className="mt-0.5 size-4"
            />
            <span>
              {AUDIENCE_LABELS[value]}
              <span className="block text-muted">{AUDIENCE_HINTS[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {chosen === "both" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="businessPopup" defaultChecked={businessPopup} className="mt-0.5 size-4" />
          <span>
            Ask first-time visitors
            <span className="block text-muted">
              A short question when someone first comes to the store: are they shopping privately or for a business? They can
              change it in the header at any time.
            </span>
          </span>
        </label>
      )}
    </>
  );
}
