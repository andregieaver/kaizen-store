"use client";

import { useEffect, useState } from "react";

import { CONSENT_CHANGED_EVENT } from "@/lib/cookie-consent";
import { mayKeepReferral, normalizeReferralCode, readReferralCookie, referralCodeFor, referralCookie } from "@/lib/referrals";

/**
 * Carries a referral code into the sign-up form (D131): the code of the link the visitor came by (`?ref=` in the address,
 * last click winning), else the one the cookie kept. It travels in the form's hidden field, so signing up in the same
 * visit needs no cookie. The cookie (`kaizen_ref`, marketing) is written only after the visitor has allowed that
 * category, now or later in the visit (D58); nothing is stored before. All it says is a neutral "invited" line: never who
 * invited.
 */
export function ReferralKeeper({ enabled, days }: { enabled: boolean; days: number }) {
  const [code, setCode] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const fromAddress = normalizeReferralCode(new URLSearchParams(window.location.search).get("ref"));
    const keep = () => {
      if (!fromAddress || !mayKeepReferral(document.cookie)) return;
      const cookie = referralCookie(fromAddress, days, window.location.protocol === "https:");
      if (cookie) document.cookie = cookie;
    };
    // The address is the latest link; the cookie (there only after consent) is what an earlier visit left.
    const frame = requestAnimationFrame(() => setCode(referralCodeFor(fromAddress, readReferralCookie(document.cookie))));
    keep();
    window.addEventListener(CONSENT_CHANGED_EVENT, keep);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener(CONSENT_CHANGED_EVENT, keep);
    };
  }, [enabled, days]);

  if (!enabled || !code) return null;
  return (
    <>
      <input type="hidden" name="ref" value={code} />
      <p role="status" className="rounded-md border border-border p-3 text-sm">
        You were invited to Kaizen. Ask for a store below.
      </p>
    </>
  );
}
