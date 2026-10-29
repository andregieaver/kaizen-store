"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission } from "@/server/permissions";
import { cancelTransfer, createTransfer, receiveTransfer, sendTransfer, type DocumentResult } from "@/server/stock-transfers";

/**
 * The transfers pages' steps (wave 11 unit D, D383), each with the store's slug as its bound first argument and `products:write`; the server
 * functions check it again and hold every rule (free units at the origin, never more in than was sent).
 */

const refused = async (): Promise<DocumentResult> => ({ ok: false, problems: [adminText(await actionAdminLang(), "inventory").noAccess] });

export async function createTransferAction(storeSlug: string, raw: unknown): Promise<DocumentResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await createTransfer(member, raw);
  if (result.ok) refresh();
  return result;
}

export async function sendTransferAction(storeSlug: string, id: string): Promise<DocumentResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await sendTransfer(member, String(id));
  if (result.ok) refresh();
  return result;
}

export async function receiveTransferAction(storeSlug: string, id: string, raw: unknown): Promise<DocumentResult & { received?: number }> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await receiveTransfer(member, String(id), raw);
  if (result.ok) refresh();
  return result;
}

export async function cancelTransferAction(storeSlug: string, id: string): Promise<DocumentResult> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return refused();
  const result = await cancelTransfer(member, String(id));
  if (result.ok) refresh();
  return result;
}
