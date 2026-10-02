"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { monthLabel, settingsFromForm } from "@/components/admin/analytics/settings-forms";
import { formatCount } from "@/lib/analytics-core";
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
import { requireMember } from "@/server/auth";

/**
 * The analytics settings' server actions (D152), bound to the store's slug as their first argument. Every one checks the member
 * for itself, and only an owner changes anything here (the server functions refuse the rest too). A change that the page shows
 * calls `refresh()` so the page follows; the cache tags are the server functions' own.
 */

const OWNER_ONLY = "Only an owner can change this.";
const failed = (messages: string[]): FormState => ({ status: "error", messages });

/** The cost estimates or the customer lifetime: the form sends its own fields and the others stay as they are. */
export async function saveAnalyticsSettingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return failed([OWNER_ONLY]);
  const current = await getAnalyticsSettings(member.store.id);
  const result = await saveAnalyticsSettings(member, settingsFromForm(Object.fromEntries(form), current, mainCurrency(member.store)));
  if (!result.ok) return failed(result.problems);
  refresh();
  return {
    status: "ok",
    messages: [form.has("ltvLifespanYears") ? "Saved. Predicted lifetime value uses this from now on." : "Saved. Profit figures use these estimates from now on."],
  };
}

/** Sets a month's net revenue target. */
export async function saveTargetAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return failed([OWNER_ONLY]);
  const result = await saveTarget(member, Object.fromEntries(form));
  if (!result.ok) return failed(result.problems);
  refresh();
  const { month, revenueTargetMinor } = result.target;
  const amount = formatMoney(revenueTargetMinor, mainCurrency(member.store), member.store.markets[0]?.locale ?? "en");
  return { status: "ok", messages: [`Saved: ${amount} for ${monthLabel(month)}. The overview follows this target.`] };
}

/** Takes a month's target away. */
export async function deleteTargetAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return failed([OWNER_ONLY]);
  const month = form.get("month");
  const result = await deleteTarget(member, typeof month === "string" ? month : "");
  if (!result.ok) return failed(result.problems);
  refresh();
  return { status: "ok", messages: [result.deleted ? "Removed." : "That target was already gone."] };
}

/** Switches visit counting on or off, from the button pressed (`enabled` is `on` or `off`). */
export async function setVisitCountingAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return failed([OWNER_ONLY]);
  const choice = form.get("enabled");
  if (choice !== "on" && choice !== "off") return failed(["Choose whether to turn visit counting on or off."]);
  const result = await setVisitCounting(member, choice === "on");
  if (!result.ok) return failed(result.problems);
  refresh();
  return {
    status: "ok",
    messages: [
      result.enabled
        ? "Visit counting is on from now on. Mention it in your privacy policy."
        : "Visit counting is off. What was counted is kept for 25 months.",
    ],
  };
}

/**
 * Gives earlier order lines without a cost the cost their variant has now. The page is not refreshed: the form shows the result
 * in place of itself, and a refresh would take it away with the form.
 */
export async function backfillCostsAction(storeSlug: string): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return failed([OWNER_ONLY]);
  const result = await backfillCosts(member);
  if (!result.ok) return failed(result.problems);
  return { status: "ok", messages: [`Updated ${formatCount(result.lines)} order ${result.lines === 1 ? "line" : "lines"}.`] };
}
