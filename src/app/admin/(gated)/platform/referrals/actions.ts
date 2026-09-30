"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { percentTextToBps } from "@/lib/bonus-admin";
import { minorUnitDigits } from "@/lib/money";
import { parsePrice } from "@/lib/product-input";
import { requirePlatformAdmin } from "@/server/auth";
import { ensureBillingEvents } from "@/server/referral-billing";
import {
  adjustReferralCredit,
  REFERRALS_TAG,
  saveReferralSettings,
  setReferralVoid,
  setReferrerBlocked,
  type ReferralResult,
} from "@/server/referrals";
import { platformModes } from "@/server/stripe";

const uuid = z.uuid();
const text = (formData: FormData, name: string) => String(formData.get(name) ?? "");
const answer = (result: ReferralResult, done: string): FormState =>
  result.ok ? { status: "ok", messages: [done] } : { status: "error", messages: result.problems };

/** Kaizen's referral program (D131): on or off, the commission, how long it lasts, the days credit waits and the cookie's. */
export async function saveReferralSettingsAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  const bps = percentTextToBps(text(formData, "commissionPercent"));
  if (bps === null) return { status: "error", messages: ["Commission is a percentage such as 10 or 7,5."] };
  const number = (name: string) => (/^\d{1,4}$/.test(text(formData, name).trim()) ? Number(text(formData, name).trim()) : NaN);
  const result = await saveReferralSettings(account, {
    enabled: formData.get("enabled") === "on",
    commissionBps: bps,
    months: number("months"),
    pendingDays: number("pendingDays"),
    cookieDays: number("cookieDays"),
  });
  if (!result.ok) return answer(result, "");
  updateTag(REFERRALS_TAG);
  refresh();
  // Invoices and credit notes reach the program through Kaizen's billing webhook: make sure it sends them.
  let note = "";
  if (formData.get("enabled") === "on") {
    const added = (await Promise.all(platformModes().map((mode) => ensureBillingEvents(mode)))).flat();
    if (added.length > 0) note = ` Kaizen's Stripe billing webhook now also sends ${added.join(", ")}.`;
  }
  return { status: "ok", messages: [`Saved.${note}`] };
}

export async function blockReferrerAction(accountId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  if (!uuid.safeParse(accountId).success) return { status: "error", messages: ["Unknown referrer."] };
  const result = await setReferrerBlocked(account, accountId, true, text(formData, "reason"));
  if (result.ok) refresh();
  return answer(result, "Blocked.");
}

export async function unblockReferrerAction(accountId: string): Promise<void> {
  const account = await requirePlatformAdmin();
  if (!uuid.safeParse(accountId).success) return;
  await setReferrerBlocked(account, accountId, false);
  refresh();
}

export async function voidReferralAction(referralId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  if (!uuid.safeParse(referralId).success) return { status: "error", messages: ["Unknown referral."] };
  const result = await setReferralVoid(account, referralId, true, text(formData, "reason"));
  if (result.ok) refresh();
  return answer(result, "Voided.");
}

export async function restoreReferralAction(referralId: string): Promise<void> {
  const account = await requirePlatformAdmin();
  if (!uuid.safeParse(referralId).success) return;
  await setReferralVoid(account, referralId, false);
  refresh();
}

/** Adds or removes a referrer's credit: the amount in the currency's main unit, positive to add, negative to remove. */
export async function adjustReferralCreditAction(accountId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  if (!uuid.safeParse(accountId).success) return { status: "error", messages: ["Unknown referrer."] };
  const currency = text(formData, "currency").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) return { status: "error", messages: ["Enter a currency such as NOK or EUR."] };
  const typed = text(formData, "amount").trim();
  const negative = typed.startsWith("-");
  const minor = parsePrice(typed.replace(/^[-+]/, ""), currency);
  if (minor === null || minor === 0) {
    return { status: "error", messages: [`Enter an amount such as ${minorUnitDigits(currency) === 0 ? "500" : "50,00"}, with a minus to remove credit.`] };
  }
  const result = await adjustReferralCredit(
    account,
    { accountId, currency, amountMinor: negative ? -minor : minor, reason: text(formData, "reason") },
    text(formData, "key") || undefined,
  );
  if (result.ok) refresh();
  return answer(result, "Done.");
}
