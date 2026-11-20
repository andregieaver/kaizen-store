"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { adminText } from "@/lib/admin-text";
import { NAME_MAX } from "@/lib/email-change";
import { requirePlatformAdmin } from "@/server/auth";
import { cancelEmailChange, correctName, sendEmailChangeFor } from "@/server/email-change";
import { platformAction } from "@/server/store-action";
import { resetTwoStep } from "@/server/two-step";

/**
 * A platform admin takes a lost second step away from an account (wave 1, 1f, docs/wave-1-trust.md 2.6): its factors and recovery codes go, the
 * person is emailed, and they are held at setting it up next time. Audit-logged for the platform and for each of the person's stores. A platform
 * admin cannot reset their own here: Your account is the way, and another platform admin the fallback.
 */
export async function resetTwoStepAction(accountId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!z.uuid().safeParse(accountId).success) return { status: "error", messages: ["Unknown account."] };
  if (formData.get("confirm") !== "on") return { status: "error", messages: ["Tick the box to say you have checked that it is the person."] };
  const result = await resetTwoStep(admin, accountId);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  refresh();
  return { status: "ok", messages: ["Their two-step sign-in was removed and they have been emailed. They set it up again when they next sign in."] };
}

const failed = (message: string): FormState => ({ status: "error", messages: [message] });

/** Corrects a customer's name (D836): the stores area's (support and owners), in the person's change log and the platform's. */
export async function correctNameAction(accountId: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "stores", action: "platform.customer_name", answer: failed }, async (admin, lang) => {
    const w = adminText(lang, "bookings").account.profile;
    if (!z.uuid().safeParse(accountId).success) return failed(w.problems.not_found);
    const result = await correctName(admin, accountId, form.get("name"));
    if (!result.ok) {
      const problem = fillWords(w.problems[result.problem], { n: NAME_MAX });
      return { status: "error", messages: [problem], fields: { name: problem } };
    }
    refresh();
    return { status: "ok", messages: [adminText(lang, "platform").customer.nameSaved] };
  });
}

/**
 * Sends a link to a new address for a customer (D836): an owner of the platform's alone, after a sign-in of their own in the last ten minutes;
 * the email changes only when the link is opened, and the person's current address is told.
 */
export async function sendEmailChangeAction(accountId: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "stores", action: "platform.customer_email_change", answer: failed }, async (admin, lang) => {
    const c = adminText(lang, "platform").customer;
    const w = adminText(lang, "bookings").account.email;
    if (!admin.platformAdmin) return failed(c.ownersSend);
    if (!z.uuid().safeParse(accountId).success) return failed(w.problems.not_found);
    const result = await sendEmailChangeFor(admin, accountId, form.get("email"));
    if (!result.ok) {
      const problem = result.problem === "sign_in_again" ? c.signInAgain : w.problems[result.problem];
      const field = result.problem === "invalid" || result.problem === "same" || result.problem === "taken";
      return { status: "error", messages: [problem], ...(field ? { fields: { email: problem } } : {}) };
    }
    refresh();
    return { status: "ok", messages: [fillWords(c.linkSent, { email: result.email })] };
  });
}

/** Cancels a customer's waiting change of email: an owner of the platform's, as sending one is. */
export async function cancelEmailChangeForAction(accountId: string): Promise<FormState> {
  return platformAction({ area: "stores", action: "platform.customer_email_cancel", answer: failed }, async (admin, lang) => {
    const c = adminText(lang, "platform").customer;
    const w = adminText(lang, "bookings").account.email;
    if (!admin.platformAdmin) return failed(c.ownersSend);
    if (!z.uuid().safeParse(accountId).success || !(await cancelEmailChange(accountId, admin))) return failed(w.problems.none);
    refresh();
    return { status: "ok", messages: [w.cancelled] };
  });
}
