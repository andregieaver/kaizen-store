"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { featureOffText, featureOn } from "@/lib/store-features";
import { checkOwnerRole } from "@/server/permissions";
import { saveSchedule, scheduleInput } from "@/server/standing-orders";

/** Adds or changes a delivery day (D102). Owners only: it changes what shoppers agreed to. */
export async function saveScheduleAction(storeSlug: string, scheduleId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { status: "error", messages: ["Only an owner can change delivery days."] };
  // Delivery days are part of Subscription boxes (D178): kept as they are while it is switched off.
  if (!featureOn(member.store, "boxes")) return { status: "error", messages: [featureOffText("boxes")] };
  const parsed = scheduleInput.safeParse({
    id: scheduleId,
    marketCode: form.get("marketCode"),
    name: form.get("name"),
    deliveryWeekday: form.get("deliveryWeekday"),
    cutoffDays: form.get("cutoffDays"),
    cutoffTime: form.get("cutoffTime"),
    active: form.get("active") === "on",
  });
  if (!parsed.success) return { status: "error", messages: [...new Set(parsed.error.issues.map((issue) => issue.message))] };
  const result = await saveSchedule(member, parsed.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved."] };
}
