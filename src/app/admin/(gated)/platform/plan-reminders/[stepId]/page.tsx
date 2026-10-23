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
import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";

export const metadata: Metadata = { title: "Plan reminder" };

export default async function PlanReminderPage({ params }: PageProps<"/admin/platform/plan-reminders/[stepId]">) {
  const account = await requirePlatformAdmin();
  const t = adminText(adminLangOf(account.adminLocale), "platform");
  const w = t.planReminderStep;
  const { stepId } = await params;
  if (!z.uuid().safeParse(stepId).success) notFound();
  const step = await getPlanReminderStep(stepId);
  if (!step) notFound();
  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        back={{ href: "/admin/platform/plan-reminders", label: w.back }}
        title={fillWords(w.title, { delay: describeDelay(step.delayMinutes, t.delay) })}
      />
      <PlanReminderForm step={step} />
      <DeleteReminderButton action={deletePlanReminderAction.bind(null, step.id)} words={t.deleteReminder} />
    </div>
  );
}
