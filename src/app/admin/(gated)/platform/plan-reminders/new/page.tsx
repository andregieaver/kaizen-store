import type { Metadata } from "next";
import { connection } from "next/server";

import { getPlanReminderSettings, newPlanStepContent } from "@/server/plan-reminders";

import { PlanReminderForm } from "../reminder-form";
import { requirePlatformAdmin } from "@/server/auth";
import { PageHeader } from "@/components/admin/ui";

export const metadata: Metadata = { title: "New plan reminder" };

export default async function NewPlanReminderPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  await requirePlatformAdmin();
  const { steps } = await getPlanReminderSettings();
  const last = steps.at(-1)?.delayMinutes ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <PageHeader back={{ href: "/admin/platform/plan-reminders", label: "Plan reminders" }} title="New reminder" />
      <PlanReminderForm
        step={{ id: null, delayMinutes: last > 0 ? last + 24 * 60 : 60, active: true, discountCodeId: null, content: newPlanStepContent(steps.length) }}
      />
    </div>
  );
}
