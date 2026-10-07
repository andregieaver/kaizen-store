"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import type { SwitchResult } from "@/components/admin/features-view";
import { isFeatureId } from "@/lib/store-features";
import { bookingSettingsInput, saveBookingSettings } from "@/server/bookings";
import { checkOwnerRole } from "@/server/permissions";
import { refreshFeatureTags, setFeature } from "@/server/store-features";

const ONLY_OWNERS = "Only an owner can switch features on or off.";
const problems = (messages: string[]): FormState => ({ status: "error", messages });

/** Switches one of the store's features on or off (D178); off needs `confirmed` when there are warnings, and is refused while customers would be hit. */
export async function switchFeatureAction(storeSlug: string, feature: unknown, on: unknown, confirmed: unknown): Promise<SwitchResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: [ONLY_OWNERS] };
  if (!isFeatureId(feature) || typeof on !== "boolean") return { ok: false, problems: ["There is no such feature."] };
  const result = await setFeature(member, feature, on, { confirmed: confirmed === true });
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

/** Where the store's times are and when appointment reminders go (D65): kept on the Features page beside the switches they serve. */
export async function saveBookingSettingsAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return problems(["Only an owner can change these settings."]);
  const parsed = bookingSettingsInput.safeParse({ timeZone: formData.get("timeZone"), reminderHours: formData.get("reminderHours") ?? 24 });
  if (!parsed.success) return problems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
  await saveBookingSettings(member, parsed.data);
  refreshFeatureTags(member.store);
  return { status: "ok", messages: ["Saved."] };
}
