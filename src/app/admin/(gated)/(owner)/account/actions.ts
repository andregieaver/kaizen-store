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
import { ADMIN_LANG_FACTS, adminLangOf } from "@/lib/admin-lang";
import { isOfferedScheme } from "@/lib/admin-schemes";
import { audit, requireAccount, saveAdminScheme } from "@/server/auth";
import { requestAdminLang } from "@/server/admin-request-lang";
import { removeAccountAvatar, setAccountAvatar } from "@/server/avatars";
import { isOwner, KAIZEN_LIFE_PROVIDER, kaizenLifeIdentity, kaizenLifeSignInOn } from "@/server/kaizen-life";
import { endAccountGrants } from "@/server/oauth";
import { regenerateRecoveryCodes, removeSecondStep, type EnrolFinish, type StepResult } from "@/server/two-step";
import { officerFields, readOfficerChoice } from "@/lib/privacy-officer";
import { ownedAccount, setOfficer } from "@/server/privacy-officers";
import { accountPortalUrl, cancelAccountPlan, chooseAccountPlan, moveUpExtension, setAccountExtension } from "@/server/account-billing";
import { startExtensionTrial } from "@/server/extensions";
import { GRACE_DAYS } from "@/lib/account-billing";
import { fillWords } from "@/lib/admin-fill";
import { isExtensionId } from "@/lib/extensions";
import { BILLING_WORDS } from "@/lib/admin-words/billing";
import { COMMON_WORDS } from "@/lib/admin-words/common";
import { PRIVACY_OFFICER_WORDS } from "@/lib/admin-words/privacy-officer";
import { SCREENS_WORDS } from "@/lib/admin-words/screens";
import { BOOKINGS_WORDS } from "@/lib/admin-words/bookings";
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

