import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { DeleteReminderButton } from "@/components/admin/delete-reminder-button";
import { describeDelay } from "@/lib/cart-reminders";
import { getPlanReminderStep } from "@/server/plan-reminders";

import { deletePlanReminderAction } from "../actions";
import { PlanReminderForm } from "../reminder-form";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "Plan reminder" };

export default async function PlanReminderPage({ params }: PageProps<"/admin/platform/plan-reminders/[stepId]">) {
  await requirePlatformAdmin();
  const { stepId } = await params;
  if (!z.uuid().safeParse(stepId).success) notFound();
  const step = await getPlanReminderStep(stepId);
  if (!step) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/plan-reminders", label: "Plan reminders" }}
        title={<>Reminder after {describeDelay(step.delayMinutes)}</>}
      />
      <PlanReminderForm step={step} />
      <DeleteReminderButton action={deletePlanReminderAction.bind(null, step.id)} />
    </div>
  );
}
