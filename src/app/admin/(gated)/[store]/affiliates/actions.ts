"use server";

import { refresh, updateTag } from "next/cache";
import { z } from "zod";

import type { AffiliateResult } from "@/lib/affiliates";
import { requireMember } from "@/server/auth";
import { affiliateTag, saveAffiliateSettings, setAffiliateBlocked } from "@/server/affiliates";
import { catalogTag } from "@/server/catalog";
import { cookiesTag } from "@/server/site-cookies";
import { storeTag } from "@/server/stores";

/**
 * Saves the referral program's settings (D131). Only an owner changes what shoppers are promised; the server checks
 * everything again with the same schema the form uses, refuses to switch the program on while the bonus program is off,
 * and writes the audit log.
 */
export async function saveAffiliateAction(storeSlug: string, raw: unknown): Promise<AffiliateResult> {
  const member = await requireMember(storeSlug);
  if (member.role !== "owner") return { ok: false, problems: ["Only an owner can change the referral program."] };
  const result = await saveAffiliateSettings(member.account, member.store.id, raw);
  if (result.ok) {
    // What the storefront shows and does about links (the capture in its layouts, the cookie the banner asks about, the
    // cart's nudge) follows the settings.
    updateTag(affiliateTag(member.store.id));
    updateTag(cookiesTag(member.store.id));
    updateTag(storeTag(member.store.slug));
    updateTag(catalogTag(member.store.id));
    refresh();
  }
  return result;
}

/**
 * Blocks a referrer with a reason, or lets them earn again (D131). Owners and admins of the store both may; the server
 * writes the audit log. What the referrer has earned stays.
 */
export async function blockAffiliateAction(
  storeSlug: string,
  customerId: string,
  blocked: boolean,
  note: string,
): Promise<AffiliateResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(customerId).success) return { ok: false, problems: ["Unknown customer."] };
  const result = await setAffiliateBlocked(member.account, member.store.id, customerId, Boolean(blocked), String(note ?? ""));
  if (result.ok) refresh();
  return result;
}
