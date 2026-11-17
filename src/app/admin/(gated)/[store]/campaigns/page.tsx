import { redirect } from "next/navigation";

import { discountTabHref } from "@/lib/discount-tabs";
import { requirePermission } from "@/server/permissions";

/**
 * The old Campaigns page (D114): the automatic offers are the Automatic tab of Discounts now (ecosystem plan E3.7, D718), so this
 * address leads there. Each offer's own pages (`/campaigns/new`, `/campaigns/[campaignId]`) stay where they were. The person is checked
 * first, so someone without a session is sent to sign in from here, as from any admin page.
 */
export default async function CampaignsPage({ params }: PageProps<"/admin/[store]/campaigns">) {
  const { store } = await requirePermission((await params).store, "marketing:read");
  redirect(discountTabHref(store.slug, "automatic"));
}
