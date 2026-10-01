import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";

import { CampaignForm } from "../campaign-form";

export const metadata: Metadata = { title: "New campaign" };

export default async function NewCampaignPage({ params }: PageProps<"/admin/[store]/campaigns/new">) {
  const { store } = await requireMember((await params).store);
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
