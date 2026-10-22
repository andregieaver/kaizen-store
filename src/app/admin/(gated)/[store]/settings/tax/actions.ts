"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { taxEn, type TaxMessages } from "@/lib/admin-messages/tax.en";
import { adminText } from "@/lib/admin-text";
import { knownText } from "@/lib/known-words";
import { OSS_SCHEMES, type OssScheme, type TaxProfileForm } from "@/lib/tax-profile";
import { checkPermission } from "@/server/permissions";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkOwnVatNumber, saveTaxProfile } from "@/server/tax-profile";

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The server's English refusals in the account's words (D312 A8). */
const said = (messages: string[], w: TaxMessages) => messages.map((m) => knownText(m, taxEn.problems, w.problems));

/** A refusal before a member is known, in the request's language. */
const noAccess = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "tax").problems.noAccess] });

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
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return noAccess();
  const w = adminText(adminLangOf(member.account.adminLocale), "tax");
  const saved = await saveTaxProfile(member, profileOf(form));
  if (!saved.ok) return { status: "error", messages: said(saved.problems, w) };
  refresh();
  return { status: "ok", messages: [w.actions.saved] };
}

/**
 * *Check now* (D157): asks VIES (a Norwegian number: the open register) about the store's own number, which must be saved first.
 * Owners only. An answer that is not definite is said as such: the number is not taken as valid.
 */
export async function checkVatNumberAction(storeSlug: string): Promise<FormState> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return noAccess();
  const w = adminText(adminLangOf(member.account.adminLocale), "tax");
  const checked = await checkOwnVatNumber(member);
  if (!checked.ok) return { status: "error", messages: said(checked.problems, w) };
  refresh();
  const { check } = checked;
  if (check.status === "valid") return { status: "ok", messages: [w.actions.valid] };
  if (check.status === "invalid") return { status: "error", messages: [w.actions.invalid] };
  return { status: "error", messages: [w.actions.unreachable] };
}
