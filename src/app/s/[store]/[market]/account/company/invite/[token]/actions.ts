"use server";

import { t } from "@/lib/i18n";
import { acceptInvite } from "@/server/companies";
import { resolveFeatureShop } from "@/server/shop";

export type AcceptState = { done: boolean; message: string | null; email: string; existing: boolean; already: boolean };

/** Accepts an invitation from the page its emailed link opens. Says why when it cannot be. */
export async function acceptInviteAction(storeSlug: string, marketSlug: string, token: string, previous: AcceptState): Promise<AcceptState> {
  // Company accounts are part of selling to businesses (D178): nothing is accepted while it is switched off.
  const shop = await resolveFeatureShop(storeSlug, marketSlug, "business");
  if (!shop) return { ...previous, message: null };
  const m = t(shop.market.lang).companyAccount;
  const result = await acceptInvite(shop.store.id, token, { marketCode: shop.market.code, locale: shop.market.locale });
  if (!result.ok) {
    const problems = { gone: m.problemGone, expired: m.problemExpired, company_off: m.problemCompanyOff, full: m.problemFull, other_company: m.problemOtherCompany };
    return { ...previous, done: false, message: problems[result.problem] };
  }
  return { done: true, message: null, email: previous.email, existing: result.existing, already: result.alreadyMember };
}
