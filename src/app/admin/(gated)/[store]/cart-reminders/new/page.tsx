import type { Metadata } from "next";
import Link from "next/link";

import { requireMember } from "@/server/auth";
import { getCartReminderSettings, newStepContent } from "@/server/cart-reminders";

import { ReminderForm } from "../reminder-form";

export const metadata: Metadata = { title: "New cart reminder" };

export default async function NewReminderPage({ params }: PageProps<"/admin/[store]/cart-reminders/new">) {
  const { store } = await requireMember((await params).store);
  const { steps } = await getCartReminderSettings(store.id);
  const last = steps.at(-1)?.delayMinutes ?? 0;
  const locales = [...new Set(store.markets.map((m) => m.locale))];
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/cart-reminders`} className="text-sm underline">
          Cart reminders
        </Link>
        <h1 className="text-2xl font-semibold">New reminder</h1>
      </div>
      <ReminderForm
        store={store}
        step={{
          id: null,
          delayMinutes: last > 0 ? last + 24 * 60 : 60,
          active: true,
          discountCodeId: null,
          content: newStepContent(locales, steps.length),
        }}
      />
    </div>
  );
}
