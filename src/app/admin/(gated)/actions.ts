"use server";

import { refresh, updateTag } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import { storeBase } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { seoFromForm } from "@/lib/seo";
import { PAYMENT_MODES, type PaymentModeName } from "@/lib/stripe-account";
import { createClient } from "@/lib/supabase/server";
import { requireMember, type Membership } from "@/server/auth";
import { applyPlanDiscount, cancelPlan, choosePlan, portalUrl, removeWaitingDiscount } from "@/server/billing";
import { createAccountSession, createStripeAccount, refreshStripeAccount } from "@/server/connect";
import { catalogTag } from "@/server/catalog";
import { saveStoreSeo, STORES_TAG } from "@/server/seo";
import { storeTag } from "@/server/stores";
import { parsePrice } from "@/lib/product-input";
import {
  disableStaff,
  saveShippingSettings,
  inviteStaff,
  setStripeProvider,
  type SaveResult,
} from "@/server/settings";

// Every action takes the store's slug as its first (bound) argument and
// re-checks the signed-in account's access to that store.

const mode = z.enum(PAYMENT_MODES as [PaymentModeName, ...PaymentModeName[]]);

async function asOwner(storeSlug: string): Promise<Membership | FormState> {
  const member = await requireMember(storeSlug);
  return member.role === "owner"
    ? member
    : { status: "error", messages: ["Only an owner can change this."] };
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

/** Creates the store's own Stripe account for a mode; onboarding then opens on the page. */
export async function createStripeAccountAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const parsedMode = mode.safeParse(formData.get("mode"));
  if (!parsedMode.success) return { status: "error", messages: ["Unknown mode."] };
  const storeUrl = `${await origin()}${storeBase(owner.store.slug)}`;
  return toState(await createStripeAccount(owner, parsedMode.data, storeUrl));
}

/** A client secret for Stripe's embedded components (onboarding, account details). */
export async function accountSessionAction(
  storeSlug: string,
  modeName: PaymentModeName,
): Promise<{ ok: true; clientSecret: string } | { ok: false; problem: string }> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return { ok: false, problem: owner.messages[0] ?? "Not allowed." };
  const parsedMode = mode.safeParse(modeName);
  if (!parsedMode.success) return { ok: false, problem: "Unknown mode." };
  return createAccountSession(owner.store.id, parsedMode.data);
}

/** After onboarding: reads the account's state from Stripe and shows it. */
export async function refreshStripeAccountAction(storeSlug: string, modeName: PaymentModeName): Promise<void> {
  const member = await requireMember(storeSlug);
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
  if (!("store" in owner)) return owner;
  const parsedMode = mode.safeParse(formData.get("activeMode"));
  if (!parsedMode.success) return { status: "error", messages: ["Unknown mode."] };
  const result = await setStripeProvider(
    owner,
    formData.get("enabled") === "on",
    parsedMode.data,
    formData.get("orderInvoices") === "on",
  );
  // The storefront's "cannot buy yet" notice depends on this switch.
  if (result.ok) updateTag(storeTag(owner.store.slug));
  return toState(result);
}

export async function inviteStaffAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const email = z.email().safeParse(String(formData.get("email") ?? "").trim());
  const role = z.enum(["owner", "admin"]).safeParse(formData.get("role"));
  if (!email.success || !role.success) {
    return { status: "error", messages: ["Enter a valid email and role."] };
  }
  return toState(
    await inviteStaff(owner, email.data, role.data),
    `${email.data} can now sign in at /admin/sign-in.`,
  );
}

export async function disableStaffAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const id = z.uuid().safeParse(formData.get("accountId"));
  if (!id.success) return { status: "error", messages: ["Unknown staff member."] };
  return toState(await disableStaff(owner, id.data), "Access removed.");
}

export async function saveShippingAction(
  storeSlug: string,
  _state: FormState,
  formData: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
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
  const member = await requireMember(storeSlug);
  const locales = [...new Set(member.store.markets.map((market) => market.locale))];
  const result = await saveStoreSeo(member, seoFromForm(formData, locales));
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
  if (!priceId.success) return { status: "error", messages: ["Choose a plan."] };
  const result = await choosePlan(owner.account, owner.store.slug, priceId.data, await origin());
  if (!result.ok) return { status: "error", messages: result.problems };
  if (result.checkoutUrl) redirect(result.checkoutUrl);
  refresh();
  return { status: "ok", messages: ["Plan changed. The difference is settled on your next invoice."] };
}

/** An owner cancels their plan at the end of the period, or keeps it after all. */
export async function ownerCancelPlanAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const when = z.enum(["period_end", "undo"]).safeParse(formData.get("when"));
  if (!when.success) return { status: "error", messages: ["Unknown request."] };
  const result = await cancelPlan(owner.account, owner.store.id, when.data);
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return {
    status: "ok",
    messages: [when.data === "undo" ? "Your plan continues." : "Your plan ends when the current period does."],
  };
}

/** Puts one of Kaizen's discount codes on the store's plan, or saves it for when a plan is chosen (D31). */
export async function applyPlanDiscountAction(storeSlug: string, _state: FormState, formData: FormData): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  const code = String(formData.get("code") ?? "").slice(0, 60);
  if (!code.trim()) return { status: "error", messages: ["Type the discount code."] };
  return toState(await applyPlanDiscount(owner.account, owner.store.id, code));
}

/** Takes off a code saved for a plan not chosen yet. */
export async function removePlanDiscountAction(storeSlug: string): Promise<FormState> {
  const owner = await asOwner(storeSlug);
  if (!("store" in owner)) return owner;
  return toState(await removeWaitingDiscount(owner.account, owner.store.id), "Code removed.");
}
