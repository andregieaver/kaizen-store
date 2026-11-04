"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import { SHOPIFY_STATE_COOKIE, SHOPIFY_STATE_MINUTES, SHOPIFY_STATE_PATH } from "@/lib/shopify";
import { readOldShop } from "@/server/old-shop";
import { checkPermission } from "@/server/permissions";
import { disconnectShopify, shopifyConnection, startShopifyConnect, type StartProblem } from "@/server/shopify-connect";
import { advanceCopy, bringItOver, startCopy } from "@/server/shopify-copy";
import { saveVendorMaker, type MakerSaved } from "@/server/shopify-makers";
import { advanceMove, cancelMove, issueLeftCard, scheduleMove, shopifyClosed, startMove, type MoveProblem } from "@/server/shopify-move";
import { checkAddress, startAddress } from "@/server/shopify-address";
import { undoCopy, type UndoResult } from "@/server/shopify-undo";
import { copyMoving, ordersSinceFor } from "@/lib/shopify-copy";
import { disconnectWoo, startWooConnect, type WooStartProblem } from "@/server/woocommerce-connect";

/**
 * Settings → Moving in (D445 step 2): connect the Shopify shop (the state cookie set here, then Shopify's own page), disconnect it, and the
 * one press that reads the connected shop's sitemap into the old shop's links (D445 step 1). Each takes the store's slug as its bound first
 * argument and asks for the owner itself.
 */

export type ConnectStep = { ok: false; problem: StartProblem };

export async function connectShopifyAction(storeSlug: string, address: string): Promise<ConnectStep> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "forbidden" };
  const start = await startShopifyConnect(member, typeof address === "string" ? address.slice(0, 300) : "");
  if (!start.ok) return start;
  (await cookies()).set(SHOPIFY_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: SHOPIFY_STATE_PATH, maxAge: SHOPIFY_STATE_MINUTES * 60 });
  redirect(start.url);
}

/** *Connect WooCommerce* (D446 step 1): the site found, then WooCommerce's own *authorize* page on it. */
export async function connectWooAction(storeSlug: string, address: string): Promise<{ ok: false; problem: WooStartProblem }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "forbidden" };
  const start = await startWooConnect(member, typeof address === "string" ? address.slice(0, 300) : "");
  if (!start.ok) return start;
  redirect(start.url);
}

export async function disconnectWooAction(storeSlug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await disconnectWoo(member);
  refresh();
  return result;
}

export async function disconnectShopifyAction(storeSlug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await disconnectShopify(member);
  refresh();
  return result;
}

/** Reads the connected shop's sitemap (its own domain, else its myshopify.com name) and opens the old shop's links. */
export async function checkOldLinksAction(storeSlug: string): Promise<{ ok: false }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const connection = await shopifyConnection(member);
  if (!connection) return { ok: false };
  const read = await readOldShop(member, connection.primaryDomain ?? connection.shop);
  if (!read.ok) return { ok: false };
  redirect(`/admin/${member.store.slug}/redirects/old-shop`);
}

/** *Copy my shop*: a fresh copy, every feed waiting to be read (D445 step 4). */
export async function startCopyAction(storeSlug: string, options: unknown = null): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  // *What to bring* (step 9): checked by `copyOptionsOf()`; the years become a date here, on the server's clock.
  const o = options && typeof options === "object" ? (options as { skip?: unknown; ordersYears?: unknown }) : {};
  const years = typeof o.ordersYears === "number" ? o.ordersYears : null;
  const result = await startCopy(member, { skip: o.skip, ordersSince: ordersSinceFor(years, new Date()) });
  if (result.ok) await advanceCopy(member);
  refresh();
  return result;
}

/** One step of the copy, asked by the open page while it moves; says whether it still moves. */
export async function advanceCopyAction(storeSlug: string): Promise<{ moving: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { moving: false };
  const state = await advanceCopy(member);
  return { moving: state ? copyMoving(state) : false };
}

/** *Bring it over*: the checked feeds applied in order. */
export async function bringItOverAction(storeSlug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await bringItOver(member);
  if (result.ok) await advanceCopy(member);
  refresh();
  return result;
}

/** *Who makes your products?* (D445 step 6): the owner's answer for one Shopify vendor, saved on its products by the bulk editor. */
export async function saveVendorMakerAction(storeSlug: string, input: unknown): Promise<MakerSaved> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "failed" };
  const result = await saveVendorMaker(member, input);
  refresh();
  return result;
}

/** Move day (D445 step 7a): *Move my shop* now. */
export async function startMoveAction(storeSlug: string): Promise<{ ok: boolean; problem?: MoveProblem }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "gone" };
  const result = await startMove(member);
  refresh();
  return result;
}

/** *Choose a time*: a wall-clock time in the store's own time zone. */
export async function scheduleMoveAction(storeSlug: string, local: string): Promise<{ ok: boolean; problem?: MoveProblem }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "gone" };
  const result = await scheduleMove(member, typeof local === "string" ? local : "");
  refresh();
  return result;
}

export async function cancelMoveAction(storeSlug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await cancelMove(member);
  refresh();
  return result;
}

/** One step of a running move, asked by the open page; says whether it still moves. */
export async function advanceMoveAction(storeSlug: string): Promise<{ moving: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { moving: false };
  const state = await advanceMove(member);
  return { moving: state?.status === "moving" };
}

/** Move day, the address (D445 step 7b): *Point it here*. */
export async function startAddressAction(storeSlug: string): Promise<{ ok: boolean; problems?: string[] }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await startAddress(member);
  refresh();
  return result;
}

/** The page's check every 30 seconds while an address waits for its records. */
export async function checkAddressAction(storeSlug: string): Promise<{ done: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { done: false };
  return checkAddress(member);
}

/** The 14 days after (D445 step 7c): *Done, I've closed it*. */
export async function shopifyClosedAction(storeSlug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await shopifyClosed(member);
  refresh();
  return result;
}

/** *Issue it* on a Shopify gift card that had no email (D445 step 8): its new code, returned once to be shown, never kept. */
export async function issueLeftCardAction(storeSlug: string, shopifyId: string): Promise<{ ok: true; code: string } | { ok: false; problem: "gone" | "made" | "no_codes" }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "gone" };
  const result = await issueLeftCard(member, typeof shopifyId === "string" ? shopifyId.slice(0, 100) : "");
  return result.ok ? { ok: true, code: result.code } : result;
}

/** *Undo this copy* (D445 step 9): what the copy made, taken back; only before the first real order. */
export async function undoCopyAction(storeSlug: string): Promise<UndoResult> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await undoCopy(member);
  refresh();
  return result;
}
