"use server";

import { refresh, updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { CampaignInput } from "@/lib/campaigns";
import { requireMember } from "@/server/auth";
import { campaignsTag } from "@/server/campaign-notices";
import { deleteCampaign, saveCampaign, setCampaignActive } from "@/server/campaigns";
import type { SaveResult } from "@/server/settings";

/** Creates a campaign (id null) or changes one (D114). */
export async function saveCampaignAction(storeSlug: string, id: string | null, input: CampaignInput): Promise<SaveResult & { id?: string }> {
  const member = await requireMember(storeSlug);
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown campaign."] };
  const result = await saveCampaign(member, id, input);
  if (result.ok) {
    // The product pages and cards announce campaigns from the cache (D115).
    updateTag(campaignsTag(member.store.id));
    refresh();
  }
  return result;
}

/** Deletes a campaign; the orders that got something from it keep it. */
export async function deleteCampaignAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown campaign."] };
  const result = await deleteCampaign(member, id);
  if (result.ok) updateTag(campaignsTag(member.store.id));
  if (result.ok) redirect(`/admin/${member.store.slug}/campaigns`);
  return result;
}

/** Switches a campaign on or off from the list. */
export async function setCampaignActiveAction(storeSlug: string, id: string, active: boolean): Promise<void> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return;
  await setCampaignActive(member, id, active);
  updateTag(campaignsTag(member.store.id));
  refresh();
}
