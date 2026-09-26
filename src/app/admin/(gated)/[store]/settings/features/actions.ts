"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { bookingsModuleInput, setBookingsModule } from "@/server/bookings";
import { catalogTag } from "@/server/catalog";
import { storeTag } from "@/server/stores";

const problems = (messages: string[]): FormState => ({ status: "error", messages });

/** Switches appointments on or off (D65): the admin gains Bookings, and the product editor appointments. */
export async function saveBookingsModuleAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return problems(["Only an owner can switch features on or off."]);
  const parsed = bookingsModuleInput.safeParse({
    enabled: formData.get("bookings") === "on",
    timeZone: formData.get("timeZone"),
  });
  if (!parsed.success) return problems([...new Set(parsed.error.issues.map((issue) => issue.message))]);
  await setBookingsModule(member, parsed.data);
  updateTag(storeTag(member.store.slug));
  updateTag(catalogTag(member.store.id));
  return { status: "ok", messages: ["Saved."] };
}
