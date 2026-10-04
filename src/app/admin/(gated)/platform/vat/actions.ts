"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requirePlatformAdmin } from "@/server/auth";
import { addVatCategory, setShippingVatRule, setVatCategoryActive, setVatRate, verifyVatRate, type VatAdminResult } from "@/server/vat-admin";

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/** The server's answer as a form's: its problems, or the done message. */
function stateOf(result: VatAdminResult, done: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [done] };
}

/** Adds a VAT category (D157). Platform admins only. */
export async function addVatCategoryAction(_previous: FormState, form: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(await addVatCategory(account, { code: text(form, "code"), nameEn: text(form, "nameEn"), description: text(form, "description"), sort: text(form, "sort") || 100 }), "The category is added.");
}

/** Switches a VAT category on or off (a built-in one cannot be switched off). */
export async function setVatCategoryActiveAction(code: string, active: boolean): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(await setVatCategoryActive(account, code, active), active ? "The category is on." : "The category is off.");
}

/** Sets a country's rate for a category from a date: the old period ends and a new one begins (`commerce.set_vat_rate()`). */
export async function setVatRateAction(_previous: FormState, form: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(
    await setVatRate(account, {
      country: text(form, "country"),
      category: text(form, "category"),
      ratePercent: text(form, "ratePercent"),
      validFrom: text(form, "validFrom"),
      source: text(form, "source"),
      checkedOn: text(form, "checkedOn"),
      note: text(form, "note"),
    }),
    "The rate is set. It starts unverified and applies to new carts and orders from its date.",
  );
}

/** Records that a person has checked a rate: who and when. */
export async function verifyVatRateAction(country: string, category: string, validFrom: string): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(await verifyVatRate(account, { country, category, validFrom }), "The rate is marked as verified.");
}

/** Sets how shipping is taxed in a country; only a verified rule changes what is charged. */
export async function setShippingVatRuleAction(_previous: FormState, form: FormData): Promise<FormState> {
  const account = await requirePlatformAdmin();
  return stateOf(
    await setShippingVatRule(account, {
      country: text(form, "country"),
      rule: text(form, "rule"),
      source: text(form, "source"),
      checkedOn: text(form, "checkedOn") || null,
      note: text(form, "note"),
      verified: form.get("verified") === "on",
    }),
    "The rule is saved.",
  );
}
