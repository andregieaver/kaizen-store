"use server";

import { updateTag } from "next/cache";

import { requireMember } from "@/server/auth";
import { saveNavigation } from "@/server/navigation";
import type { SaveResult } from "@/server/settings";
import { storeTag } from "@/server/stores";

/** Saves the storefront's logo and menus; every page shows them at once (D30). */
export async function saveNavigationAction(storeSlug: string, input: unknown): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  const result = await saveNavigation(member, input);
  if (result.ok) updateTag(storeTag(member.store.slug));
  return result;
}
