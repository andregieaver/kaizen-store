"use server";

import { refresh } from "next/cache";

import { requirePlatformAdmin } from "@/server/auth";
import { choosePlace, findPlaces, removeGoogle, saveGoogleKey } from "@/server/google-reviews";

/** Kaizen's own Google reviews (D91), for its own pages. */
export async function savePlatformGoogleKeyAction(key: string) {
  const account = await requirePlatformAdmin();
  const result = await saveGoogleKey(account.id, null, key);
  if (result.ok) refresh();
  return result;
}

export async function findPlatformPlacesAction(query: string) {
  await requirePlatformAdmin();
  return findPlaces(null, query);
}

export async function choosePlatformPlaceAction(placeId: string) {
  const account = await requirePlatformAdmin();
  const result = await choosePlace(account.id, null, placeId);
  if (result.ok) refresh();
  return result;
}

export async function removePlatformGoogleAction() {
  const account = await requirePlatformAdmin();
  await removeGoogle(account.id, null);
  refresh();
  return { ok: true as const };
}
