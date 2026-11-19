"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import type { AvatarPickerState } from "@/components/avatar-picker";
import { passwordProblem } from "@/lib/password";
import { createClient } from "@/lib/supabase/server";
import { siteUrl } from "@/lib/site";
import { adminLangOf, isAdminLang } from "@/lib/admin-lang";
import { isOfferedScheme } from "@/lib/admin-schemes";
import { isAdminView } from "@/lib/admin-view";
import { isColorChoice } from "@/lib/color-mode";
import { audit, requireAccount, saveAdminLang, saveAdminScheme, saveAdminView, saveColorMode } from "@/server/auth";
import { removeAccountAvatar, setAccountAvatar } from "@/server/avatars";
import { isOwner, KAIZEN_LIFE_PROVIDER, kaizenLifeIdentity, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { endAccountGrants } from "@/server/oauth";
import { regenerateRecoveryCodes, removeSecondStep, type EnrolFinish, type StepResult } from "@/server/two-step";
import { adminText } from "@/lib/admin-text";
import { officerFields, readOfficerChoice } from "@/lib/privacy-officer";
import { ownedAccount, setOfficer } from "@/server/privacy-officers";
import { accountPortalUrl, cancelAccountPlan, chooseAccountPlan, setAccountExtension } from "@/server/account-billing";
import { startExtensionTrial } from "@/server/extensions";
import { GRACE_DAYS } from "@/lib/account-billing";
import { fillWords } from "@/lib/admin-fill";
import { isExtensionId } from "@/lib/extensions";
import { NO_COUNTRY } from "@/server/billing";

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
              : "The password could not be saved. Try again in a moment.";
    return { status: "error", messages: [message] };
  }
  await audit(account.id, null, "account.password_set");
  // A new password asks again what apps and AI assistants may do: every connection ends (D439 review).
  await endAccountGrants(account.id, "password");
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

/** Keeps the account's colour scheme for the admin (D221); the page has applied it already. */
export async function adminSchemeAction(scheme: unknown): Promise<void> {
  const account = await requireAccount();
  if (isOfferedScheme(scheme) && scheme !== account.adminScheme) await saveAdminScheme(account.id, scheme);
}

/**
 * Keeps how much of a store's admin the account is shown (D454); the page has switched already. A store's admin and Your account both
 * call it; nothing is drawn again, as the navigation follows the choice in the browser.
 */
export async function adminViewAction(view: unknown): Promise<void> {
  const account = await requireAccount();
  if (isAdminView(view) && view !== account.adminView) await saveAdminView(account.id, view);
}

/** Keeps the account's language for the admin (D312 A0); the admin is drawn again in it. */
export async function adminLangAction(lang: unknown): Promise<void> {
  const account = await requireAccount();
  if (isAdminLang(lang)) await saveAdminLang(account.id, lang);
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

/** New recovery codes (wave 1, 1f), shown once: the old set stops working. Needs a session that has passed its second step. */
export async function regenerateRecoveryCodesAction(): Promise<EnrolFinish> {
  const account = await requireAccount();
  return regenerateRecoveryCodes(account);
}

/** Switches the signed-in account's two-step sign-in off, with an email to say so. Needs a session that has passed its second step. */
export async function removeTwoStepAction(): Promise<StepResult> {
  const account = await requireAccount();
  // A platform admin must use it: switching it off would only hold them at set-up at once.
  if (account.platformAdmin) return { ok: false, problem: "Platform admins must use two-step sign-in." };
  return removeSecondStep(account);
}

/** The data protection officer for all the account's stores (D763): its owner's alone. */
export async function setAccountOfficerAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount();
  const w = adminText(adminLangOf(account.adminLocale), "privacyOfficer");
  const owned = await ownedAccount(account.id);
  if (!owned) return { status: "error", messages: [w.notOwner] };
  const read = readOfficerChoice(officerFields(form), { store: false });
  if (!read.ok) return { status: "error", messages: read.problems };
  const result = await setOfficer(account.id, owned.id, null, read.choice);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [w.saved] };
}

