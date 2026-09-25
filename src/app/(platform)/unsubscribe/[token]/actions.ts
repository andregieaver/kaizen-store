"use server";

import { redirect } from "next/navigation";

import { unsubscribeFromPlanReminders } from "@/server/plan-reminders";

/** The button on Kaizen's unsubscribe page: no more reminders about plans (D33). */
export async function unsubscribePlanAction(token: string): Promise<void> {
  const done = token.length <= 64 && (await unsubscribeFromPlanReminders(token));
  redirect(`/unsubscribe/${token}?${done ? "done" : "unknown"}=1`);
}
