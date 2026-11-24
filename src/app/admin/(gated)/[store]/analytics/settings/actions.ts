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
import { HEATMAPS_WORDS } from "@/lib/admin-words/heatmaps";
import { RECORDINGS_WORDS } from "@/lib/admin-words/recordings";
import { COMPANIES_WORDS } from "@/lib/admin-words/companies";
import {
  backfillCosts,
  deletePeriodTarget,
  deleteTarget,
  getAnalyticsSettings,
  saveAnalyticsSettings,
  savePeriodTarget,
  saveTarget,
  setHeatmaps,
  setCompanyRecognition,
  setRecordings,
  setVisitCounting,
} from "@/server/analytics-settings";
import { CompanyLookupError, removeCompanyLookupSettings, saveCompanyLookupSettings } from "@/server/company-lookup-admin";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnerRole } from "@/server/permissions";
import { storeAction } from "@/server/store-action";

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

/** Sets a target of any metric and period (D348). */
export async function savePeriodTargetAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const fields = Object.fromEntries(form);
  const result = await savePeriodTarget(member, { ...fields, end: fields.period === "custom" ? fields.end : undefined });
  if (!result.ok) return failed(result.problems);
  refresh();
  return { status: "ok", messages: [w.targets.savedKind] };
}

/** Takes a target of any kind away, by its id. */
export async function deletePeriodTargetAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  const w = await wordsOf(member);
  if (!member) return failed([w.ownerOnly]);
  const id = form.get("id");
  const result = await deletePeriodTarget(member, typeof id === "string" ? id : "");
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

/** Switches heatmaps on or off (D656): the store's banner then asks visitors about statistics again. */
export async function setHeatmapsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "analytics.heatmaps", answer: (message) => failed([message]) }, async (member, lang) => {
    const h = HEATMAPS_WORDS[lang];
    const choice = form.get("enabled");
    if (choice !== "on" && choice !== "off") return failed([h.choose]);
    const result = await setHeatmaps(member, choice === "on");
    if (!result.ok) return failed(result.problems);
    refresh();
    return { status: "ok", messages: [result.enabled ? h.nowOn : h.nowOff] };
  });
}

/**
 * Switches recordings of visits on or off, with the share and what they hide (D656 step 11): on needs the three confirmations the first
 * time; while the platform holds recordings back, only Kaizena Flow's own store may switch them on (`setRecordings()`).
 */
export async function setRecordingsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "analytics.recordings", answer: (message) => failed([message]) }, async (member, lang) => {
    const w = RECORDINGS_WORDS[lang];
    const enabled = form.get("enabled") === "on";
    const confirmed = member.store.recordings || ["children", "sensitive", "policy", "assessment"].every((k) => form.get(k) === "yes");
    if (enabled && !confirmed) return failed([w.settings.confirmAll]);
    const share = Number(form.get("share") ?? member.store.recordingShare);
    const result = await setRecordings(member, { enabled, share, mask: form.get("strict") === "yes" ? "strict" : "balanced", confirmed });
    if (!result.ok) return failed(result.problems.map((p) => (p === "Recordings are not available yet." ? w.notAvailable : p)));
    refresh();
    return { status: "ok", messages: [enabled ? (member.store.recordings ? w.settings.saved : w.settings.nowOn) : w.settings.nowOff] };
  });
}

/**
 * Switches company recognition on or off (D890): only Kaizena Flow's own store may switch it on for now, and only while visits are counted
 * (`setCompanyRecognition()`).
 */
export async function setCompanyRecognitionAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "analytics.company_recognition", answer: (message) => failed([message]) }, async (member, lang) => {
    const w = COMPANIES_WORDS[lang].settings;
    const choice = form.get("enabled");
    if (choice !== "on" && choice !== "off") return failed([w.choose]);
    const result = await setCompanyRecognition(member, choice === "on");
    if (!result.ok) {
      const said: Record<string, string> = { "Company recognition is not available yet.": w.notAvailable, "Turn on visit counting first.": w.needsVisits };
      return failed(result.problems.map((p) => said[p] ?? p));
    }
    refresh();
    return { status: "ok", messages: [result.enabled ? w.nowOn : w.nowOff] };
  });
}

/** Saves Kaizena Flow's Leadfeeder connection (D890): a platform admin's alone; the key is kept encrypted and never shown again. */
export async function saveCompanyLookupAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "analytics.company_lookup", answer: (message) => failed([message]) }, async (member, lang) => {
    const w = COMPANIES_WORDS[lang].settings.connection;
    try {
      await saveCompanyLookupSettings(member.account, { apiKey: String(form.get("api_key") ?? ""), accountId: String(form.get("account_id") ?? "") });
    } catch (error) {
      if (error instanceof CompanyLookupError) return failed([w.problems[error.problem]]);
      throw error;
    }
    refresh();
    return { status: "ok", messages: [w.saved] };
  });
}

/** Takes Kaizena Flow's Leadfeeder connection away (D890): lookups stop at once. A platform admin's alone. */
export async function removeCompanyLookupAction(storeSlug: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "analytics.company_lookup", answer: (message) => failed([message]) }, async (member, lang) => {
    const w = COMPANIES_WORDS[lang].settings.connection;
    try {
      await removeCompanyLookupSettings(member.account);
    } catch (error) {
      if (error instanceof CompanyLookupError) return failed([w.problems[error.problem]]);
      throw error;
    }
    refresh();
    return { status: "ok", messages: [w.removed] };
  });
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
