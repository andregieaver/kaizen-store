import type { BonusSettings } from "./bonus";
import { fillWords } from "./admin-fill";
import type { LoyaltyMessages } from "./admin-messages/loyalty.en";
import { bonusSettingsInput } from "./bonus-schema";
import { parsePrice } from "./product-input";
import { type BonusField, type BonusFormRead, type BonusFormValues, friendly, percentTextToBps } from "./bonus-admin";

/**
 * The bonus settings form read and checked in the browser (D129, bloat review step 2.46): readBonusForm() runs bonusSettingsInput, the
 * server's own check, so the settings form imports it from here; the words, amounts and summaries stay in bonus-admin.ts, which loads
 * no zod.
 */

const wholeNumber = (text: string): number | null => (/^\d{1,9}$/.test(text.trim()) ? Number(text.trim()) : null);

/**
 * The form read into settings, checked with `bonusSettingsInput` (the server's own check). Every field that is wrong
 * gets its own message, in the words of the contract where it has them.
 */
export function readBonusForm(
  values: BonusFormValues,
  currency: string,
  w: LoyaltyMessages["bonus"]["errors"],
): BonusFormRead {
  const errors: Partial<Record<BonusField, string>> = {};

  const earnBps = percentTextToBps(values.earnPercent);
  if (earnBps === null) errors.earnPercent = w.earnPercent;

  const pendingDays = wholeNumber(values.pendingDays);
  if (pendingDays === null) errors.pendingDays = w.pendingDays;

  const maxRedeemPercent = wholeNumber(values.maxRedeemPercent);
  if (maxRedeemPercent === null) errors.maxRedeemPercent = w.maxRedeemPercent;

  let minRedeemMinor: number | null = 0;
  if (values.minRedeem.trim() !== "") {
    minRedeemMinor = parsePrice(values.minRedeem, currency);
    if (minRedeemMinor === null)
      errors.minRedeem = fillWords(w.minRedeem, { currency });
  }

  let expiresMonths: number | null = null;
  if (values.expires) {
    expiresMonths = wholeNumber(values.expiresMonths);
    if (expiresMonths === null) errors.expiresMonths = w.expiresMonths;
  }

  // Levels: every row read whole, or the levels' own message (a row left entirely empty is dropped, as an unfinished line).
  const levels: { name: string; fromMinor: number; earnBps: number }[] = [];
  for (const row of values.levels) {
    if (!row.name.trim() && !row.from.trim() && !row.percent.trim()) continue;
    const fromMinor = parsePrice(row.from, currency);
    const earnRow = percentTextToBps(row.percent);
    if (!row.name.trim() || fromMinor === null || earnRow === null) {
      errors.levels = fillWords(w.levels, { currency });
      break;
    }
    levels.push({ name: row.name.trim(), fromMinor, earnBps: earnRow });
  }

  let signupMinor: number | null = 0;
  if (values.signup.trim() !== "") {
    signupMinor = parsePrice(values.signup, currency);
    if (signupMinor === null) errors.signup = fillWords(w.signup, { currency });
  }

  let birthdayMinor: number | null = 0;
  if (values.birthday.trim() !== "") {
    birthdayMinor = parsePrice(values.birthday, currency);
    if (birthdayMinor === null) errors.birthday = fillWords(w.signup, { currency });
  }

  // What could be read is checked against the contract, so its limits are said in its own words.
  const parsed = bonusSettingsInput.safeParse({
    enabled: values.enabled,
    earnBps: earnBps ?? 0,
    pendingDays: pendingDays ?? 0,
    maxRedeemPercent: maxRedeemPercent ?? 1,
    minRedeemMinor: minRedeemMinor ?? 0,
    expiresMonths: values.expires ? (expiresMonths ?? 1) : null,
    levels: errors.levels ? [] : levels,
    signupMinor: signupMinor ?? 0,
    birthdayMinor: birthdayMinor ?? 0,
  });
  if (!parsed.success) {
    const fieldOf: Record<string, BonusField> = {
      earnBps: "earnPercent",
      pendingDays: "pendingDays",
      maxRedeemPercent: "maxRedeemPercent",
      minRedeemMinor: "minRedeem",
      expiresMonths: "expiresMonths",
      levels: "levels",
      signupMinor: "signup",
      birthdayMinor: "birthday",
    };
    for (const issue of parsed.error.issues) {
      const field = fieldOf[String(issue.path[0])];
      if (field && !errors[field]) errors[field] = friendly(field, issue.message, w);
    }
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, settings: parsed.data as BonusSettings };
}
