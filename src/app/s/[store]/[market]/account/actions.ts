"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { z } from "zod";

import { t } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import { marketPath } from "@/lib/paths";
import { readCartId } from "@/server/cart";
import { getOpenCheckout } from "@/server/checkout";
import {
  createSignInCode,
  deleteCustomer,
  endSession,
  getCustomer,
  registerCustomer,
  resetPassword,
  saveCheckoutAccount,
  setPassword,
  signInWithPassword,
  startSession,
  takeCheckoutSignIn,
  updateCustomerDetails,
  verifySignInCode,
} from "@/server/customers";
import { getShopperOrder } from "@/server/orders";
import { sendPasswordResetCode, sendSignInCode, sendWelcome } from "@/server/shopper-emails";
import { resolveShop } from "@/server/shop";

export type SignInState = {
  step: "email" | "code" | "password";
  email: string;
  message: string | null;
  error: boolean;
};

export type AccountFormState = { ok: boolean; message: string | null };

export type RegisterState = {
  email: string;
  name: string;
  message: string | null;
  /** The email already has an account, or paid orders: the shopper resets the password instead. */
  known: "account" | "purchases" | null;
};

export type ResetState = { step: "email" | "code"; email: string; message: string | null; error: boolean };

const email = z.email().max(254);

/** Emails a sign-in code. Says the same whatever the address, so it reveals no accounts. */
export async function requestCodeAction(
  storeSlug: string,
  marketSlug: string,
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const m = t(shop?.market.lang ?? "en").account;
  const address = email.safeParse(String(form.get("email") ?? "").trim());
  if (!shop || !address.success) return { step: "email", email: "", message: null, error: true };
  const code = await createSignInCode(shop.store.id, address.data);
  if (!code) return { step: "email", email: address.data, message: m.tooManyCodes, error: true };
  await sendSignInCode(shop.store.id, shop.market.code, shop.market.locale, address.data, code);
  return { step: "code", email: address.data, message: m.codeSent(address.data), error: false };
}

export async function verifyCodeAction(
  storeSlug: string,
  marketSlug: string,
  previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { ...previous, error: true, message: null };
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const customerId = code.length === 6 ? await verifySignInCode(shop.store.id, previous.email, code) : null;
  if (!customerId) return { ...previous, error: true, message: t(shop.market.lang).account.wrongCode };
  await startSession(shop.store.id, customerId);
  redirect(marketPath(shop.store.slug, shop.market.slug, "/account"));
}

export async function passwordSignInAction(
  storeSlug: string,
  marketSlug: string,
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const address = String(form.get("email") ?? "").trim();
  if (!shop) return { step: "password", email: address, message: null, error: true };
  const m = t(shop.market.lang).account;
  const outcome = await signInWithPassword(shop.store.id, address, String(form.get("password") ?? ""));
  if (!outcome.ok) {
    return { step: "password", email: address, message: outcome.locked ? m.locked : m.wrongPassword, error: true };
  }
  await startSession(shop.store.id, outcome.customerId);
  redirect(marketPath(shop.store.slug, shop.market.slug, "/account"));
}

export async function signOutAction(storeSlug: string, marketSlug: string): Promise<void> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (shop) await endSession(shop.store.id);
  redirect(marketPath(storeSlug, marketSlug, "/account"));
}

async function signedIn(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  const customer = shop ? await getCustomer(shop.store.id) : null;
  return shop && customer ? { shop, customer, m: t(shop.market.lang).account } : null;
}

export async function saveDetailsAction(
  storeSlug: string,
  marketSlug: string,
  _previous: AccountFormState,
  form: FormData,
): Promise<AccountFormState> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found) return { ok: false, message: null };
  const field = (name: string, max = 200) => String(form.get(name) ?? "").trim().slice(0, max);
  await updateCustomerDetails(found.shop.store.id, found.customer.id, {
    name: field("name"),
    phone: field("phone", 40),
    address: {
      name: field("name"),
      line1: field("line1"),
      line2: field("line2") || null,
      postalCode: field("postalCode", 20),
      city: field("city", 100),
      country: found.shop.market.code,
    },
  });
  refresh();
  return { ok: true, message: found.m.saved };
}

export async function setPasswordAction(
  storeSlug: string,
  marketSlug: string,
  _previous: AccountFormState,
  form: FormData,
): Promise<AccountFormState> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found) return { ok: false, message: null };
  if (form.get("remove") === "1") {
    await setPassword(found.shop.store.id, found.customer.id, null);
    refresh();
    return { ok: true, message: found.m.saved };
  }
  const password = String(form.get("password") ?? "");
  if (passwordProblem(password, found.customer.email)) return { ok: false, message: found.m.passwordRule };
  await setPassword(found.shop.store.id, found.customer.id, password);
  refresh();
  return { ok: true, message: found.m.saved };
}

