"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { saveTracking } from "@/server/site-cookies";
import { storeTag } from "@/server/stores";

/** The store's analytics and marketing tools (D58): the owner's to change, as they decide what shoppers are asked. */
export async function saveStoreTrackingAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { status: "error", messages: ["Only an owner can change the store's tools."] };
  const result = await saveTracking(member.account, member.store.id, Object.fromEntries(form));
  if (!result.ok) return { status: "error", messages: result.problems };
  // The storefront's layout loads the tools and asks about them.
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: ["Saved. The store asks and loads accordingly now."] };
}
