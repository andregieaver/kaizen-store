"use client";

import { useSyncExternalStore } from "react";

import { AFFILIATE_PARAM } from "@/lib/affiliates";
import { heldAffiliateCode, subscribeAffiliateCode } from "@/lib/affiliate-memory";

/**
 * The referral code the visitor arrived with (D131), as a hidden field of a form that adds to the cart or registers, so
 * the server keeps it with the cart or the new customer even when the visitor has not allowed a cookie: the code lives
 * in the page's memory only. Nothing when there is no code, so the form is unchanged. The server checks the code.
 */
export function AffiliateField({ store }: { store: string }) {
  const code = useSyncExternalStore(
    subscribeAffiliateCode,
    () => heldAffiliateCode(store),
    () => null,
  );
  return code ? <input type="hidden" name={AFFILIATE_PARAM} value={code} /> : null;
}
