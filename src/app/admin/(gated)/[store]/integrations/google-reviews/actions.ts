"use server";

import { refresh } from "next/cache";

import { requireMember, type Membership } from "@/server/auth";
import { choosePlace, findPlaces, removeGoogle, saveGoogleKey } from "@/server/google-reviews";

/** The Google key is billed to the owner's own account, so only an owner sets it up (D91). */
async function asOwner(storeSlug: string): Promise<Membership | string> {
  const member = await requireMember(storeSlug);
  return member.role === "owner" ? member : "Only an owner can set up Google reviews.";
}

export async function saveStoreGoogleKeyAction(storeSlug: string, key: string) {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false as const, problems: [owner] };
  const result = await saveGoogleKey(owner.account.id, owner.store.id, key);
  if (result.ok) refresh();
  return result;
}

export async function findStorePlacesAction(storeSlug: string, query: string) {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false as const, problems: [owner] };
  return findPlaces(owner.store.id, query);
}

export async function chooseStorePlaceAction(storeSlug: string, placeId: string) {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false as const, problems: [owner] };
  const result = await choosePlace(owner.account.id, owner.store.id, placeId);
  if (result.ok) refresh();
  return result;
}

export async function removeStoreGoogleAction(storeSlug: string) {
  const owner = await asOwner(storeSlug);
  if (typeof owner === "string") return { ok: false as const, problems: [owner] };
  await removeGoogle(owner.account.id, owner.store.id);
  refresh();
  return { ok: true as const };
}
