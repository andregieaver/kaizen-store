"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";

import { SHOPIFY_STATE_COOKIE, SHOPIFY_STATE_MINUTES, SHOPIFY_STATE_PATH } from "@/lib/shopify";
import { readOldShop } from "@/server/old-shop";
import { checkPermission } from "@/server/permissions";
import { disconnectShopify, shopifyConnection, startShopifyConnect, type StartProblem } from "@/server/shopify-connect";
import { advanceCopy, bringItOver, startCopy } from "@/server/shopify-copy";
import { copyMoving } from "@/lib/shopify-copy";

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
export async function startCopyAction(storeSlug: string): Promise<{ ok: boolean }> {
  const member = await checkPermission(storeSlug, "owner");
  if (!member) return { ok: false };
  const result = await startCopy(member);
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
