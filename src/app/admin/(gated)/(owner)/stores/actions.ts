"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { starterChoice } from "@/lib/store-starters";
import { requireAccount } from "@/server/auth";
import { createStoreForOwner } from "@/server/platform";

/** An owner creates another store (a copy of the store template chosen, D175, or of the demo) and goes to its setup. */
export async function createStoreAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requireAccount();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase() || suggestSlug(name);
  const result = await createStoreForOwner(account, name, slug, starterChoice(formData.get("starter")));
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${result.slug}/setup`);
}
