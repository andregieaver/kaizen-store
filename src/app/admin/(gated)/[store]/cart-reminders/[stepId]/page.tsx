import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteReminderButton } from "@/components/admin/delete-reminder-button";
import { describeDelay } from "@/lib/cart-reminders";
import { requireMember } from "@/server/auth";
import { getCartReminderStep } from "@/server/cart-reminders";

import { deleteReminderStepAction } from "../actions";
import { ReminderForm } from "../reminder-form";

export const metadata: Metadata = { title: "Cart reminder" };

export default async function ReminderPage({ params }: PageProps<"/admin/[store]/cart-reminders/[stepId]">) {
  const { store: slug, stepId } = await params;
  const { store } = await requireMember(slug);
  if (!z.uuid().safeParse(stepId).success) notFound();
  const step = await getCartReminderStep(store.id, stepId);
  if (!step) notFound();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href={`/admin/${store.slug}/cart-reminders`} className="text-sm underline">
          Cart reminders
        </Link>
        <h1 className="text-2xl font-semibold">Reminder after {describeDelay(step.delayMinutes)}</h1>
      </div>
      <ReminderForm store={store} step={step} />
      <DeleteReminderButton action={deleteReminderStepAction.bind(null, store.slug, step.id)} />
    </div>
  );
}
