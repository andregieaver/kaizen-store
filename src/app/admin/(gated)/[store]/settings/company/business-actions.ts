"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import type { BusinessMessages } from "@/lib/admin-messages/business.en";
import { adminText } from "@/lib/admin-text";
import { BUSINESS_SERIES } from "@/lib/business-change";
import { actionAdminLang } from "@/server/admin-request-lang";
import type { Membership } from "@/server/auth";
import { cancelBusinessChange, planBusinessChange, tickBusinessStep, type BusinessChangeResult } from "@/server/business-change";
import { checkOwnerRole } from "@/server/permissions";

/**
 * Changing the business behind the store (B8, D473), from Settings → Company: each action checks the member is the store's owner, whatever a
 * stale page sends, and answers in their language.
 */

type Words = BusinessMessages;

async function owner(storeSlug: string): Promise<{ member: Membership; w: Words } | { refused: string }> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { refused: adminText(await actionAdminLang(), "business").problems.forbidden };
  return { member, w: adminText(adminLangOf(member.account.adminLocale), "business") };
}

/** Which field each problem is about, so the form marks it (`FormState.fields`). */
const FIELD = { legal_name: "legalName", form: "businessForm", organisation_number: "organisationNumber", same: "organisationNumber", vat_number: "vatNumber", postal_address: "postalAddress", starts_on: "startsOn" } as const;

function stateOf(w: Words, result: BusinessChangeResult, success: string): FormState {
  if (result.ok) {
    refresh();
    return { status: "ok", messages: [success] };
  }
  const messages = [...new Set(result.problems.map((p) => w.problems[p]))];
  const fields = Object.fromEntries(result.problems.flatMap((p) => (p in FIELD ? [[FIELD[p as keyof typeof FIELD], w.problems[p]]] : [])));
  return { status: "error", messages, fields };
}

const text = (form: FormData, key: string) => String(form.get(key) ?? "");

/** A change planned, or the planned one changed. */
export async function planBusinessChangeAction(storeSlug: string, _prev: FormState, form: FormData): Promise<FormState> {
  const who = await owner(storeSlug);
  if ("refused" in who) return { status: "error", messages: [who.refused] };
  const result = await planBusinessChange(who.member, {
    legalName: text(form, "legalName"),
    businessForm: text(form, "businessForm"),
    startsOn: text(form, "startsOn"),
    organisationNumber: text(form, "organisationNumber"),
    vatRegistered: form.get("vatRegistered") === "on",
    vatNumber: text(form, "vatNumber"),
    postalAddress: text(form, "postalAddress"),
    prefixes: Object.fromEntries(BUSINESS_SERIES.map((s) => [s, text(form, `prefix_${s}`)])),
  });
  return stateOf(who.w, result, who.w.saved);
}

export async function cancelBusinessChangeAction(storeSlug: string): Promise<FormState> {
  const who = await owner(storeSlug);
  if ("refused" in who) return { status: "error", messages: [who.refused] };
  return stateOf(who.w, await cancelBusinessChange(who.member), who.w.cancelled);
}

/** A step of the checklist ticked as done, or not: one press, the page drawn again. */
export async function tickBusinessStepAction(storeSlug: string, step: string, done: boolean): Promise<void> {
  const who = await owner(storeSlug);
  if ("refused" in who) return;
  if ((await tickBusinessStep(who.member, step, done)).ok) refresh();
}
