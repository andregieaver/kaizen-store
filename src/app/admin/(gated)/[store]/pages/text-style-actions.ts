"use server";

import { updateTag } from "next/cache";

import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { deleteTextStyle, saveTextStyle, textStylesTag, type DeleteStyleResult, type TextStyleResult } from "@/server/text-styles";

/** A store's text styles (D393), saved and deleted from the builder's Styles tab; both need `website:write`. */

export async function saveStoreTextStyleAction(storeSlug: string, payload: string): Promise<TextStyleResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  let input: unknown;
  try {
    input = JSON.parse(payload);
  } catch {
    return { ok: false, problems: ["The style could not be read. Try again."] };
  }
  const result = await saveTextStyle(member.account, member.store.id, input);
  if (result.ok) updateTag(textStylesTag(member.store.id));
  return result;
}

export async function deleteStoreTextStyleAction(storeSlug: string, slug: string, confirmed: boolean): Promise<DeleteStyleResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await deleteTextStyle(member.account, member.store.id, String(slug), confirmed === true);
  if (result.ok) updateTag(textStylesTag(member.store.id));
  return result;
}
