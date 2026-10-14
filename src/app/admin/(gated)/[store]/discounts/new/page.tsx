import type { Metadata } from "next";

import { requireFeature } from "@/components/admin/feature-off";
import { requirePermission } from "@/server/permissions";
import { PageHeader } from "@/components/admin/ui";

import { DiscountForm } from "../discount-form";

export const metadata: Metadata = { title: "New coupon" };

export default async function NewDiscountPage({ params }: PageProps<"/admin/[store]/discounts/new">) {
  const gated = await requirePermission((await params).store, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: `/admin/${store.slug}/discounts`, label: "Coupons" }} title="New coupon" />
      <DiscountForm store={store} discount={null} />
    </div>
  );
}
