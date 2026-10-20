import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { GeneratedCodes } from "@/components/admin/generated-codes";
import { memberCan, requirePermission } from "@/server/permissions";
import { codeItemCounts, getDiscount } from "@/server/discounts";
import { PageHeader } from "@/components/admin/ui";

import { deleteDiscountAction, generateCodesAction } from "../actions";
import { DiscountForm } from "../discount-form";

export const metadata: Metadata = { title: "Coupon" };

export default async function DiscountPage({ params }: PageProps<"/admin/[store]/discounts/[discountId]">) {
  const { store: slug, discountId } = await params;
  const gated = await requirePermission(slug, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!z.uuid().safeParse(discountId).success) notFound();
  const discount = await getDiscount(store.id, discountId);
  if (!discount) notFound();
  const items = discount.uniqueCodes ? await codeItemCounts(store.id, discount.id) : null;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/discounts`, label: "Coupons" }}
        title={<span className="font-mono">{discount.code}</span>}
        description={<>Used by {discount.used} {discount.used === 1 ? "order" : "orders"}{discount.usageLimit !== null && ` of ${discount.usageLimit} allowed`}.</>}
      />
      {items && (
        <GeneratedCodes
          made={items.made}
          used={items.used}
          canWrite={memberCan(gated, "marketing:write")}
          exportHref={`/admin/${store.slug}/discounts/${discount.id}/codes`}
          generate={generateCodesAction.bind(null, store.slug, discount.id)}
        />
      )}
      <DiscountForm store={store} discount={discount} />
      <DeleteDiscountButton
        action={deleteDiscountAction.bind(null, store.slug, discount.id)}
        code={discount.code}
        used={discount.used}
      />
    </div>
  );
}
