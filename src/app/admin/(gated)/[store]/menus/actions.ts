"use server";

import { updateTag } from "next/cache";

import { NO_ACCESS, checkPermission, requirePermission } from "@/server/permissions";
import { deleteMenu, saveStoreMenu, type MenuSaveResult } from "@/server/menus";
import { storeTag } from "@/server/stores";

/** Saves one of the store's menus (a new one without an id); every page shows it at once (D85). */
export async function saveMenuAction(storeSlug: string, id: string | null, input: unknown): Promise<MenuSaveResult> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await saveStoreMenu(member, id, input);
  if (result.ok) updateTag(storeTag(member.store.slug));
  return result;
}

/** Deletes one of the store's menus; places that showed it show none. */
export async function deleteMenuAction(storeSlug: string, id: string): Promise<{ ok: boolean }> {
  const { account, store } = await requirePermission(storeSlug, "website:write");
  const ok = await deleteMenu(account.id, store.id, id);
  if (ok) updateTag(storeTag(store.slug));
  return { ok };
}
