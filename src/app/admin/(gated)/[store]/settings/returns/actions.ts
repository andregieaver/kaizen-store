"use server";

import { refresh, updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { ReturnAddress } from "@/lib/withdrawal";
import { audit, requireMember } from "@/server/auth";
import { catalogTag } from "@/server/catalog";
import { saveInstructionTranslations, saveReturnSettings } from "@/server/return-settings";
import { storeTag } from "@/server/stores";

const text = (form: FormData, name: string): string => String(form.get(name) ?? "").trim();

/**
 * Saves the store's rules for returns (D153). Only an owner changes what customers are promised; the server checks
 * everything again with the schema the form's fields are read into, and the change is written to the audit log.
 */
export async function saveReturnSettingsAction(storeSlug: string, _previous: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { status: "error", messages: ["Only an owner can change the return rules."] };

  const parts = [text(form, "addressName"), text(form, "addressStreet"), text(form, "addressPostalCode"), text(form, "addressCity"), text(form, "addressCountry")];
  const returnAddress: ReturnAddress | null = parts.every((p) => p === "")
    ? null
    : { name: parts[0], street: parts[1], postalCode: parts[2], city: parts[3], country: parts[4] };
  const saved = await saveReturnSettings(
    member.store.id,
    {
      windowDays: Number(text(form, "windowDays") || Number.NaN),
      transitDays: Number(text(form, "transitDays") || Number.NaN),
      whoPaysReturn: text(form, "whoPaysReturn"),
      refundWhen: text(form, "refundWhen"),
      acceptExcluded: form.get("acceptExcluded") === "on",
      b2bReturns: form.get("b2bReturns") === "on",
      instructions: text(form, "instructions"),
      returnAddress,
    },
    member.account.id,
  );
  if (!saved.ok) return { status: "error", messages: saved.problems };

  // The instructions in the store's other languages: only those it offers.
  const others = member.store.localization.locales.slice(1);
  const translated = await saveInstructionTranslations(
    member.store.id,
    Object.fromEntries(others.map((locale) => [locale, text(form, `instructions:${locale}`)])),
    others,
    member.account.id,
  );
  if (!translated.ok) return { status: "error", messages: translated.problems };

  const { instructions, ...rules } = saved.settings;
  await audit(member.account.id, member.store.id, "returns.settings_saved", { ...rules, instructionsLength: instructions.length, translated: Object.keys(translated.translations) });
  // What the storefront says about returns (the withdrawal page, product structured data) follows the settings.
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  refresh();
  return { status: "ok", messages: ["Saved."] };
}
