"use server";

import { refresh, updateTag } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { storeBase, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { seoFromForm } from "@/lib/seo";
import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { createClient } from "@/lib/supabase/server";
import type { Membership } from "@/server/auth";
import { adminLangOf } from "@/lib/admin-lang";
import { applyPlanDiscount, cancelPlan, choosePlan, portalUrl, removeWaitingDiscount } from "@/server/billing";
import { createAccountSession, createStripeAccount, refreshStripeAccount } from "@/server/connect";
import { setPlanRemindersOptOut } from "@/server/plan-reminders";
import { checkOwnerRole, checkPermission, NO_ACCESS, requireOwnerRole } from "@/server/permissions";
import { catalogTag } from "@/server/catalog";
import { saveStoreSeo, STORES_TAG } from "@/server/seo";
import { storeTag } from "@/server/stores";
import { parsePrice } from "@/lib/product-input";
import { saveMethodChoices } from "@/server/payment-methods";
import { checkWalletDomains } from "@/server/express-checkout";
import { MOLLIE_COOKIE, MOLLIE_COOKIE_PATH } from "@/lib/mollie";
import { activateMollieMethod, chooseCheckoutProvider, disconnectMollie, mollieStart } from "@/server/mollie";
import { saveShippingSettings, setStripeProvider, type SaveResult } from "@/server/settings";
import { paymentsEn } from "@/lib/admin-messages/payments.en";
import { adminText } from "@/lib/admin-text";
import { knownText } from "@/lib/known-words";
import { actionAdminLang } from "@/server/admin-request-lang";

// Every action takes the store's slug as its first (bound) argument and
// re-checks the signed-in account's access to that store.

const mode = z.enum(PAYMENT_MODES as [PaymentModeName, ...PaymentModeName[]]);

async function asOwner(storeSlug: string): Promise<Membership | FormState> {
  const member = await checkOwnerRole(storeSlug);
  return member ?? { status: "error", messages: ["Only an owner can change this."] };
}

function toState(result: SaveResult, success?: string): FormState {
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  const message = result.note ?? success;
  return { status: "ok", messages: message ? [message] : [] };
}

async function origin(): Promise<string> {
  const header = (await headers()).get("origin");
  return header ? new URL(header).origin : siteUrl();
}

/**
 * A payments action's answer in the account's language (D312 A8): the words given by key, and the server's English refusals said through
 * the catalogue (`knownText()`); anything it does not know stays as written.
 */
async function inPayments(state: FormState): Promise<FormState> {
  const w = adminText(await actionAdminLang(), "payments");
  return { ...state, messages: state.messages?.map((m) => knownText(m, paymentsEn.problems, w.problems)) };
}

async function paymentsWord(pick: (w: typeof paymentsEn.actions) => string): Promise<string> {
  return pick(adminText(await actionAdminLang(), "payments").actions);
}

/** Creates the store's own Stripe account for a mode; onboarding then opens on the page. */
export async function createStripeAccountAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  const parsedMode = mode.safeParse(formData.get("mode"));
  if (!parsedMode.success) return inPayments({ status: "error", messages: ["Unknown mode."] });
  const storeUrl = storeOrigin(owner.store.slug) ?? `${await origin()}${storeBase(owner.store.slug)}`;
  return inPayments(toState(await createStripeAccount(owner, parsedMode.data, storeUrl)));
}

/** A client secret for Stripe's embedded components (onboarding, account details). */
export async function accountSessionAction(
  storeSlug: string,
  modeName: PaymentModeName,
): Promise<{ ok: true; clientSecret: string } | { ok: false; problem: string }> {
  const owner = await asOwner(storeSlug);
  const said = async (problem: string) => ({ ok: false as const, problem: (await inPayments({ status: "error", messages: [problem] })).messages?.[0] ?? problem });
  if (!("store" in owner)) return said(owner.messages?.[0] ?? "Not allowed.");
  const parsedMode = mode.safeParse(modeName);
  if (!parsedMode.success) return said("Unknown mode.");
  const session = await createAccountSession(owner.store.id, parsedMode.data);
  return session.ok ? session : said(session.problem);
}

