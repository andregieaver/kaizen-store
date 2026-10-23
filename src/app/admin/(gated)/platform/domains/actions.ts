"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { decideReview, setDomainsOpenToAll, setDomainsPublic, setStoreDomainBuying } from "@/server/domain-admin";
import { saveDomainPricing } from "@/server/domain-prices";

/** Saves a currency's domain pricing (D315 decision 3): the margin in percent, the floor and the rounding in minor units. */
export async function saveDomainPricingAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const number = (key: string) => Number(String(form.get(key) ?? "").replace(",", "."));
  const result = await saveDomainPricing(admin, {
    currency: String(form.get("currency") ?? "").trim().toUpperCase(),
    marginBps: Math.round(number("margin") * 100),
    minimumMinor: Math.round(number("minimum")),
    roundMinor: Math.round(number("round")),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(admin.adminLocale), "domains").platform.saved] };
}

/** Opens buying to every store, or back to the stores opened one by one (decision 9). */
export async function domainsOpenAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  await setDomainsOpenToAll(admin, form.get("open") === "on");
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(admin.adminLocale), "domains").platform.saved] };
}

/** Opens or closes buying for one store. */
export async function storeDomainBuyingAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await setStoreDomainBuying(admin, String(form.get("slug") ?? ""), form.get("open") === "on");
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(admin.adminLocale), "domains").platform.saved] };
}

/** Sells domains to people without a store, or stops (D317). */
export async function domainsPublicAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  await setDomainsPublic(admin, form.get("on") === "on");
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(admin.adminLocale), "domains").platform.saved] };
}

/** Approves or refuses a purchase waiting for a look (D317 10). */
export async function reviewDomainAction(_state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const result = await decideReview(admin, String(form.get("purchase") ?? ""), form.get("answer") === "approve");
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [adminText(adminLangOf(admin.adminLocale), "domains").platform.saved] };
}
