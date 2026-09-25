"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { ReminderStepInput } from "@/lib/cart-reminders";
import { requireMember } from "@/server/auth";
import {
  deleteCartReminderStep,
  saveCartReminderStep,
  sendTestReminder,
  setCartRemindersEnabled,
} from "@/server/cart-reminders";
import type { SaveResult } from "@/server/settings";

/** Turns the store's cart reminders on (with three to start from) or off (D33). */
export async function setCartRemindersAction(storeSlug: string, enabled: boolean): Promise<void> {
  const member = await requireMember(storeSlug);
  await setCartRemindersEnabled(member, enabled);
  refresh();
}

/** Creates a reminder (id null) or changes one. */
export async function saveReminderStepAction(
  storeSlug: string,
  id: string | null,
  input: ReminderStepInput,
): Promise<SaveResult & { id?: string }> {
  const member = await requireMember(storeSlug);
  if (id !== null && !z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown reminder."] };
  const result = await saveCartReminderStep(member, id, input);
  if (result.ok) refresh();
  return result;
}

export async function deleteReminderStepAction(storeSlug: string, id: string): Promise<SaveResult> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false, problems: ["Unknown reminder."] };
  await deleteCartReminderStep(member, id);
  redirect(`/admin/${member.store.slug}/cart-reminders`);
}

/** Sends the saved reminder, with a sample cart, to the staff member's own email. */
export async function sendTestReminderAction(
  storeSlug: string,
  id: string,
  locale: string,
): Promise<{ ok: boolean; message: string }> {
  const member = await requireMember(storeSlug);
  if (!z.uuid().safeParse(id).success) return { ok: false, message: "Save the reminder first." };
  const outcome = await sendTestReminder(member, id, locale);
  if (outcome === "sent") return { ok: true, message: `Sent to ${member.account.email}.` };
  if (outcome === "logged") return { ok: true, message: "Email is not set up, so the test is only in the email log." };
  return { ok: false, message: "The test could not be sent. See the email log." };
}
