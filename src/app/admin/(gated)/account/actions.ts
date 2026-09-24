"use server";

import type { FormState } from "@/components/admin/action-form";
import { passwordProblem } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { audit, requireAccount } from "@/server/auth";

/** Sets or changes the signed-in account's password. */
export async function setPasswordAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requireAccount();
  const password = String(formData.get("password") ?? "");
  const problem = passwordProblem(password, account.email);
  if (problem) return { status: "error", messages: [problem] };

  const { error } = await (await createClient()).auth.updateUser({ password });
  if (error) {
    const message =
      error.code === "same_password"
        ? "That is already your password."
        : error.code === "weak_password"
          ? "That password is too easy to guess or has appeared in a data breach. Choose another."
          : error.code === "reauthentication_needed" || error.code === "session_not_found"
            ? "For your security, sign in again with an email link, then set your password."
            : error.status === 429
              ? "Too many attempts. Wait a few minutes and try again."
              : "The password could not be saved. Try again shortly.";
    return { status: "error", messages: [message] };
  }
  await audit(account.id, null, "account.password_set");
  return {
    status: "ok",
    messages: ["Password saved. Next time, sign in with your email and this password."],
  };
}
