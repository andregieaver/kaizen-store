import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { planCurrencies } from "@/server/billing";
import { listPlatformDiscounts } from "@/server/platform-discounts";

import { deletePlatformDiscountAction, updatePlatformDiscountAction } from "../../actions";
import { deleteQuestion, PlatformDiscountFields } from "../discount-fields";

export const metadata: Metadata = { title: "Discount code" };

/** Changes one of Kaizen's plan codes (D31). */
export default async function PlatformDiscountPage({ params }: PageProps<"/admin/platform/discounts/[discountId]">) {
  const { discountId } = await params;
  if (!z.uuid().safeParse(discountId).success) notFound();
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const discount = discounts.find((d) => d.id === discountId);
  if (!discount) notFound();

  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href="/admin/platform/discounts" className="text-sm underline">
          Discounts
        </Link>
        <h1 className="font-mono text-2xl font-semibold">{discount.code}</h1>
        <p className="text-sm text-muted">
          On {discount.stores} {discount.stores === 1 ? "store's plan" : "stores' plans"}. Changing what it gives makes a new
          coupon in Stripe for codes used from now on; plans that already have it keep what they got.
        </p>
      </div>
      <section aria-label="Code" className="rounded-lg border border-border bg-background p-5">
        <ActionForm action={updatePlatformDiscountAction.bind(null, discount.id)} className="flex flex-col gap-4">
          <PlatformDiscountFields discount={discount} currencies={currencies} />
          <SubmitButton>Save</SubmitButton>
        </ActionForm>
      </section>
      <DeleteDiscountButton
        action={deletePlatformDiscountAction.bind(null, discount.id)}
        code={discount.code}
        question={deleteQuestion(discount.code, discount.stores)}
      />
    </div>
  );
}
