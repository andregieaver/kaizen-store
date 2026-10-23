"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { monthLabel, settingsFromForm } from "@/components/admin/analytics/settings-forms";
import { fillWords } from "@/lib/admin-fill";
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { formatCount } from "@/lib/analytics-core";
import { analyticsWordsIn, countText } from "@/lib/analytics-words";
import { mainCurrency } from "@/lib/markets";
import { formatMoney } from "@/lib/money";
import {
  backfillCosts,
  deleteTarget,
  getAnalyticsSettings,
  saveAnalyticsSettings,
  saveTarget,
  setVisitCounting,
} from "@/server/analytics-settings";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole } from "@/server/permissions";

/**
 * The analytics settings' server actions (D152), bound to the store's slug as their first argument. Every one checks the member
 * for itself, and only an owner changes anything here (the server functions refuse the rest too). A change that the page shows
 * calls `refresh()` so the page follows; the cache tags are the server functions' own.
 */

const failed = (messages: string[]): FormState => ({ status: "error", messages });

/** The settings' words in the admin's language: the member's own, or the request's before a member is known. */
const wordsOf = (member: { account: { adminLocale?: string | null } } | null) =>
  member ? Promise.resolve(analyticsWordsIn(adminLangOf(member.account.adminLocale)).settings) : actionAdminLang().then((lang) => analyticsWordsIn(lang).settings);

/** The cost estimates or the customer lifetime: the form sends its own fields and the others stay as they are. */
export async function saveAnalyticsSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const current = await getAnalyticsSettings(member.store.id);
  const result = await saveAnalyticsSettings(member, settingsFromForm(Object.fromEntries(form), current, mainCurrency(member.store)));
  if (!result.ok) return failed(result.problems);
  refresh();
  return {
    status: "ok",
    messages: [form.has("ltvLifespanYears") ? w.lifetime.saved : w.fees.saved],
  };
}

/** Sets a month's net revenue target. */
export async function saveTargetAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const result = await saveTarget(member, Object.fromEntries(form));
  if (!result.ok) return failed(result.problems);
  refresh();
  const { month, revenueTargetMinor } = result.target;
  const amount = formatMoney(revenueTargetMinor, mainCurrency(member.store), member.store.markets[0]?.locale ?? "en");
  const locale = ADMIN_LANG_FACTS[adminLangOf(member.account.adminLocale)].locale;
  return { status: "ok", messages: [fillWords(w.targets.savedFor, { amount, month: monthLabel(month, locale) })] };
}

/** Takes a month's target away. */
export async function deleteTargetAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const month = form.get("month");
  const result = await deleteTarget(member, typeof month === "string" ? month : "");
  if (!result.ok) return failed(result.problems);
  refresh();
  return { status: "ok", messages: [result.deleted ? w.targets.removed : w.targets.alreadyGone] };
}

/** Switches visit counting on or off, from the button pressed (`enabled` is `on` or `off`). */
export async function setVisitCountingAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const choice = form.get("enabled");
  if (choice !== "on" && choice !== "off") return failed([w.visits.choose]);
  const result = await setVisitCounting(member, choice === "on");
  if (!result.ok) return failed(result.problems);
  refresh();
  return {
    status: "ok",
    messages: [
      result.enabled ? w.visits.nowOn : w.visits.nowOff,
    ],
  };
}

/**
 * Gives earlier order lines without a cost the cost their variant has now. The page is not refreshed: the form shows the result
 * in place of itself, and a refresh would take it away with the form.
 */
export async function backfillCostsAction(storeSlug: string): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const result = await backfillCosts(member);
  if (!result.ok) return failed(result.problems);
  return { status: "ok", messages: [countText(w.costs.updated, result.lines, {}, formatCount(result.lines))] };
}
