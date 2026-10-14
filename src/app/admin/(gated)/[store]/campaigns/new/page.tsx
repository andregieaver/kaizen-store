import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params }: PageProps<"/admin/[store]/campaigns/new">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/campaigns`, label: "Campaigns" }} title="New campaign" />
      <CampaignForm store={store} campaign={null} />
    </div>
  );
}
