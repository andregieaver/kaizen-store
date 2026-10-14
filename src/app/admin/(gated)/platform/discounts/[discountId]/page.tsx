import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { ActionForm, SubmitButton } from "@/components/admin/action-form";
import { DeleteDiscountButton } from "@/components/admin/delete-discount-button";
import { planCurrencies } from "@/server/billing";
import { listPlatformDiscounts } from "@/server/platform-discounts";

import { deletePlatformDiscountAction, updatePlatformDiscountAction } from "../../actions";
import { deleteQuestion, PlatformDiscountFields } from "../discount-fields";
import { requirePlatformAdmin } from "@/server/auth";
import { CARD_CLASS, PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Discount code" };

/** Changes one of Kaizen's plan codes (D31). */
export default async function PlatformDiscountPage({ params }: PageProps<"/admin/platform/discounts/[discountId]">) {
  await requirePlatformAdmin();
  const { discountId } = await params;
  if (!z.uuid().safeParse(discountId).success) notFound();
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const discount = discounts.find((d) => d.id === discountId);
  if (!discount) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/discounts", label: "Discounts" }}
        title={<span className="font-mono">{discount.code}</span>}
        description={<>On {discount.stores} {discount.stores === 1 ? "store's plan" : "stores' plans"}. Changing what it gives makes a new coupon in Stripe for codes used from now on; plans that already have it keep what they got.</>}
      />
      <section aria-label="Code" className={`p-5 ${CARD_CLASS}`}>
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
