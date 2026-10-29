"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { siteUrl } from "@/lib/site";
import { createClient } from "@/lib/supabase/server";
import { adminText } from "@/lib/admin-text";
import { safeNext } from "@/lib/password";
import { afterFirstStep } from "@/lib/sign-in-redirect";
import { canSignIn, signInAccount } from "@/server/auth";
import { KAIZEN_LIFE_PROVIDER, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { requestAdminLang } from "@/server/admin-request-lang";
import { admit } from "@/server/sign-in";
import { log } from "@/server/log";
import { clearSignIns, countFailedSignIn, signInLocked } from "@/server/sign-in-limit";

/** The forms' answers in the request's language (D312 A1), never the typed email's account's: the same words whatever the email. */
async function answers() {
  return adminText(await requestAdminLang(), "signIn").answers;
}

const fail = (message: string): FormState => ({ status: "error", messages: [message] });

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
  const w = await answers();
  const email = emailOf(formData);
  const password = String(formData.get("password") ?? "");
  if (!email.success) return fail(w.invalidEmail);
  if (!password) return fail(w.noPassword);
  // The admin's own limit per email (PSI SEC-02): every address is counted alike, so the answer never says which have access.
  if (await signInLocked(email.data)) {
    log("warn", "admin_sign_in.locked", { via: "password" });
    return fail(w.tooManyAttempts);
  }
  if (!(await canSignIn(email.data))) {
    await countFailedSignIn(email.data);
    return fail(w.wrong);
  }

  const supabase = await supabaseOrNull();
  if (!supabase) return fail(w.notConfigured);
  const { data, error } = await supabase.auth.signInWithPassword({ email: email.data, password });
  if (error || !data.user) {
    const wrong = error?.code === "invalid_credentials" || error?.status === 400;
    if (wrong) await countFailedSignIn(email.data);
    return fail(error?.status === 429 ? w.tooManyAttempts : wrong ? w.wrong : w.couldNotSignIn);
  }
  await clearSignIns(email.data);
  if ((await admit(supabase, data.user)) !== "admitted") {
    return fail(adminText(await requestAdminLang(), "signIn").signIn.noAccess);
  }
  // A person with a second step goes to it first; the gate holds them there whichever way they arrive.
  redirect(afterFirstStep(data.user, String(formData.get("next") ?? "")));
}

/**
 * Signing in with Kaizen Life (D95): off to Kaizen Life's sign-in and
 * consent, back through /auth/callback, which admits store owners only.
 */
export async function signInWithKaizenLife(formData: FormData): Promise<void> {
  if (!kaizenLifeSignInOn()) redirect("/admin/sign-in");
  const supabase = await supabaseOrNull();
  if (!supabase) redirect("/admin/sign-in");
  const next = safeNext(String(formData.get("next") ?? ""));
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: KAIZEN_LIFE_PROVIDER,
    options: {
      redirectTo: `${await origin()}/auth/callback?via=kaizen-life&next=${encodeURIComponent(next)}`,
      scopes: "openid email profile",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) redirect("/admin/sign-in?error=kaizen-life");
  redirect(data.url);
}

/**
 * Sends a magic link, but only to accounts with access to a store or the
 * platform. The reply is the same either way.
 */
async function requestSignInLink(formData: FormData): Promise<FormState> {
  const w = await answers();
  const email = emailOf(formData);
  if (!email.success) return fail(w.invalidEmail);
  if (!(await canSignIn(email.data))) return { status: "ok", messages: [w.linkSent] };

  const supabase = await supabaseOrNull();
  if (!supabase) return fail(w.notConfigured);
  const { error } = await supabase.auth.signInWithOtp({
    email: email.data,
    options: {
      emailRedirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent(safeNext(String(formData.get("next") ?? "")))}`,
      shouldCreateUser: true,
    },
  });
  if (error) return emailError(error.status, w);
  return { status: "ok", messages: [w.linkSent] };
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
  const w = await answers();
  const email = emailOf(formData);
  if (!email.success) return fail(w.invalidEmail);
  const account = await signInAccount(email.data);
  if (!account) return { status: "ok", messages: [w.resetSent] };

  const supabase = await supabaseOrNull();
  if (!supabase) return fail(w.notConfigured);
  const redirectTo = `${await origin()}/auth/callback?next=/admin/account`;
  const { error } = account.linked
    ? await supabase.auth.resetPasswordForEmail(email.data, { redirectTo })
    : await supabase.auth.signInWithOtp({
        email: email.data,
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
  if (error) return emailError(error.status, w);
  return { status: "ok", messages: [w.resetSent] };
}

function emailError(status: number | undefined, w: Awaited<ReturnType<typeof answers>>): FormState {
  return fail(status === 429 ? w.tooManyEmails : w.emailFailed);
}
