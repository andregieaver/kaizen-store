"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
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

/** Asks the ECB for the rate of one day (`currency`, `day`) and stores it; an answer of "not published yet" or "could not be reached" changes nothing. */
export async function fetchEcbRateAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return failed([NO_ACCESS]);
  const result = await fetchRateForOwner(member, { currency: form.get("currency"), day: form.get("day") });
  if (!result.ok) return failed([result.message]);
  refresh();
  return {
    status: "ok",
    messages: [result.already ? `The ECB's rate for ${result.date} was already stored: ${result.rate}.` : `Stored the ECB's rate of ${result.date}: ${result.rate}.`],
  };
}

/** Enters the owner's own rate (`currency`, `day`, `rate`, `reason`); it is used instead of the ECB's for this store and is shown with its reason. */
export async function setRateOverrideAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return failed([NO_ACCESS]);
  const result = await setRateOverride(member, Object.fromEntries(form));
  if (!result.ok) return failed(result.problems);
  refresh();
  return { status: "ok", messages: [result.previous ? `Changed your rate for ${result.currency} on ${result.day} from ${result.previous} to ${result.rate}.` : `Saved your rate for ${result.currency} on ${result.day}: ${result.rate}.`] };
}
