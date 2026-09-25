"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { t } from "@/lib/i18n";
import { resolveShop } from "@/server/shop";
import {
  addWishlistToCart,
  createWishlist,
  deleteWishlist,
  moveWishlistItems,
  removeWishlistItems,
  setWishlistItem,
  toggleSavedProduct,
  updateWishlist,
  type CartOutcome,
} from "@/server/wishlists";

const id = z.uuid();
const ids = z.array(z.uuid()).max(200);

async function shopFor(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  return shop ? { shop, w: t(shop.market.lang).wishlist } : null;
}

/** The heart (D34): saves the product, or takes it out of every list. */
export async function toggleWishlistAction(
  storeSlug: string,
  marketSlug: string,
  productId: string,
): Promise<{ saved: boolean; products: string[] }> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !id.safeParse(productId).success) return { saved: false, products: [] };
  return toggleSavedProduct(found.shop.store.id, productId, found.w.defaultName);
}

export type WishlistActionResult = { ok: boolean; message: string | null; id?: string };

export async function createListAction(storeSlug: string, marketSlug: string, name: string): Promise<WishlistActionResult> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found) return { ok: false, message: null };
  const result = await createWishlist(found.shop.store.id, name);
  if (!result.ok) return { ok: false, message: result.problem === "limit" ? found.w.limit : found.w.nameProblem };
  refresh();
  return { ok: true, message: null, id: result.id };
}

export async function updateListAction(
  storeSlug: string,
  marketSlug: string,
  listId: string,
  change: { name?: string; keepAfterCart?: boolean },
): Promise<WishlistActionResult> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !id.safeParse(listId).success) return { ok: false, message: null };
  const result = await updateWishlist(found.shop.store.id, listId, change);
  if (!result.ok) return { ok: false, message: result.problem === "name" ? found.w.nameProblem : null };
  refresh();
  return { ok: true, message: null };
}

export async function deleteListAction(storeSlug: string, marketSlug: string, listId: string): Promise<WishlistActionResult> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !id.safeParse(listId).success) return { ok: false, message: null };
  const ok = await deleteWishlist(found.shop.store.id, listId);
  refresh();
  return { ok, message: null };
}

export async function moveItemsAction(
  storeSlug: string,
  marketSlug: string,
  itemIds: string[],
  toListId: string,
  toName: string,
): Promise<WishlistActionResult> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !ids.safeParse(itemIds).success || !id.safeParse(toListId).success) return { ok: false, message: null };
  const moved = await moveWishlistItems(found.shop.store.id, itemIds, toListId);
  refresh();
  return { ok: moved > 0, message: moved > 0 ? found.w.moved(moved, toName) : null };
}

export async function removeItemsAction(storeSlug: string, marketSlug: string, itemIds: string[]): Promise<WishlistActionResult> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !ids.safeParse(itemIds).success) return { ok: false, message: null };
  await removeWishlistItems(found.shop.store.id, itemIds);
  refresh();
  return { ok: true, message: null };
}

export async function setItemAction(
  storeSlug: string,
  marketSlug: string,
  itemId: string,
  change: { variantId?: string | null; quantity?: number },
): Promise<WishlistActionResult> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !id.safeParse(itemId).success) return { ok: false, message: null };
  if (change.variantId && !id.safeParse(change.variantId).success) return { ok: false, message: null };
  const ok = await setWishlistItem(found.shop.store.id, itemId, change);
  return { ok, message: null };
}

/** All of a list, or the chosen items, to the cart; the list keeps them or not, as the shopper chose. */
export async function addToCartAction(
  storeSlug: string,
  marketSlug: string,
  listId: string,
  itemIds: string[] | null,
): Promise<{ added: number; outcomes: Record<string, CartOutcome>; message: string }> {
  const found = await shopFor(storeSlug, marketSlug);
  if (!found || !id.safeParse(listId).success || (itemIds && !ids.safeParse(itemIds).success)) {
    return { added: 0, outcomes: {}, message: "" };
  }
  const { outcomes } = await addWishlistToCart(found.shop.store.id, found.shop.market, listId, itemIds);
  const added = Object.values(outcomes).filter((o) => o === "added" || o === "capped").length;
  refresh();
  return { added, outcomes, message: added > 0 ? found.w.added(added) : "" };
}
