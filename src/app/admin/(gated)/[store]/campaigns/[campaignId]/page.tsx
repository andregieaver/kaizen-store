import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { AdminTextScope } from "@/components/admin/admin-text";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { countWords, fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText, adminTexts } from "@/lib/admin-text";
import { campaignStatus } from "@/lib/campaigns";
import { requirePermission } from "@/server/permissions";
import { getCampaign, listCampaigns } from "@/server/campaigns";
import { PageHeader } from "@/components/admin/ui";

import { deleteCampaignAction } from "../actions";
import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: PageProps<"/admin/[store]/campaigns/[campaignId]">) {
  const { store: slug, campaignId } = await params;
  const gated = await requirePermission(slug, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store, account } = gated;
  const lang = adminLangOf(account.adminLocale);
  const w = adminText(lang, "discounts");
  if (!z.uuid().safeParse(campaignId).success) notFound();
  const campaign = await getCampaign(store.id, campaignId);
  if (!campaign) notFound();
  const orders = (await listCampaigns(store.id)).find((c) => c.id === campaign.id)?.orders ?? 0;
  const status = campaignStatus(campaign);
  return (
    <AdminTextScope texts={adminTexts(lang, ["discounts"])}>
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/campaigns`, label: w.campaigns.title }}
        title={<>{campaign.name}</>}
        description={<>{status === "active" ? w.status.running : w.status[status]}. {countWords(orders, w.campaigns.gotSomething)}</>}
      />
      <CampaignForm store={store} campaign={campaign} orders={orders} />
      <DeleteDiscountButton
        action={deleteCampaignAction.bind(null, store.slug, campaign.id)}
        code={campaign.name}
        label={w.remove.deleteCampaign}
        question={fillWords(w.remove.campaignQuestion, { name: campaign.name }) + (orders > 0 ? countWords(orders, w.remove.campaignKept) : "")}
      />
    </div>
    </AdminTextScope>
  );
}
