"use server";

import { updateTag } from "next/cache";

import { requirePlatformAdmin } from "@/server/auth";
import { deleteTextStyle, saveTextStyle, textStylesTag, type DeleteStyleResult, type TextStyleResult } from "@/server/text-styles";

/** Kaizena Flow's own text styles (D393), from its builder's Styles tab: platform admins only. */

export async function savePlatformTextStyleAction(payload: string): Promise<TextStyleResult> {
  const admin = await requirePlatformAdmin();
  let input: unknown;
  try {
    input = JSON.parse(payload);
  } catch {
    return { ok: false, problems: ["The style could not be read. Try again."] };
  }
  const result = await saveTextStyle(admin, null, input);
  if (result.ok) updateTag(textStylesTag(null));
  return result;
}

export async function deletePlatformTextStyleAction(slug: string, confirmed: boolean): Promise<DeleteStyleResult> {
  const admin = await requirePlatformAdmin();
  const result = await deleteTextStyle(admin, null, String(slug), confirmed === true);
  if (result.ok) updateTag(textStylesTag(null));
  return result;
}
