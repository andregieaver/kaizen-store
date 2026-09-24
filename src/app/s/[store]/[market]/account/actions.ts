"use server";

import { refresh } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { t } from "@/lib/i18n";
import { passwordProblem } from "@/lib/password";
import { marketPath } from "@/lib/paths";
import {
  createSignInCode,
  deleteCustomer,
  endSession,
  getCustomer,
  setPassword,
  signInWithPassword,
  startSession,
  updateCustomerDetails,
  verifySignInCode,
} from "@/server/customers";
import { sendSignInCode } from "@/server/shopper-emails";
import { resolveShop } from "@/server/shop";

export type SignInState = {
  step: "email" | "code" | "password";
  email: string;
  message: string | null;
  error: boolean;
};

export type AccountFormState = { ok: boolean; message: string | null };

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
