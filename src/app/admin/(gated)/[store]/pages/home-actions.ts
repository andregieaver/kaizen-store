"use server";

import { updateTag } from "next/cache";

import type { FormState } from "@/components/admin/action-form";
import { takePackHome, undoHomeTake } from "@/server/home-takes";
import { pagesTag } from "@/server/pages";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { storeTag } from "@/server/stores";

/**
 * A demo store's home page as the front page, and putting the store's own back (`docs/theme-showcase-phase-1.md` step 4c): for those who
 * may change the website. The front page is the store's (`storeTag`) and the page one of its pages (`pagesTag`).
 */
export async function useDemoHomeAction(storeSlug: string, _state: FormState, data: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await takePackHome(member.account.id, member.store.id, String(data.get("pack") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(pagesTag(member.store.id));
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: [["Your store opens with this home page now. Put in your own words when you are ready.", ...result.notes].join(" ")] };
}

export async function undoDemoHomeAction(storeSlug: string, _state: FormState, data: FormData): Promise<FormState> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const result = await undoHomeTake(member.account.id, member.store.id, String(data.get("take") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(pagesTag(member.store.id));
  updateTag(storeTag(member.store.slug));
  return { status: "ok", messages: [result.messages.join(" ")] };
}
