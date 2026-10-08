import type { Metadata } from "next";
import Link from "next/link";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";

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
      <div>
        <Link href={`/admin/${store.slug}/campaigns`} className="text-sm underline">
          Campaigns
        </Link>
        <h1 className="text-2xl font-semibold">New campaign</h1>
      </div>
      <CampaignForm store={store} campaign={null} />
    </div>
  );
}
