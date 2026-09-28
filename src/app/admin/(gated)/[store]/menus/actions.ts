"use server";

import { updateTag } from "next/cache";

import { requireMember } from "@/server/auth";
import { deleteMenu, saveStoreMenu, type MenuSaveResult } from "@/server/menus";
import { storeTag } from "@/server/stores";

/** Saves one of the store's menus (a new one without an id); every page shows it at once (D85). */
export async function saveMenuAction(storeSlug: string, id: string | null, input: unknown): Promise<MenuSaveResult> {
  const member = await requireMember(storeSlug);
  const result = await saveStoreMenu(member, id, input);
  if (result.ok) updateTag(storeTag(member.store.slug));
  return result;
}

/** Deletes one of the store's menus; places that showed it show none. */
export async function deleteMenuAction(storeSlug: string, id: string): Promise<{ ok: boolean }> {
  const { account, store } = await requireMember(storeSlug);
  const ok = await deleteMenu(account.id, store.id, id);
  if (ok) updateTag(storeTag(store.slug));
  return { ok };
}
