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
import { countWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Discount code" };

/** Changes one of Kaizen's plan codes (D31). */
export default async function PlatformDiscountPage({ params }: PageProps<"/admin/platform/discounts/[discountId]">) {
  const account = await requirePlatformAdmin();
  const t = adminText(adminLangOf(account.adminLocale), "platform");
  const w = t.discounts;
  const { discountId } = await params;
  if (!z.uuid().safeParse(discountId).success) notFound();
  const [discounts, currencies] = await Promise.all([listPlatformDiscounts(), planCurrencies()]);
  const discount = discounts.find((d) => d.id === discountId);
  if (!discount) notFound();

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/discounts", label: w.back }}
        title={<span className="font-mono">{discount.code}</span>}
        description={<>{countWords(discount.stores, w.onPlans)} {w.editNote}</>}
      />
      <section aria-label={w.code} className={`p-5 ${CARD_CLASS}`}>
        <ActionForm action={updatePlatformDiscountAction.bind(null, discount.id)} className="flex flex-col gap-4">
          <PlatformDiscountFields discount={discount} currencies={currencies} w={t.discountFields} />
          <SubmitButton>{w.save}</SubmitButton>
        </ActionForm>
      </section>
      <DeleteDiscountButton
        action={deletePlatformDiscountAction.bind(null, discount.id)}
        code={discount.code}
        question={deleteQuestion(discount.code, discount.stores, w)}
      />
    </div>
  );
}