/** After onboarding: reads the account's state from Stripe and shows it. */
export async function refreshStripeAccountAction(storeSlug: string, modeName: PaymentModeName): Promise<void> {
  const member = await requireOwnerRole(storeSlug);
  const parsedMode = mode.safeParse(modeName);
  if (!parsedMode.success) return;
  if (await refreshStripeAccount(member.store.id, parsedMode.data)) {
    // Whether the storefront can take payments may have changed.
    updateTag(storeTag(member.store.slug));
  }
  refresh();
}

export async function setStripeProviderAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  const parsedMode = mode.safeParse(formData.get("activeMode"));
  if (!parsedMode.success) return inPayments({ status: "error", messages: ["Unknown mode."] });
  const result = await setStripeProvider(
    owner,
    formData.get("enabled") === "on",
    parsedMode.data,
    formData.get("orderInvoices") === "on",
  );
  // The storefront's "cannot buy yet" notice depends on this switch.
  if (result.ok) updateTag(storeTag(owner.store.slug));
  return inPayments(toState(result));
}

/**
 * Which payment methods each country's checkout offers (D291): the boxes ticked are on, the rest of the store's countries' switchable methods off.
 * Owners only, as the rest of the Payments page.
 */
export async function savePaymentMethodsAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  const markets = formData.getAll("market").map(String);
  const on = new Set(formData.getAll("on").map(String));
  const { changed } = await saveMethodChoices(owner.store.id, owner.account.id, { markets, on });
  return toState({ ok: true }, await paymentsWord((w) => (changed === 0 ? w.nothingChanged : w.methodsSaved)));
}

/**
 * *Check again* on the wallets card (D373): every address the store's shoppers pay on is registered on its Stripe account in the mode it takes
 * payments in, and Stripe's record of each is read back. Owners only, as the rest of the Payments page's changes.
 */
export async function checkWalletsAction(storeSlug: string, mode: PaymentModeName, _state: FormState, _form: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  if (!PAYMENT_MODES.includes(mode)) return inPayments({ status: "error", messages: [] });
  const done = await checkWalletDomains(owner.store.id, owner.store.slug, mode, owner.account.id);
  refresh();
  return done.ok
    ? toState({ ok: true }, await paymentsWord((w) => w.walletsChecked))
    : inPayments({ status: "error", messages: [await paymentsWord((w) => (done.problem === "no_account" ? w.walletsNoAccount : w.walletsFailed))] });
}

/** "Connect Mollie" (D292): off to Mollie to approve Kaizena Flow, back to `/api/integrations/mollie/callback`. Owners only. */
export async function connectMollieAction(storeSlug: string): Promise<void> {
  const owner = await asOwner(storeSlug);
  const start = "store" in owner ? mollieStart(owner.store.slug, owner.account.id) : null;
  if (!start) redirect(`/admin/${storeSlug}/settings/payments`);
  (await cookies()).set(MOLLIE_COOKIE, start.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: MOLLIE_COOKIE_PATH,
    maxAge: 600,
  });
  redirect(start.url);
}

/** Which provider each mode's checkout uses (D292): Stripe, or Mollie once it is connected. Owners only. */
export async function saveCheckoutProviderAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  for (const mode of ["test", "live"] as const) {
    const chosen = formData.get(`provider:${mode}`);
    if (chosen !== "stripe" && chosen !== "mollie") continue;
    const saved = await chooseCheckoutProvider(owner.store.id, owner.account.id, mode, chosen);
    if (!saved.ok) return inPayments({ status: "error", messages: [saved.problem] });
  }
  return toState({ ok: true }, await paymentsWord((w) => w.providerSaved));
}

/** Ends the Mollie connection; checkouts go back to Stripe (D292). Owners only. */
export async function disconnectMollieAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  await disconnectMollie(owner.store.id, owner.account.id);
  return toState({ ok: true }, await paymentsWord((w) => w.disconnected));
}

/** Asks Mollie to switch a method on for the store's profile (D292). Owners only. */
export async function activateMollieMethodAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return inPayments(owner);
  const done = await activateMollieMethod(owner.store.id, owner.account.id, String(formData.get("method") ?? ""));
  return done.ok ? toState({ ok: true }, await paymentsWord((w) => w.asked)) : inPayments({ status: "error", messages: [done.problem] });
}

