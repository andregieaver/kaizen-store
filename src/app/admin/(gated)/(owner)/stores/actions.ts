"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { suggestSlug } from "@/lib/slug";
import { designLookChoice } from "@/lib/design-presets";
import { starterChoice } from "@/lib/store-starters";
import { requireAccount } from "@/server/auth";
import { createStoreForOwner } from "@/server/platform";

/**
 * An owner creates another store (a copy of the store template chosen, D175, or of the demo), with the design profile chosen applied
 * after (D176), and goes to its setup; when the profile could not be applied, to its design settings, which say so.
 */
export async function createStoreAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requireAccount();
  const name = String(formData.get("name") ?? "").trim();
  const slug = String(formData.get("slug") ?? "").trim().toLowerCase() || suggestSlug(name);
  // A theme's own look or one of its presets (`docs/theme-showcase-phase-1.md` step 4); the server checks both again.
  const look = designLookChoice(formData.get("design"));
  const result = await createStoreForOwner(account, name, slug, starterChoice(formData.get("starter")), look?.id ?? null, look?.variation ?? null);
  if (!result.ok) return { status: "error", messages: result.problems };
  if (result.design?.problem) redirect(`/admin/${result.slug}/settings/design?design=failed`);
  redirect(`/admin/${result.slug}/setup`);
}
