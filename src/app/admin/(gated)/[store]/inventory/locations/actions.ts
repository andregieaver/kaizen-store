"use server";

import { refresh } from "next/cache";

import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { deactivateLocation, moveLocation, reactivateLocation, saveLocation, setFulfilsOnline, type DeactivateResult } from "@/server/inventory-locations";
import type { LocationImpact } from "@/server/inventory";
import { checkOwnerRole, checkPermission } from "@/server/permissions";

/**
 * The locations page's steps (wave 3, D172, `docs/wave-3-inventory.md` 2.3), each with the store's slug as its bound first argument. Adding, renaming and
 * moving are for a member with `products:write`. Deactivating and reactivating take stock off sale or put it back, so they are the OWNER's (`checkOwnerRole`,
 * and the server functions check it again); the deactivation is confirmed with the unit figure the dialog showed, which the server reads again.
 */

/** The refusal before a member is known, in the admin's language (D312 A5). */
const noAccess = async () => adminText(await actionAdminLang(), "inventory").noAccess;

type Step = { ok: true } | { ok: false; problem: string };

export async function saveLocationAction(storeSlug: string, raw: { name: string; country: string }, id: string | null) {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false as const, problem: await noAccess() };
  const result = await saveLocation(member, { name: raw?.name, country: raw?.country }, typeof id === "string" ? id : null);
  if (result.ok) refresh();
  return result;
}

export async function moveLocationAction(storeSlug: string, id: string, direction: "up" | "down"): Promise<Step> {
  const member = await checkPermission(storeSlug, "products:write");
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await moveLocation(member, String(id), direction);
  if (result.ok) refresh();
  return result;
}

export async function deactivateLocationAction(storeSlug: string, id: string, confirmedUnits: number): Promise<DeactivateResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await deactivateLocation(member, String(id), Number(confirmedUnits));
  if (result.ok) refresh();
  return result;
}

export async function reactivateLocationAction(storeSlug: string, id: string): Promise<{ ok: true; impact: LocationImpact } | { ok: false; problem: string }> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await reactivateLocation(member, String(id));
  if (result.ok) refresh();
  return result;
}

export async function setOnlineAction(storeSlug: string, id: string, on: boolean): Promise<Step> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problem: await noAccess() };
  const result = await setFulfilsOnline(member, String(id), on === true);
  if (result.ok) refresh();
  return result.ok ? { ok: true } : result;
}
