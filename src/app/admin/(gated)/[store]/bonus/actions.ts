"use server";

import { refresh, updateTag } from "next/cache";

import type { BonusResult } from "@/lib/bonus";
import { affiliateTag } from "@/server/affiliates";
import { requireMember } from "@/server/auth";
import { saveBonusSettings } from "@/server/bonus";
import { catalogTag } from "@/server/catalog";
import { cookiesTag } from "@/server/site-cookies";
import { storeTag } from "@/server/stores";

/**
 * Saves the bonus program's settings (D130). Only an owner changes what shoppers are promised; the server checks
 * everything again with the same schema the form uses, and writes the change to the audit log.
 */
export async function saveBonusAction(storeSlug: string, raw: unknown): Promise<BonusResult> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { ok: false, problems: ["Only an owner can change the bonus program."] };
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
