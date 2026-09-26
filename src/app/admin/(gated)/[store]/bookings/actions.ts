"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { removeResource, saveResource } from "@/server/bookings";

/** Adds or changes a member of staff who takes appointments (D65); a new one goes back to the list. */
export async function saveStaffAction(
  storeSlug: string,
  staffId: string | null,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (staffId && !z.uuid().safeParse(staffId).success) return { status: "error", messages: ["They are no longer in the store."] };
  const result = await saveResource(member, staffId, {
    name: formData.get("name"),
    email: formData.get("email") ?? "",
    capacity: formData.get("capacity"),
    active: formData.get("active") === "on",
    hours: formData.get("hours"),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  if (!staffId) redirect(`/admin/${storeSlug}/bookings/staff`);
  return { status: "ok", messages: ["Saved."] };
}

export async function removeStaffAction(storeSlug: string, staffId: string): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(staffId).success || !(await removeResource(member, staffId))) {
    return { ok: false, problems: ["They are no longer in the store."] };
  }
  redirect(`/admin/${storeSlug}/bookings/staff`);
}