/** Keeps the account's colour scheme for the admin (D221); the page has applied it already. */
export async function adminSchemeAction(scheme: unknown): Promise<void> {
  const account = await requireAccount();
  if (isOfferedScheme(scheme) && scheme !== account.adminScheme) await saveAdminScheme(account.id, scheme);
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
  const w = PRIVACY_OFFICER_WORDS[adminLangOf(account.adminLocale)];
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
  return { account, organisationId: owned?.id ?? null, words: BILLING_WORDS[adminLangOf(account.adminLocale)].actions };
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
  return { account, organisationId: owned?.id ?? null, w: SCREENS_WORDS[lang].accountExtensions, common: COMMON_WORDS[lang].extensions };
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

/**
 * Add to your account → Open an online store (D748 E7 part three): the account's owner opens a store at a free address from its name, the
 * Standard store's copy as any owner's new store is; an account with only a workspace gets the plan's free trial with its first store
 * (`createStoreForOwner()`). The store opens on its setup.
 */
export async function openStoreAction(_state: FormState, formData: FormData): Promise<FormState> {
  const account = await requireAccount();
  const name = String(formData.get("name") ?? "").trim();
  const [{ freeSlug }, { createStoreForOwner }] = await Promise.all([import("@/server/self-signup"), import("@/server/platform")]);
  const result = await createStoreForOwner(account, name, name ? await freeSlug(name) : "");
  if (!result.ok) return { status: "error", messages: result.problems };
  redirect(`/admin/${result.slug}/setup`);
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

/**
 * Moves the account's email automation up to its next size (D876, D748 E10 part three): one press from Broadcasts or Account, Extensions
 * when the account has reached what its size holds. Only the account's owner may; Stripe Checkout when the account pays for nothing yet.
 * Its words load when it runs, as the name and email's code does, so the store admin's routes that import this file do not carry them.
 */
export async function moveUpEmailAction(): Promise<FormState> {
  const account = await requireAccount();
  const lang = adminLangOf(account.adminLocale);
  const w = (await import("@/lib/admin-words/send-allowance")).SEND_ALLOWANCE_WORDS[lang];
  const owned = await ownedAccount(account.id);
  if (!owned) return { status: "error", messages: [w.askOwner] };
  const result = await moveUpExtension(account, owned.id, "email_automation", await origin());
  if (!result.ok) return { status: "error", messages: result.problems };
  if ("checkoutUrl" in result && result.checkoutUrl) redirect(result.checkoutUrl);
  refresh();
  const contacts = result.contacts?.toLocaleString(ADMIN_LANG_FACTS[lang].locale);
  return { status: "ok", messages: [contacts ? fillWords(w.movedUp, { contacts }) : w.moveUpAny] };
}

// ---------------------------------------------------------------------------
// Name and email (D836)
// ---------------------------------------------------------------------------

const EMAIL_PAGE = "/admin/account/email";

/**
 * The name and email's server code, loaded when one of these actions runs: every store's admin imports this file for its Basic and
 * Advanced switch (`adminViewAction`), and would otherwise carry it on every route (`route-load.graph.test.ts`).
 */
const emailChange = () => import("@/server/email-change");

/** A refusal of these forms, under the field it is about where it names one. */
const refusedHere = (message: string, field?: "name" | "email"): FormState => ({ status: "error", messages: [message], ...(field ? { fields: { [field]: message } } : {}) });

/** The person's own name, shown wherever their account is named. */
export async function changeNameAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount();
  const w = BOOKINGS_WORDS[adminLangOf(account.adminLocale)].account.profile;
  const result = await (await emailChange()).changeOwnName(account, form.get("name"));
  if (!result.ok) return refusedHere(fillWords(w.problems[result.problem], { n: (await emailChange()).NAME_MAX }), "name");
  refresh();
  return { status: "ok", messages: [w.nameSaved] };
}

/** Asks to move the account to a new address: a link goes to it, a notice to the current one. Needs a fresh sign-in (and its second step). */
export async function requestEmailChangeAction(_state: FormState, form: FormData): Promise<FormState> {
  const account = await requireAccount();
  const w = BOOKINGS_WORDS[adminLangOf(account.adminLocale)].account.email;
  const result = await (await emailChange()).requestEmailChange(account, form.get("email"));
  if (!result.ok) {
    const field = result.problem === "invalid" || result.problem === "same" || result.problem === "taken" ? "email" : undefined;
    return refusedHere(w.problems[result.problem], field);
  }
  refresh();
  return { status: "ok", messages: [fillWords(w.sent, { email: result.email, hours: (await emailChange()).EMAIL_CHANGE_HOURS })] };
}

/** The waiting change's link again: a new one, and the old one stops working. */
export async function resendEmailChangeAction(): Promise<FormState> {
  const account = await requireAccount();
  const w = BOOKINGS_WORDS[adminLangOf(account.adminLocale)].account.email;
  const result = await (await emailChange()).resendEmailChange(account);
  if (!result.ok) return refusedHere(w.problems[result.problem]);
  refresh();
  return { status: "ok", messages: [fillWords(w.resent, { email: result.email })] };
}

/** Cancels the waiting change: its link stops working. */
export async function cancelEmailChangeAction(): Promise<FormState> {
  const account = await requireAccount();
  const w = BOOKINGS_WORDS[adminLangOf(account.adminLocale)].account.email;
  if (!(await (await emailChange()).cancelEmailChange(account.id))) return refusedHere(w.problems.none);
  refresh();
  return { status: "ok", messages: [w.cancelled] };
}

/** Signs the person out and back in, so asking for the change has a sign-in from the last ten minutes. */
export async function signInForEmailAction(): Promise<void> {
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect(`/admin/sign-in?next=${encodeURIComponent(EMAIL_PAGE)}`);
  }
}

/**
 * The button on the page the link opens (`/admin/account/email/confirm`): nobody needs to be signed in (the link may be opened on another
 * device), and nobody is signed in by it. The token comes with the form; `confirmEmailChange()` decides everything. Done, the page is
 * drawn again for the used link, which says the address is changed; refused, the reason in the person's language.
 */
export async function confirmEmailChangeAction(form: FormData): Promise<FormState> {
  const token = String(form.get("token") ?? "");
  const result = await (await emailChange()).confirmEmailChange(token);
  if (result.ok) redirect(`${EMAIL_PAGE}/confirm?token=${encodeURIComponent(token)}&done=1`);
  const w = BOOKINGS_WORDS[result.lang ?? (await requestAdminLang())].account.confirmEmail;
  return refusedHere(w[result.problem]);
}
