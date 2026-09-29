import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { campaignStatus } from "@/lib/campaigns";
import { requireMember } from "@/server/auth";
import { getCampaign, listCampaigns } from "@/server/campaigns";

import { deleteCampaignAction } from "../actions";
import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "Campaign" };

const STATUS = { active: "Running now", off: "Switched off", scheduled: "Starts later", ended: "Ended" } as const;

export default async function CampaignPage({ params }: PageProps<"/admin/[store]/campaigns/[campaignId]">) {
  const { store: slug, campaignId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(campaignId).success) notFound();
  const campaign = await getCampaign(store.id, campaignId);
  if (!campaign) notFound();
  const orders = (await listCampaigns(store.id)).find((c) => c.id === campaign.id)?.orders ?? 0;
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/campaigns`} className="text-sm underline">
          Campaigns
        </Link>
        <h1 className="text-2xl font-semibold">{campaign.name}</h1>
        <p className="text-sm text-muted">
          {STATUS[campaignStatus(campaign)]}. {orders} {orders === 1 ? "order has" : "orders have"} got something from it.
        </p>
      </div>
      <CampaignForm store={store} campaign={campaign} orders={orders} />
      <DeleteDiscountButton
        action={deleteCampaignAction.bind(null, store.slug, campaign.id)}
        code={campaign.name}
        label="Delete this campaign"
        question={`Delete the campaign ${campaign.name}? Shoppers no longer get it.${orders > 0 ? ` The ${orders} ${orders === 1 ? "order" : "orders"} that got something from it keep it.` : ""}`}
      />
    </div>
  );
}