/** The account the signed-in person owns: the account Billing page's plan actions (D748 E4) act on it alone, and only its owner reaches them. */
async function ownAccount() {
  const account = await requireAccount();
  const owned = await ownedAccount(account.id);
  return { account, organisationId: owned?.id ?? null, words: adminText(adminLangOf(account.adminLocale), "billing").actions };
}

/** The owner chooses the account's plan: the first time through Stripe Checkout, later at once; the extensions it pays for come along. */
export async function chooseAccountPlanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { account, organisationId, words } = await ownAccount();
  if (!organisationId) return { status: "error", messages: [words.ownerOnly] };
  const priceId = z.uuid().safeParse(formData.get("priceId"));
  if (!priceId.success) return { status: "error", messages: [words.choosePlan] };
  const result = await chooseAccountPlan(account, organisationId, { planPriceId: priceId.data, extensionPriceIds: "kept" }, await origin());
  // Without a country no plan is chosen (it decides the VAT): said in the owner's language.
  if (!result.ok) return { status: "error", messages: result.problems.map((p) => (p === NO_COUNTRY ? words.noCountry : p)) };
  if (result.checkoutUrl) redirect(result.checkoutUrl);
  refresh();
  return { status: "ok", messages: [words.changed] };
}

/** The owner ends the account's plan at the end of its period, or keeps it after all. */
export async function cancelAccountPlanAction(_state: FormState, formData: FormData): Promise<FormState> {
  const { account, organisationId, words } = await ownAccount();
  if (!organisationId) return { status: "error", messages: [words.ownerOnly] };
  const when = z.enum(["period_end", "undo"]).safeParse(formData.get("when"));
  if (!when.success) return { status: "error", messages: [words.unknown] };
  const result = await cancelAccountPlan(account, organisationId, when.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: [when.data === "undo" ? words.continues : words.ends] };
}

/** Sends the owner to Stripe's page for the account's invoices and how it pays. */
export async function accountPortalAction(): Promise<FormState> {
  const { organisationId, words } = await ownAccount();
  if (!organisationId) return { status: "error", messages: [words.ownerOnly] };
  const result = await accountPortalUrl(organisationId, `${await origin()}/admin/account/billing`);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  redirect(result.url);
}

/** The owner's own account, for Account → Extensions (D748 E5); null for someone who owns none. */
async function extensionsAccount() {
  const account = await requireAccount();
  const owned = await ownedAccount(account.id);
  const lang = adminLangOf(account.adminLocale);
  return { account, organisationId: owned?.id ?? null, w: adminText(lang, "screens").accountExtensions, common: adminText(lang, "common").extensions };
}

/** Starts an extension's 14-day trial for the owner's account. */
export async function tryExtensionAction(extension: string): Promise<FormState> {
  const { account, organisationId, w, common } = await extensionsAccount();
  if (!organisationId || !isExtensionId(extension)) return { status: "error", messages: [w.ownerOnly] };
  const result = await startExtensionTrial(account, organisationId, extension);
  if (!result.ok) return { status: "error", messages: [common.refusals[result.refusal]] };
  refresh();
  return { status: "ok", messages: [common.trialStarted] };
}

/** Adds an extension to the account's subscription (Stripe Checkout when the account pays for nothing yet), or ends one bought on its own. */
export async function setExtensionAction(extension: string, on: boolean): Promise<FormState> {
  const { account, organisationId, w } = await extensionsAccount();
  if (!organisationId || !isExtensionId(extension)) return { status: "error", messages: [w.ownerOnly] };
  const result = await setAccountExtension(account, organisationId, extension, on, await origin());
  if (!result.ok) return { status: "error", messages: result.problems };
  if ("checkoutUrl" in result && result.checkoutUrl) redirect(result.checkoutUrl);
  refresh();
  return { status: "ok", messages: [on ? w.added : fillWords(w.ended, { days: GRACE_DAYS })] };
}
