import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";

import { DiscountForm } from "../discount-form";

export const metadata: Metadata = { title: "New discount code" };

export default async function NewDiscountPage({ params }: PageProps<"/admin/[store]/discounts/new">) {
  const { store } = await requireMember((await params).store);
  return (
    <div className="flex max-w-3xl flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/discounts`} className="text-sm underline">
          Discounts
        </Link>
        <h1 className="text-2xl font-semibold">New discount code</h1>
      </div>
      <DiscountForm store={store} discount={null} />
    </div>
  );
}
