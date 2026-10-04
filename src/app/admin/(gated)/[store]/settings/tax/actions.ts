"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { OSS_SCHEMES, type OssScheme, type TaxProfileForm } from "@/lib/tax-profile";
import { requireMember } from "@/server/auth";
import { checkOwnVatNumber, saveTaxProfile } from "@/server/tax-profile";

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The profile as the tax screen's fields give it (D157): the same names `parseTaxProfile()` reads, nothing else. */
function profileOf(form: FormData): TaxProfileForm {
  const scheme = text(form, "ossScheme") as OssScheme;
  return {
    vatRegistered: form.get("vatRegistered") === "on",
    vatNumber: text(form, "vatNumber"),
    dispatchCountry: text(form, "dispatchCountry"),
    ossScheme: OSS_SCHEMES.includes(scheme) ? scheme : "none",
    ossMemberState: text(form, "ossMemberState"),
    ossNumber: text(form, "ossNumber"),
    ossRegisteredOn: text(form, "ossRegisteredOn"),
    iossNumber: text(form, "iossNumber"),
    iossIntermediary: text(form, "iossIntermediary"),
    iossMarkets: form.getAll("iossMarkets").map(String),
    iossRegisteredOn: text(form, "iossRegisteredOn"),
  };
}

/**
 * Saves the store's tax profile (D157). Only an owner changes it (`saveTaxProfile()` checks again, and checks every field with the
 * schema the browser uses); the change is written to the audit log with the names of the fields, never the numbers.
 */
export async function saveTaxProfileAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const saved = await saveTaxProfile(member, profileOf(form));
  if (!saved.ok) return { status: "error", messages: saved.problems };
  refresh();
  return { status: "ok", messages: ["Saved."] };
}

/**
 * *Check now* (D157): asks VIES (a Norwegian number: the open register) about the store's own number, which must be saved first.
 * Owners only. An answer that is not definite is said as such: the number is not taken as valid.
 */
export async function checkVatNumberAction(storeSlug: string): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const checked = await checkOwnVatNumber(member);
  if (!checked.ok) return { status: "error", messages: checked.problems };
  refresh();
  const { check } = checked;
  if (check.status === "valid") return { status: "ok", messages: ["The VAT number is registered."] };
  if (check.status === "invalid") return { status: "error", messages: ["The register does not know this VAT number as valid. Check the number."] };
  return { status: "error", messages: ["The register could not be reached just now. The number has not been checked: try again in a moment."] };
}
