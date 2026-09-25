import type { Metadata } from "next";
import Link from "next/link";
import { connection } from "next/server";

import { getPlanReminderSettings, newPlanStepContent } from "@/server/plan-reminders";

import { PlanReminderForm } from "../reminder-form";

export const metadata: Metadata = { title: "New plan reminder" };

export default async function NewPlanReminderPage() {
  // Per request: admin pages never read the database while the site is built.
  await connection();
  const { steps } = await getPlanReminderSettings();
  const last = steps.at(-1)?.delayMinutes ?? 0;
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/admin/platform/plan-reminders" className="text-sm underline">
          Plan reminders
        </Link>
        <h1 className="text-2xl font-semibold">New reminder</h1>
      </div>
      <PlanReminderForm
        step={{ id: null, delayMinutes: last > 0 ? last + 24 * 60 : 60, active: true, discountCodeId: null, content: newPlanStepContent(steps.length) }}
      />
    </div>
  );
}
