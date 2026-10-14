import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireFeature } from "@/components/admin/feature-off";
import { DeleteReminderButton } from "@/components/admin/delete-reminder-button";
import { describeDelay } from "@/lib/cart-reminders";
import { requirePermission } from "@/server/permissions";
import { getCartReminderStep } from "@/server/cart-reminders";
import { PageHeader } from "@/components/admin/ui";

import { deleteReminderStepAction } from "../actions";
import { ReminderForm } from "../reminder-form";

export const metadata: Metadata = { title: "Cart reminder" };

export default async function ReminderPage({ params }: PageProps<"/admin/[store]/cart-reminders/[stepId]">) {
  const { store: slug, stepId } = await params;
  const gated = await requirePermission(slug, "marketing:read");
  // Part of the online shop (D178 step 5): hidden while it is off, the store being a website.
  const shopOff = requireFeature(gated, "shop");
  if (shopOff) return shopOff;
  const { store } = gated;
  if (!z.uuid().safeParse(stepId).success) notFound();
  const step = await getCartReminderStep(store.id, stepId);
  if (!step) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: `/admin/${store.slug}/cart-reminders`, label: "Cart reminders" }}
        title={<>Reminder after {describeDelay(step.delayMinutes)}</>}
      />
      <ReminderForm store={store} step={step} />
      <DeleteReminderButton action={deleteReminderStepAction.bind(null, store.slug, step.id)} />
    </div>
  );
}
