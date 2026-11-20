"use client";

import { OPEN_CONSENT_EVENT, PENDING_OPEN, type PendingWindow } from "@/lib/consent-open";

/** A button that opens the cookie choices (on the cookie page and in the footer). */
export function CookieSettingsButton({ label, className }: { label: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => {
        (window as PendingWindow)[PENDING_OPEN] = true;
        window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
      }}
      className={className}
    >
      {label}
    </button>
  );
}
