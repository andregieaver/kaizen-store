"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import type { CampaignInput } from "@/lib/campaigns";
import { discountProblemsText } from "@/lib/discount-words";
import { actionAdminLang } from "@/server/admin-request-lang";
import { checkPermission, requirePermission } from "@/server/permissions";
import { campaignsTag } from "@/server/campaign-notices";
import { deleteCampaign, saveCampaign, setCampaignActive } from "@/server/campaigns";
import type { SaveResult } from "@/server/settings";

/** The refusal for a person without access, in their language (D312 A6). */
const noAccess = async () => adminText(await actionAdminLang(), "discounts").problems.noAccess;

/** Creates a campaign (id null) or changes one (D114); the server's refusals are said in the person's language. */
export async function saveCampaignAction(storeSlug: string, id: string | null, input: CampaignInput): Promise<SaveResult & { id?: string }> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const w = adminText(adminLangOf(member.account.adminLocale), "discounts");
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problems: [w.problems.unknownCampaign] };
  const result = await saveCampaign(member, id, input);
  if (result.ok) {
    // The product pages and cards announce campaigns from the cache (D115).
    updateTag(campaignsTag(member.store.id));
    refresh();
    return result;
  }
  return { ...result, problems: discountProblemsText(result.problems, w) };
}

/** Deletes a campaign; the orders that got something from it keep it. */
export async function deleteCampaignAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await checkPermission(storeSlug, "marketing:write");
  if (!member) return { ok: false, problems: [await noAccess()] };
  const w = adminText(adminLangOf(member.account.adminLocale), "discounts");
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: [w.problems.unknownCampaign] };
  const result = await deleteCampaign(member, id);
  if (result.ok) updateTag(campaignsTag(member.store.id));
  if (result.ok) redirect(`/admin/${member.store.slug}/campaigns`);
  return { ...result, problems: discountProblemsText(result.problems, w) };
}

/** Switches a campaign on or off from the list. */
export async function setCampaignActiveAction(storeSlug: string, id: string, active: boolean): Promise<void> {
  const member = await requirePermission(storeSlug, "marketing:write");
  if (!z.uuid().safeParse(id).success) return;
  await setCampaignActive(member, id, active);
  updateTag(campaignsTag(member.store.id));
  refresh();
}
