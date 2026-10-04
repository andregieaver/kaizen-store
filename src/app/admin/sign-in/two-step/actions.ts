"use server";

import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import { safeNext } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { getSessionAccount } from "@/server/auth";
import { finishEnrolment, passSecondStep, startEnrolment, useRecoveryCode as spendRecoveryCode, type EnrolFinish, type EnrolStart } from "@/server/two-step";

/**
 * The second step of signing in, and setting it up (wave 1, 1f, `docs/wave-1-trust.md` 2.6). These run for a person who has passed the
 * first step but not the gate, so they ask `getSessionAccount()`, not `getAccount()` (which fails closed for exactly this person). Each
 * does only what its own page is for, and the server functions underneath decide everything that matters (limits, single use, audit).
 */

const SIGN_IN_AGAIN = "Sign in again to continue.";

/** The six digits from the authenticator app. A right code goes on to where the person was going. */
export async function verifyTwoStepAction(next: string, _state: FormState, formData: FormData): Promise<FormState> {
  const account = await getSessionAccount();
  if (!account) return { status: "error", messages: [SIGN_IN_AGAIN] };
  const result = await passSecondStep(account, String(formData.get("code") ?? ""));
  if (!result.ok) return { status: "error", messages: [result.problem] };
  // A full navigation (redirect) so the session that was just promoted is the one the next page reads.
  redirect(safeNext(next));
}

/**
 * A recovery code, for someone who has lost their phone: it works once, takes the second step away and ends every session, so the
 * person signs in again and is held at setting it up. Where recovery cannot be done the code is not spent and the answer says so.
 */
export async function recoveryCodeAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await getSessionAccount();
  if (!account) return { status: "error", messages: [SIGN_IN_AGAIN] };
  const result = await spendRecoveryCode(account, String(formData.get("code") ?? ""));
  if (!result.ok) return { status: "error", messages: [result.problem] };
  redirect("/admin/sign-in?notice=recovered");
}

/** Starts setting up an authenticator app: nothing is made until the person presses the button. */
export async function startEnrolmentAction(): Promise<EnrolStart> {
  const account = await getSessionAccount();
  if (!account) return { ok: false, problem: SIGN_IN_AGAIN };
  return startEnrolment();
}

/** The first code from the app turns two-step sign-in on and returns the ten recovery codes, to be shown once. */
export async function finishEnrolmentAction(factorId: string, code: string): Promise<EnrolFinish> {
  const account = await getSessionAccount();
  if (!account) return { ok: false, problem: SIGN_IN_AGAIN };
  return finishEnrolment(account, String(factorId), String(code));
}

/** A way out of the second step's pages for someone who cannot pass it. */
export async function leaveTwoStepAction(): Promise<void> {
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect("/admin/sign-in");
  }
}
