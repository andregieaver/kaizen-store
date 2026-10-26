"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { BUYER_ROLES } from "@/lib/company-locations";
import { mainCurrency } from "@/lib/markets";
import { parsePrice } from "@/lib/product-input";
import { featureOn } from "@/lib/store-features";
import { actionAdminLang } from "@/server/admin-request-lang";
import { deleteLocation, saveCompanyRules, saveLocation, setBuyer, type SaveResult } from "@/server/company-locations";
import { checkPermission } from "@/server/permissions";

/**
 * A company's locations, buyers and buying rules (D321 C.2): the forms of its admin page. Each asks `customers:write` and the business feature, and
 * hands the form to `src/server/company-locations.ts`, which checks every id is the store's and the company's own.
 */

const id = z.uuid();

const noAccess = async (): Promise<FormState> => ({ status: "error", messages: [adminText(await actionAdminLang(), "customers").saved.noAccess] });

async function member(storeSlug: string) {
  const found = await checkPermission(storeSlug, "customers:write");
  if (!found) return null;
  return { found, words: adminText(adminLangOf(found.account.adminLocale), "customers") };
}

function toState(result: SaveResult, success: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [success] };
}

const address = (form: FormData, prefix: string) =>
  Object.fromEntries(["name", "line1", "line2", "postalCode", "city", "country"].map((key) => [key, String(form.get(`${prefix}.${key}`) ?? "")]));

export async function saveLocationAction(storeSlug: string, companyId: string, locationId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug);
  if (!m) return noAccess();
  if (!featureOn(m.found.store, "business")) return { status: "error", messages: [m.words.saved.businessOff] };
  if (!id.safeParse(companyId).success || (locationId !== null && !id.safeParse(locationId).success)) return { status: "error", messages: [m.words.locations.problems.gone] };
  const result = await saveLocation(m.found, companyId, locationId, { name: form.get("name"), billing: address(form, "billing"), shipping: address(form, "shipping") });
  return toState(result, m.words.locations.saved);
}

export async function deleteLocationAction(storeSlug: string, companyId: string, locationId: string): Promise<FormState> {
  const m = await member(storeSlug);
  if (!m) return noAccess();
  if (!id.safeParse(companyId).success || !id.safeParse(locationId).success) return { status: "error", messages: [m.words.locations.problems.gone] };
  return toState(await deleteLocation(m.found, companyId, locationId), m.words.locations.deleted);
}

/** Sets who buys at a location and in what role; an empty role takes them off. `customerId` bound, or chosen in the form. */
export async function setBuyerAction(storeSlug: string, companyId: string, locationId: string, customerId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug);
  if (!m) return noAccess();
  if (!featureOn(m.found.store, "business")) return { status: "error", messages: [m.words.saved.businessOff] };
  const who = customerId ?? String(form.get("customerId") ?? "");
  const role = String(form.get("role") ?? "");
  if (![companyId, locationId, who].every((value) => id.safeParse(value).success)) return { status: "error", messages: [m.words.locations.problems.notMember] };
  const chosen = (BUYER_ROLES as readonly string[]).includes(role) ? (role as (typeof BUYER_ROLES)[number]) : null;
  if (role !== "" && !chosen) return { status: "error", messages: [m.words.locations.problems.notMember] };
  return toState(await setBuyer(m.found, companyId, locationId, who, chosen), m.words.locations.saved);
}

/** Whether a PO number is required and the approval limit, typed in the store's main currency ("10 000,00"); empty is no limit. */
export async function saveCompanyRulesAction(storeSlug: string, companyId: string, _state: FormState, form: FormData): Promise<FormState> {
  const m = await member(storeSlug);
  if (!m) return noAccess();
  if (!featureOn(m.found.store, "business")) return { status: "error", messages: [m.words.saved.businessOff] };
  if (!id.safeParse(companyId).success) return { status: "error", messages: [m.words.locations.problems.companyGone] };
  const currency = mainCurrency(m.found.store);
  const typed = String(form.get("limit") ?? "").trim();
  const limit = typed === "" ? null : parsePrice(typed, currency);
  if (typed !== "" && limit === null) return { status: "error", messages: [m.words.locations.problems.limit] };
  return toState(await saveCompanyRules(m.found, companyId, { poRequired: form.get("poRequired") === "on", approvalLimitMinor: limit, currency }), m.words.locations.saved);
}
