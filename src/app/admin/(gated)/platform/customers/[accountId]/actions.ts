"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { fillWords } from "@/lib/admin-fill";
import { NAME_MAX } from "@/lib/email-change-limits";
import { formRefusal } from "@/lib/form-problems";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";
import { PLATFORM_WORDS } from "@/lib/admin-words/platform";
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

/** A refusal or failure of the wrapper, in the form's shape. */
const inForm = (message: string): FormState => formRefusal(message);
const isAccount = (id: string) => z.uuid().safeParse(id).success;

/** Corrects a customer's name (D836): the stores area's (support and owners), in the person's change log and the platform's. */
export async function correctNameAction(accountId: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "stores", action: "platform.customer_name", answer: inForm }, async (admin, lang) => {
    const w = BOOKINGS_WORDS[lang].account.profile;
    if (!isAccount(accountId)) return formRefusal(w.problems.not_found);
    const result = await correctName(admin, accountId, form.get("name"));
    if (!result.ok) return formRefusal(fillWords(w.problems[result.problem], { n: NAME_MAX }), "name");
    refresh();
    return { status: "ok", messages: [PLATFORM_WORDS[lang].customer.nameSaved] };
  });
}

/**
 * Sends a link to a new address for a customer (D836): an owner of the platform's alone, after a sign-in of their own in the last ten minutes;
 * the email changes only when the link is opened, and the person's current address is told.
 */
export async function sendEmailChangeAction(accountId: string, _state: FormState, form: FormData): Promise<FormState> {
  return platformAction({ area: "stores", action: "platform.customer_email_change", answer: inForm }, async (admin, lang) => {
    const c = PLATFORM_WORDS[lang].customer;
    const w = BOOKINGS_WORDS[lang].account.email;
    if (!admin.platformAdmin) return formRefusal(c.ownersSend);
    if (!isAccount(accountId)) return formRefusal(w.problems.not_found);
    const result = await sendEmailChangeFor(admin, accountId, form.get("email"));
    if (!result.ok) {
      const field = result.problem === "invalid" || result.problem === "same" || result.problem === "taken" ? "email" : undefined;
      return formRefusal(result.problem === "sign_in_again" ? c.signInAgain : w.problems[result.problem], field);
    }
    refresh();
    return { status: "ok", messages: [fillWords(c.linkSent, { email: result.email })] };
  });
}

/** Cancels a customer's waiting change of email: an owner of the platform's, as sending one is. */
export async function cancelEmailChangeForAction(accountId: string): Promise<FormState> {
  return platformAction({ area: "stores", action: "platform.customer_email_cancel", answer: inForm }, async (admin, lang) => {
    const w = BOOKINGS_WORDS[lang].account.email;
    if (!admin.platformAdmin) return formRefusal(PLATFORM_WORDS[lang].customer.ownersSend);
    if (!isAccount(accountId) || !(await cancelEmailChange(accountId, admin))) return formRefusal(w.problems.none);
    refresh();
    return { status: "ok", messages: [w.cancelled] };
  });
}
