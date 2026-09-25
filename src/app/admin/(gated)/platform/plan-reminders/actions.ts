"use server";

import { refresh } from "next/cache";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import type { ReminderStepInput } from "@/lib/cart-reminders";
import { requireAccount, type Account } from "@/server/auth";
import {
  deletePlanReminderStep,
  savePlanReminderStep,
  sendTestPlanReminder,
  setPlanRemindersEnabled,
} from "@/server/plan-reminders";
import type { SaveResult } from "@/server/settings";

async function platformAdmin(): Promise<Account> {
  const account = await requireAccount();
  if (!account.platformAdmin) notFound();
  return account;
}

/** Turns Kaizen's plan reminders on (with three to start from) or off (D33). */
export async function setPlanRemindersAction(enabled: boolean): Promise<void> {
  await setPlanRemindersEnabled(await platformAdmin(), enabled);
  refresh();
}

export async function savePlanReminderAction(id: string | null, input: ReminderStepInput): Promise<SaveResult & { id?: string }> {
  const actor = await platformAdmin();
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown reminder."] };
  const result = await savePlanReminderStep(actor, id, input);
  if (result.ok) refresh();
  return result;
}

export async function deletePlanReminderAction(id: string): Promise<SaveResult> {
  const actor = await platformAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown reminder."] };
  await deletePlanReminderStep(actor, id);
  redirect("/admin/platform/plan-reminders");
}

/** The saved reminder, with a sample plan, to the platform admin's own email. */
export async function sendTestPlanReminderAction(id: string): Promise<{ ok: boolean; message: string }> {
  const actor = await platformAdmin();
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Save the reminder first." };
  const outcome = await sendTestPlanReminder(actor, id);
  if (outcome === "sent") return { ok: true, message: `Sent to ${actor.email}.` };
  if (outcome === "logged") return { ok: true, message: "Email is not set up, so the test is only in the email log." };
  return { ok: false, message: "The test could not be sent. It needs a plan and a store; see the email log." };
}
