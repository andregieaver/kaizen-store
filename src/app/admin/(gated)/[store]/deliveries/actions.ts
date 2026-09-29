"use server";

import { refresh } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { saveSchedule, scheduleInput } from "@/server/standing-orders";

/** Adds or changes a delivery day (D102). Owners only: it changes what shoppers agreed to. */
export async function saveScheduleAction(storeSlug: string, scheduleId: string | null, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { status: "error", messages: ["Only an owner can change delivery days."] };
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
