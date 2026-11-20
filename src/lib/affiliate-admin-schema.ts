import type { AffiliateSettings } from "./affiliates";
import { fillWords } from "./admin-fill";
import type { LoyaltyMessages } from "./admin-messages/loyalty.en";
import { affiliateSettingsInput } from "./affiliates-schema";
import { percentTextToBps } from "./bonus-admin";
import { parsePrice } from "./product-input";
import type { AffiliateField, AffiliateFormRead, AffiliateFormValues } from "./affiliate-admin";

/**
 * The referral program's settings form read and checked in the browser (D131, bloat review step 2.46): readAffiliateForm() runs
 * affiliateSettingsInput, the server's own check, so the settings form imports it from here; the words, examples and attribution
 * helpers stay in affiliate-admin.ts, which loads no zod.
 */

const wholeNumber = (text: string): number | null => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * The form read into settings, checked with `affiliateSettingsInput` (the server's own check). Every field that is
 * wrong gets its own message, in the words of the contract where it has them.
 */
export function readAffiliateForm(
  values: AffiliateFormValues,
  currency: string,
  w: LoyaltyMessages["affiliate"]["errors"],
): AffiliateFormRead {
  const errors: Partial<Record<AffiliateField, string>> = {};

  const friendPercent = wholeNumber(values.friendPercent);
  if (friendPercent === null) errors.friendPercent = w.friendPercent;

  let friendMaxMinor: number | null = null;
  if (values.friendMax.trim() !== "") {
    friendMaxMinor = parsePrice(values.friendMax, currency);
    if (friendMaxMinor === null) errors.friendMax = fillWords(w.friendMax, { currency });
  }

  const rewardBps = percentTextToBps(values.rewardPercent);
  if (rewardBps === null) errors.rewardPercent = w.rewardPercent;

  let rewardOrders: number | null = null;
  if (values.rewardScope === "limited") {
    rewardOrders = wholeNumber(values.rewardOrders);
    if (rewardOrders === null) errors.rewardOrders = w.rewardOrders;
  }

  let monthlyCapMinor: number | null = null;
  if (values.monthlyCap.trim() !== "") {
    monthlyCapMinor = parsePrice(values.monthlyCap, currency);
    if (monthlyCapMinor === null) errors.monthlyCap = fillWords(w.monthlyCap, { currency });
  }

  const cookieDays = wholeNumber(values.cookieDays);
  if (cookieDays === null) errors.cookieDays = w.cookieDays;

  const parsed = affiliateSettingsInput.safeParse({
    enabled: values.enabled,
    rewardBps: rewardBps ?? 0,
    rewardOrders: values.rewardScope === "limited" ? (rewardOrders ?? 1) : null,
    friendPercent: friendPercent ?? 0,
    friendMaxMinor,
    monthlyCapMinor,
    cookieDays: cookieDays ?? 30,
  });
  if (!parsed.success) {
    const fieldOf: Record<string, AffiliateField> = {
      rewardBps: "rewardPercent",
      rewardOrders: "rewardOrders",
      friendPercent: "friendPercent",
      friendMaxMinor: "friendMax",
      monthlyCapMinor: "monthlyCap",
      cookieDays: "cookieDays",
    };
    for (const issue of parsed.error.issues) {
      const field = fieldOf[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = friendly(field, issue.message, w);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: parsed.data as AffiliateSettings };
}

/** The contract's own messages are kept; the ones zod writes itself (a number out of range) are put in words. */
function friendly(field: AffiliateField, message: string, w: LoyaltyMessages["affiliate"]["errors"]): string {
  if (/^(Too small|Too big|Invalid|Number must|Expected)/i.test(message) || message === "Invalid input") {
    switch (field) {
      case "rewardOrders":
        return w.ordersRange;
      case "cookieDays":
        return w.daysRange;
      case "friendPercent":
        return w.friendRange;
      default:
        return w.checkNumber;
    }
  }
  return message;
}
