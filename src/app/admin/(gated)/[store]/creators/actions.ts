"use server";

import { refresh, updateTag } from "next/cache";

import type { CreatorResult } from "@/lib/creators";
import { featureOn } from "@/lib/store-features";
import { affiliateTag } from "@/server/affiliates";
import { decideCreator, recordCreatorPayout, saveCreatorSettings, setCreatorRate, type CreatorDecision } from "@/server/creators";
import { checkOwnerRole, checkPermission } from "@/server/permissions";
import { cookiesTag } from "@/server/site-cookies";

/**
 * The creator programme's settings (D386). Owners only; the server checks everything again. The storefront's link capture and the cookie
 * the banner asks about follow the switch, so their tags are refreshed.
 */
export async function saveCreatorSettingsAction(storeSlug: string, raw: unknown): Promise<CreatorResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problem: "owner_only" };
  if (!featureOn(member.store, "shop")) return { ok: false, problem: "off" };
  const result = await saveCreatorSettings(member.account, member.store.id, raw);
  if (result.ok) {
    updateTag(affiliateTag(member.store.id));
    updateTag(cookiesTag(member.store.id));
    refresh();
  }
  return result;
}

/** Approves, declines or stops a creator (staff with `marketing:write`). */
export async function decideCreatorAction(storeSlug: string, creatorId: string, decision: CreatorDecision): Promise<CreatorResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problem: "no_access" };
  if (!featureOn(member.store, "shop")) return { ok: false, problem: "off" };
  const result = await decideCreator(member.account, member.store.id, String(creatorId), decision);
  if (result.ok) refresh();
  return result;
}

/** A creator's own commission, or back to the programme's (null). Owners only. */
export async function setCreatorRateAction(storeSlug: string, creatorId: string, bps: number | null): Promise<CreatorResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problem: "owner_only" };
  const result = await setCreatorRate(member.account, member.store.id, String(creatorId), bps === null ? null : Number(bps));
  if (result.ok) refresh();
  return result;
}

/** A payout the owner made, recorded (Kaizena Flow moves no money). Owners only. */
export async function recordCreatorPayoutAction(storeSlug: string, creatorId: string, raw: unknown): Promise<CreatorResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problem: "owner_only" };
  const result = await recordCreatorPayout(member.account, member.store.id, String(creatorId), raw);
  if (result.ok) refresh();
  return result;
}
