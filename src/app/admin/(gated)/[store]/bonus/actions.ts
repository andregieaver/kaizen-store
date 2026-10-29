"use server";

import { refresh, updateTag } from "next/cache";

import { adminText } from "@/lib/admin-text";
import type { BonusResult } from "@/lib/bonus";
import { actionAdminLang } from "@/server/admin-request-lang";
import { affiliateTag } from "@/server/affiliates";
import { checkOwnerRole, checkPermission } from "@/server/permissions";
import { saveBonusSettings } from "@/server/bonus";
import { saveReward, switchReward, type RewardSave } from "@/server/bonus-rewards";
import { catalogTag } from "@/server/catalog";
import { cookiesTag } from "@/server/site-cookies";
import { storeTag } from "@/server/stores";

/**
 * Saves the bonus program's settings (D130). Only an owner changes what shoppers are promised; the server checks
 * everything again with the same schema the form uses, and writes the change to the audit log.
 */
export async function saveBonusAction(storeSlug: string, raw: unknown): Promise<BonusResult> {
  const member = await checkOwnerRole(storeSlug);
  if (!member) return { ok: false, problems: [adminText(await actionAdminLang(), "loyalty").bonusPage.ownerOnly] };
  const result = await saveBonusSettings(member.account, member.store.id, raw);
  if (result.ok) {
    // What the storefront shows about earning credits (cards, cart, account) follows the settings.
    updateTag(storeTag(member.store.slug));
    updateTag(catalogTag(member.store.id));
    // The referral program works only while the bonus program is on (D131): its link capture and cookie follow.
    updateTag(affiliateTag(member.store.id));
    updateTag(cookiesTag(member.store.id));
    refresh();
  }
  return result;
}

/** Makes or changes a loyalty reward (D401, `marketing:write`): its code follows it, so codes already handed out take off what it now says. */
export async function saveRewardAction(storeSlug: string, id: string | null, raw: unknown): Promise<RewardSave> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [adminText(await actionAdminLang(), "loyalty").rewards.notAllowed] };
  const result = await saveReward(member, id, raw);
  if (result.ok) refresh();
  return result;
}

/** Switches a reward on or off (D401); its codes stop or start working with it. */
export async function switchRewardAction(storeSlug: string, id: string, active: boolean): Promise<boolean> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return false;
  const done = await switchReward(member, id, active);
  if (done) refresh();
  return done;
}
