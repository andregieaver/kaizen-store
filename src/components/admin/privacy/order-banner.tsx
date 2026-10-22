"use client";

import { useAdminLang, useAdminText } from "@/components/admin/admin-text";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS } from "@/lib/admin-lang";
import type { OrderPrivacy } from "@/server/privacy-pages";

import { dayText } from "./styles";

/**
 * The banner on an order whose personal data was restricted or made anonymous (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 5): a
 * restricted order is kept for the bookkeeping law with the person cut loose, to be used only for the accounts; an anonymised one shows
 * `[removed]` where the name, address and email were, and says when. Nothing is shown for an order nothing has happened to.
 */
export function OrderPrivacyBanner({ privacy }: { privacy: OrderPrivacy | null }) {
  const staff = useAdminText("privacy").staff;
  const locale = ADMIN_LANG_FACTS[useAdminLang()].locale;
  const day = (value: string) => dayText(value, undefined, locale);
  if (!privacy) return null;
  if (privacy.anonymisedOn) {
    return (
      <p role="status" className="rounded-md border border-line bg-card p-3 text-sm">
        {fillWords(staff.anonymisedBanner, { when: day(privacy.anonymisedOn) })}
      </p>
    );
  }
  if (privacy.restrictedOn) {
    return (
      <p role="status" className="rounded-md border border-line bg-card p-3 text-sm">
        {fillWords(staff.restrictedBanner, { since: day(privacy.restrictedOn), until: privacy.keptUntil ? day(privacy.keptUntil) : staff.endOfPeriod })}
      </p>
    );
  }
  return null;
}
