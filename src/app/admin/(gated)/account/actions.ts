"use server";

import { refresh } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import type { AvatarPickerState } from "@/components/avatar-picker";
import { passwordProblem } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import { isColorChoice } from "@/lib/color-mode";
import { audit, requireAccount, saveColorMode } from "@/server/auth";
import { removeAccountAvatar, setAccountAvatar } from "@/server/avatars";
import { isOwner, KAIZEN_LIFE_PROVIDER, kaizenLifeIdentity, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { LINK_COOKIE, linkStart, unlinkLife } from "@/server/kaizen-life-link";

async function origin(): Promise<string> {
  const header = (await headers()).get("origin");
  return header ? new URL(header).origin : siteUrl();
}

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

const AVATAR_PROBLEMS = {
  off: "Uploads are not set up on this server.",
  invalid: "Use a JPEG, PNG, WebP or AVIF picture.",
  failed: "The picture could not be uploaded. Try again.",
} as const;

/** Sets (`picture`) or takes away (`remove`) the signed-in account's profile picture (D97). */
export async function accountAvatarAction(form: FormData): Promise<AvatarPickerState> {
  const account = await requireAccount();
  if (form.get("remove") === "1") {
    await removeAccountAvatar(account.id);
    await audit(account.id, null, "account.avatar_removed");
    refresh();
    return { ok: true, message: "Picture removed." };
  }
  const picture = form.get("picture");
  if (!(picture instanceof File)) return { ok: false, message: AVATAR_PROBLEMS.invalid };
  const outcome = await setAccountAvatar(account.id, picture);
  if (!outcome.ok) return { ok: false, message: AVATAR_PROBLEMS[outcome.reason] };
  await audit(account.id, null, "account.avatar_set");
  refresh();
  return { ok: true, message: "Picture saved." };
}

/** Keeps the account's light or dark for the admin (D99); the page has applied it already. */
export async function colorModeAction(choice: unknown): Promise<void> {
  const account = await requireAccount();
  if (isColorChoice(choice) && choice !== account.colorMode) await saveColorMode(account.id, choice);
}

/** Connects the account's Kaizen Life account (D95): off to Kaizen Life, back to Your account. Owners only. */
export async function connectKaizenLifeAction(): Promise<void> {
  const account = await requireAccount();
  if (!kaizenLifeSignInOn() || !(await isOwner(account))) redirect("/admin/account");
  const supabase = await createClient();
  const { data, error } = await supabase.auth.linkIdentity({
    provider: KAIZEN_LIFE_PROVIDER,
    options: {
      redirectTo: `${await origin()}/auth/callback?next=${encodeURIComponent("/admin/account?kaizen-life=connected")}`,
      scopes: "openid email profile",
      skipBrowserRedirect: true,
    },
  });
  if (error || !data?.url) redirect("/admin/account?kaizen-life=failed");
  redirect(data.url);
}

/** Disconnects Kaizen Life: it no longer signs this account in. */
export async function disconnectKaizenLifeAction(): Promise<void> {
  const account = await requireAccount();
  const supabase = await createClient();
  const identity = await kaizenLifeIdentity(supabase);
  if (identity) {
    const { error } = await supabase.auth.unlinkIdentity(identity);
    if (error) redirect("/admin/account?kaizen-life=failed");
    await audit(account.id, null, "account.kaizen_life_disconnected");
  }
  redirect("/admin/account");
}

/** Takes back an app's permission to sign in with this Kaizen Store account (D95). */
export async function revokeAppAction(formData: FormData): Promise<void> {
  const account = await requireAccount();
  const clientId = String(formData.get("client") ?? "");
  if (/^[A-Za-z0-9_-]{8,100}$/.test(clientId)) {
    await (await createClient()).auth.oauth.revokeGrant({ clientId });
    await audit(account.id, null, "account.oauth_revoked", { clientId });
  }
  redirect("/admin/account");
}

/** Connects Kaizen Life for the assistant (D96): off to Kaizen Life's consent, back to the callback. Owners only. */
export async function connectLifeAssistantAction(): Promise<void> {
  const account = await requireAccount();
  const start = (await isOwner(account)) ? linkStart(account.id) : null;
  if (!start) redirect("/admin/account");
  (await cookies()).set(LINK_COOKIE, start.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/admin/account/kaizen-life",
    maxAge: 600,
  });
  redirect(start.url);
}

/** Forgets Kaizen Life for the assistant. */
export async function disconnectLifeAssistantAction(): Promise<void> {
  const account = await requireAccount();
  if (await unlinkLife(account.id)) await audit(account.id, null, "account.kaizen_life_assistant_disconnected");
  redirect("/admin/account");
}
