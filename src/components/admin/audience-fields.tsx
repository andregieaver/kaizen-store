"use client";

import { useState } from "react";

import { settingsEn } from "@/lib/admin-messages/settings.en";
import type { StoreAudience } from "@/lib/b2b";

import { useAdminText } from "./admin-text";

/** Who a store sells to, in words: English, as read by code that has no account's language. */
export const AUDIENCE_LABELS: Record<StoreAudience, string> = settingsEn.company.audience.labels;

const AUDIENCES: readonly StoreAudience[] = ["consumers", "businesses", "both"];

/** Who the store sells to (B2B), and for stores selling to both, whether first-time visitors are asked. */
export function AudienceFields({ audience, businessPopup }: { audience: StoreAudience; businessPopup: boolean }) {
  const w = useAdminText("settings").company.audience;
  const [chosen, setChosen] = useState(audience);
  return (
    <>
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">{w.legend}</legend>
        {AUDIENCES.map((value) => (
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
              {w.labels[value]}
              <span className="block text-muted">{w.hints[value]}</span>
            </span>
          </label>
        ))}
      </fieldset>
      {chosen === "both" && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="businessPopup" defaultChecked={businessPopup} className="mt-0.5 size-4" />
          <span>
            {w.popup}
            <span className="block text-muted">{w.popupHint}</span>
          </span>
        </label>
      )}
    </>
  );
}