export async function deleteAccountAction(storeSlug: string, marketSlug: string): Promise<void> {
  const found = await signedIn(storeSlug, marketSlug);
  if (found) {
    await deleteCustomer(found.shop.store.id, found.customer.id);
    await endSession(found.shop.store.id);
  }
  redirect(marketPath(storeSlug, marketSlug, "/account"));
}

/**
 * Opens an account with a password (D32) and signs the shopper in. An
 * email with an account or earlier purchases is sent to reset the
 * password instead, which proves the inbox is theirs before any order
 * shows.
 */
export async function registerAction(
  storeSlug: string,
  marketSlug: string,
  _previous: RegisterState,
  form: FormData,
): Promise<RegisterState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const name = String(form.get("name") ?? "").trim().slice(0, 200);
  const typed = String(form.get("email") ?? "").trim();
  const state = { email: typed, name, message: null, known: null } satisfies RegisterState;
  if (!shop) return state;
  const m = t(shop.market.lang).account;
  const address = email.safeParse(typed);
  if (!address.success) return { ...state, message: m.invalidEmail };
  const password = String(form.get("password") ?? "");
  if (passwordProblem(password, address.data)) return { ...state, message: m.passwordRule };
  const outcome = await registerCustomer(shop.store.id, { email: address.data, name, password });
  if (!outcome.ok) {
    return { ...state, known: outcome.known, message: outcome.known === "account" ? m.knownAccount : m.knownPurchases };
  }
  await startSession(shop.store.id, outcome.customerId);
  // After the response, so signing up does not wait for the email service.
  after(() => sendWelcome(shop.store.id, outcome.customerId, { marketCode: shop.market.code, locale: shop.market.locale }));
  redirect(marketPath(shop.store.slug, shop.market.slug, "/account"));
}

/** Emails a code for a new password. Says the same whatever the address. */
export async function requestResetAction(
  storeSlug: string,
  marketSlug: string,
  _previous: ResetState,
  form: FormData,
): Promise<ResetState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  const typed = String(form.get("email") ?? "").trim();
  if (!shop) return { step: "email", email: typed, message: null, error: true };
  const m = t(shop.market.lang).account;
  const address = email.safeParse(typed);
  if (!address.success) return { step: "email", email: typed, message: m.invalidEmail, error: true };
  const code = await createSignInCode(shop.store.id, address.data);
  if (!code) return { step: "email", email: address.data, message: m.tooManyCodes, error: true };
  await sendPasswordResetCode(shop.store.id, shop.market.code, shop.market.locale, address.data, code);
  return { step: "code", email: address.data, message: m.codeSent(address.data), error: false };
}

/** The emailed code and a new password: signed in, with every order for the email (D32). */
export async function resetPasswordAction(
  storeSlug: string,
  marketSlug: string,
  previous: ResetState,
  form: FormData,
): Promise<ResetState> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { ...previous, error: true, message: null };
  const m = t(shop.market.lang).account;
  const password = String(form.get("password") ?? "");
  if (passwordProblem(password, previous.email)) return { ...previous, error: true, message: m.passwordRule };
  const code = String(form.get("code") ?? "").replace(/\D/g, "");
  const customerId = code.length === 6 ? await resetPassword(shop.store.id, previous.email, code, password) : null;
  if (!customerId) return { ...previous, error: true, message: m.wrongCode };
  await startSession(shop.store.id, customerId);
  redirect(marketPath(shop.store.slug, shop.market.slug, "/account"));
}

/**
 * At checkout, before paying: the password for an account to open with
 * the order (D32), or null for none. Only for this browser's own checkout.
 */
export async function checkoutAccountAction(
  storeSlug: string,
  marketSlug: string,
  password: string | null,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return { ok: false, message: "" };
  const m = t(shop.market.lang).account;
  const cartId = await readCartId({ storeId: shop.store.id, market: shop.market });
  const open = cartId ? await getOpenCheckout(shop.store.id, cartId) : null;
  if (!open) return { ok: false, message: t(shop.market.lang).checkoutExpired };
  if (password !== null && passwordProblem(password, "")) return { ok: false, message: m.passwordRule };
  await saveCheckoutAccount(shop.store.id, open.orderId, password);
  return { ok: true };
}

/** From the order page: signs in to the account just opened at checkout, once, within the hour. */
export async function checkoutSignInAction(
  storeSlug: string,
  marketSlug: string,
  orderId: string,
  sessionId: string,
): Promise<void> {
  const shop = await resolveShop(storeSlug, marketSlug);
  if (!shop) return;
  const base = marketPath(shop.store.slug, shop.market.slug);
  const order = z.uuid().safeParse(orderId).success ? await getShopperOrder(shop.store.id, orderId, sessionId) : null;
  const customerId = order ? await takeCheckoutSignIn(shop.store.id, order.id) : null;
  if (customerId) await startSession(shop.store.id, customerId);
  redirect(`${base}/account`);
}
