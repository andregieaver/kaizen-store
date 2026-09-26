"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { requireMember } from "@/server/auth";
import { installFont, saveSiteFonts } from "@/server/fonts";
import { storeTag } from "@/server/stores";

const family = (form: FormData, name: string) => String(form.get(name) ?? "").trim() || undefined;

/** The store's heading and body fonts (D59). */
export async function saveStoreFontsAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const result = await saveSiteFonts(member.account, member.store.id, {
    heading: family(form, "heading"),
    body: family(form, "body"),
  });
  if (!result.ok) return { status: "error", messages: result.problems };
  // The storefront's layout sets the fonts.
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: ["Saved. The store uses these fonts now."] };
}

/** Copies a Google Fonts family to Kaizen for the store's staff to use (D59). */
export async function installStoreFontAction(storeSlug: string, fontFamily: string) {
  await requireMember(storeSlug);
  return installFont(String(fontFamily));
}
