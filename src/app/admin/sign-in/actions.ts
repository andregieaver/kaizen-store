"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { canSignIn, signInAccount } from "@/server/auth";
import { admit } from "@/server/sign-in";

const LINK_SENT =
  "If that email has access, a sign-in link is on its way. Open it in this browser; it works once and expires within the hour.";
const WRONG = "Wrong email or password.";
const RESET_SENT =
  "If that email has access, we have sent it a link to choose a new password. Open it in this browser; it works once and expires within the hour.";
const NOT_CONFIGURED: FormState = {
  status: "error",
  messages: ["Sign-in is not configured on this server."],
};

async function origin(): Promise<string> {
  const header = (await headers()).get("origin");
  return header ? new URL(header).origin : siteUrl();
}

async function supabaseOrNull() {
  try {
    return await createClient();
  } catch {
    return null;
  }
}

const emailOf = (formData: FormData) =>
  z.email().safeParse(String(formData.get("email") ?? "").trim());

/**
 * The sign-in form: with a password (the main button), or by emailing a
 * sign-in link (the second button, which needs no password).
 */
export async function signIn(_state: FormState, formData: FormData): Promise<FormState> {
  return formData.get("method") === "link"
    ? requestSignInLink(formData)
    : signInWithPassword(formData);
}

/**
 * Accounts without store or platform access get the same answer as a wrong
 * password, so the form cannot be used to find out who has access.
 */
async function signInWithPassword(formData: FormData): Promise<FormState> {
  const email = emailOf(formData);
  const password = String(formData.get("password") ?? "");
  if (!email.success) return { status: "error", messages: ["Enter a valid email address."] };
  if (!password) return { status: "error", messages: ["Enter your password."] };
  if (!(await canSignIn(email.data))) return { status: "error", messages: [WRONG] };

  const supabase = await supabaseOrNull();
  if (!supabase) return NOT_CONFIGURED;
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.user) {
    return {
      status: "error",
      messages: [
        error?.status === 429
          ? "Too many attempts. Wait a few minutes and try again, or use a sign-in link."
          : error?.code === "invalid_credentials" || error?.status === 400
            ? WRONG
            : "Could not sign in just now. Try again shortly.",
      ],
    };
  }
  if ((await admit(supabase, data.user)) !== "admitted") {
    return { status: "error", messages: ["That account does not have access yet."] };
  }
  redirect("/admin");
}

/**
 * Sends a magic link, but only to accounts with access to a store or the
 * platform. The reply is the same either way.
 */
async function requestSignInLink(formData: FormData): Promise<FormState> {
  const email = emailOf(formData);
  if (!email.success) return { status: "error", messages: ["Enter a valid email address."] };
  if (!(await canSignIn(email.data))) return { status: "ok", messages: [LINK_SENT] };

  const supabase = await supabaseOrNull();
  if (!supabase) return NOT_CONFIGURED;
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: { emailRedirectTo: `${await origin()}/auth/callback`, shouldCreateUser: true },
  });
  if (error) return emailError(error.status);
  return { status: "ok", messages: [LINK_SENT] };
}

/**
 * Emails a link that signs the person in and opens Your account, where they
 * choose a new password. Someone who has never signed in has no Supabase
 * user to reset yet, so they get an ordinary sign-in link to the same page.
 * The reply is the same for every address.
 */
export async function requestPasswordReset(
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const email = emailOf(formData);
  if (!email.success) return { status: "error", messages: ["Enter a valid email address."] };
  const account = await signInAccount(email.data);
  if (!account) return { status: "ok", messages: [RESET_SENT] };

  const supabase = await supabaseOrNull();
  if (!supabase) return NOT_CONFIGURED;
  const redirectTo = `${await origin()}/auth/callback?next=/admin/account`;
  const { error } = account.linked
    ? await supabase.auth.resetPasswordForEmail(email.data, { redirectTo })
    : await supabase.auth.signInWithOtp({
        email: email.data,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
  if (error) return emailError(error.status);
  return { status: "ok", messages: [RESET_SENT] };
}

function emailError(status: number | undefined): FormState {
  return {
    status: "error",
    messages: [
      status === 429
        ? "Too many emails. Wait a minute and try again."
        : "The email could not be sent. Try again shortly.",
    ],
  };
}