export async function saveShippingAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const rates: { marketCode: string; amountMinor: number; freeOverMinor: number | null }[] = [];
  const problems: string[] = [];
  for (const market of member.store.markets) {
    const amountText = String(formData.get(`amount:${market.code}`) ?? "").trim();
    const freeText = String(formData.get(`free:${market.code}`) ?? "").trim();
    if (!amountText) continue;
    const amount = parsePrice(amountText, market.currency);
    const free = freeText ? parsePrice(freeText, market.currency) : null;
    if (amount === null) problems.push(`${market.name}: "${amountText}" is not an amount in ${market.currency}.`);
    else if (freeText && (free === null || free <= 0)) {
      problems.push(`${market.name}: "${freeText}" is not an amount in ${market.currency}.`);
    } else rates.push({ marketCode: market.code, amountMinor: amount, freeOverMinor: free });
  }
  if (problems.length > 0) return { status: "error", messages: problems };
  const result = await saveShippingSettings(member, rates);
  // Product pages' structured data and llms.txt show the shipping price.
  if (result.ok) updateTag(catalogTag(member.store.id));
  return toState(result, "Shipping saved.");
}

/** The store's search and sharing settings (D21). */
export async function saveStoreSeoAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await checkPermission(storeSlug, "settings:write");
  if (!member) return { status: "error", messages: [NO_ACCESS] };
  const { locales, keptLocales } = member.store.localization;
  // The texts of a language the page does not show (Several languages or countries off, D178) are kept as they are.
  const { seo } = member.store;
  for (const locale of keptLocales.filter((l) => !locales.includes(l))) {
    formData.set(`title:${locale}`, seo.title[locale] ?? "");
    formData.set(`description:${locale}`, seo.description[locale] ?? "");
    formData.set(`imageAlt:${locale}`, seo.image?.alt[locale] ?? "");
  }
  const result = await saveStoreSeo(member, seoFromForm(formData, keptLocales));
  if (result.ok) {
    updateTag(storeTag(member.store.slug));
    updateTag(STORES_TAG);
  }
  return toState(result);
}

export async function signOut(): Promise<void> {
  try {
    await (await createClient()).auth.signOut();
  } finally {
    redirect("/admin/sign-in");
  }
}

/** The billing page's answers in the owner's words (D312 A8). */
const billingWords = (owner: Membership) => adminText(adminLangOf(owner.account.adminLocale), "billing").actions;

/** Sends an owner to Stripe's billing page for Kaizen's invoices to their store. */
export async function openBillingPortalAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const result = await portalUrl(owner.store.id, `${await origin()}/admin/${owner.store.slug}/billing`);
  if (!result.ok) return { status: "error", messages: [result.problem] };
  redirect(result.url);
}

/** An owner chooses a plan: first time through Stripe Checkout, later as an instant change. */
export async function choosePlanAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const priceId = z.uuid().safeParse(formData.get("priceId"));
  if (!priceId.success) return { status: "error", messages: [billingWords(owner).choosePlan] };
  const result = await choosePlan(owner.account, owner.store.slug, priceId.data, await origin());
  if (!result.ok) return { status: "error", messages: result.problems };
  if (result.checkoutUrl) redirect(result.checkoutUrl);
  refresh();
  return { status: "ok", messages: [billingWords(owner).changed] };
}

/** An owner cancels their plan at the end of the period, or keeps it after all. */
export async function ownerCancelPlanAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const when = z.enum(["period_end", "undo"]).safeParse(formData.get("when"));
  if (!when.success) return { status: "error", messages: [billingWords(owner).unknown] };
  const result = await cancelPlan(owner.account, owner.store.id, when.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [when.data === "undo" ? billingWords(owner).continues : billingWords(owner).ends],
  };
}

/** Puts one of Kaizen's discount codes on the store's plan, or saves it for when a plan is chosen (D31). */
export async function applyPlanDiscountAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const code = String(formData.get("code") ?? "").slice(0, 60);
  if (!code.trim()) return { status: "error", messages: [billingWords(owner).typeCode] };
  return toState(await applyPlanDiscount(owner.account, owner.store.id, code));
}

/** Takes off a code saved for a plan not chosen yet. */
export async function removePlanDiscountAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  return toState(await removeWaitingDiscount(owner.account, owner.store.id), billingWords(owner).removed);
}

/** The Plan page's link: no reminders from Kaizen about plans left unpaid, or reminders after all (D33). */
export async function planRemindersOptOutAction(storeSlug: string, optOut: boolean): Promise<void> {
  const member = await requireOwnerRole(storeSlug);
  await setPlanRemindersOptOut(member.account.id, optOut);
  refresh();
}
