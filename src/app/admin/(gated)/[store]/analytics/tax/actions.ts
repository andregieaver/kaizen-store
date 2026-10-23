"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { rateProblemText } from "@/lib/tax-report-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { fetchRateForOwner } from "@/server/ecb-rates";
import { NO_ACCESS, checkOwnerRole } from "@/server/permissions";
import { setRateOverride } from "@/server/tax-rate-overrides";

/**
 * The euro rates of the OSS and IOSS views (D161, `docs/wave-1c-reports.md` 2.2): fetching the ECB's rate for a day and entering a rate
 * of the owner's own. Owners only, because the figures of a return depend on the rate (the permission scan lists this file as owner-only
 * with that reason); each action checks the member for itself and takes the store's slug as its first bound argument. The server
 * functions write the audit log (`analytics.tax_rate_fetched`, `analytics.tax_rate_override_set`). The page is refreshed so the return
 * follows the rate; neither action changes a document, an order or a payment.
 */

const failed = (messages: string[]): FormState => ({ status: "error", messages });

/** The refusal before a member is known, in the request's admin language (English outside a request). */
async function noAccess(): Promise<FormState> {
  const lang = await actionAdminLang();
  return failed([lang === "en" ? NO_ACCESS : adminText(lang, "taxReports").actions.noAccess]);
}

/** Asks the ECB for the rate of one day (`currency`, `day`) and stores it; an answer of "not published yet" or "could not be reached" changes nothing. */
export async function fetchEcbRateAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return noAccess();
  const w = adminText(adminLangOf(member.account.adminLocale), "taxReports");
  const result = await fetchRateForOwner(member, { currency: form.get("currency"), day: form.get("day") });
  if (!result.ok) return failed([rateProblemText(result.message, w)]);
  refresh();
  return { status: "ok", messages: [fillWords(result.already ? w.actions.already : w.actions.fetched, { date: result.date, rate: result.rate })] };
}

/** Enters the owner's own rate (`currency`, `day`, `rate`, `reason`); it is used instead of the ECB's for this store and is shown with its reason. */
export async function setRateOverrideAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return noAccess();
  const w = adminText(adminLangOf(member.account.adminLocale), "taxReports");
  const result = await setRateOverride(member, Object.fromEntries(form));
  if (!result.ok) return failed(result.problems.map((p) => rateProblemText(p, w)));
  refresh();
  const values = { currency: result.currency, day: result.day, previous: result.previous ?? "", rate: result.rate };
  return { status: "ok", messages: [fillWords(result.previous ? w.actions.changed : w.actions.saved, values)] };
}
