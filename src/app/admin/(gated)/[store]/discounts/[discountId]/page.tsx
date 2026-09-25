import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { requireMember } from "@/server/auth";
import { getDiscount } from "@/server/discounts";

import { deleteDiscountAction } from "../actions";
import { DiscountForm } from "../discount-form";

export const metadata: Metadata = { title: "Coupon" };

export default async function DiscountPage({ params }: PageProps<"/admin/[store]/discounts/[discountId]">) {
  const { store: slug, discountId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(discountId).success) notFound();
  const discount = await getDiscount(store.id, discountId);
  if (!discount) notFound();
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/discounts`} className="text-sm underline">
          Coupons
        </Link>
        <h1 className="font-mono text-2xl font-semibold">{discount.code}</h1>
        <p className="text-sm text-muted">
          Used by {discount.used} {discount.used === 1 ? "order" : "orders"}
          {discount.usageLimit !== null && ` of ${discount.usageLimit} allowed`}.
        </p>
      </div>
      <DiscountForm store={store} discount={discount} />
      <DeleteDiscountButton
        action={deleteDiscountAction.bind(null, store.slug, discount.id)}
        code={discount.code}
        used={discount.used}
      />
    </div>
  );
}
