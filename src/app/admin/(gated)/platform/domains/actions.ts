"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatformAdmin } from "@/server/auth";
import { setDomainsOpenToAll, setStoreDomainBuying } from "@/server/domain-admin";
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
