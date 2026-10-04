import { STAFF_TEXT } from "@/lib/privacy-text";
import type { OrderPrivacy } from "@/server/privacy-pages";

import { dayText } from "./styles";

/**
 * The banner on an order whose personal data was restricted or made anonymous (wave 1, 1g, D162, `docs/wave-1g-gdpr.md` 2.3 item 5): a
 * restricted order is kept for the bookkeeping law with the person cut loose, to be used only for the accounts; an anonymised one shows
 * `[removed]` where the name, address and email were, and says when. Nothing is shown for an order nothing has happened to.
 */
export function OrderPrivacyBanner({ privacy }: { privacy: OrderPrivacy | null }) {
  if (!privacy) return null;
  if (privacy.anonymisedOn) {
    return (
      <p role="status" className="rounded-md border border-border bg-background p-3 text-sm">
        {STAFF_TEXT.anonymisedBanner(dayText(privacy.anonymisedOn))}
      </p>
    );
  }
  if (privacy.restrictedOn) {
    return (
      <p role="status" className="rounded-md border border-border bg-background p-3 text-sm">
        {STAFF_TEXT.restrictedBanner(dayText(privacy.restrictedOn), privacy.keptUntil ? dayText(privacy.keptUntil) : "the end of the period")}
      </p>
    );
  }
  return null;
}
