import type { Metadata } from "next";
import Link from "next/link";

import { requirePermission } from "@/server/permissions";

import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params }: PageProps<"/admin/[store]/campaigns/new">) {
  const { store } = await requirePermission((await params).store, "marketing:read");
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
