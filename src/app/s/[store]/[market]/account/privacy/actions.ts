"use server";

import { redirect } from "next/navigation";

import type { PrivacyFormState } from "@/components/privacy-forms";
import { t } from "@/lib/i18n";
import { marketPath } from "@/lib/paths";
import { shopperPrivacyText } from "@/lib/privacy-text";
import { confirmFreshWithCode, confirmFreshWithPassword, getCustomer, startFreshSignIn } from "@/server/customers";
import { shopperErase } from "@/server/privacy-shopper";
import { sendSignInCode } from "@/server/shopper-emails";
import { resolveShop } from "@/server/shop";

/**
 * The shopper's own data (wave 1, 1g, D162): confirming it is them again, and deleting the account. The account is always the one signed in
 * in this browser (the session cookie), never a value from the page, so the code goes only to the address on file. Nothing here sets a cookie
 * of its own: the step-up marks the existing session fresh, and the deletion ends it.
 */

/** Where a page goes after confirming it is them: the "Your data" page or the delete page. */
export type StepUpNext = "privacy" | "confirm";

async function signedIn(storeSlug: string, marketSlug: string) {
  const shop = await resolveShop(storeSlug, marketSlug);
  const customer = shop ? await getCustomer(shop.store.id) : null;
  return shop && customer ? { shop, customer, text: shopperPrivacyText(shop.market.lang), account: t(shop.market.lang).account } : null;
}

const base = (storeSlug: string, marketSlug: string) => marketPath(storeSlug, marketSlug, "/account");

/** Step 1: a six-digit code to the signed-in account's own address. Says the same however often it is asked, until the limit. */
export async function requestStepUpCodeAction(storeSlug: string, marketSlug: string, _previous: PrivacyFormState): Promise<PrivacyFormState> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found) redirect(base(storeSlug, marketSlug));
  const started = await startFreshSignIn(found.shop.store.id, found.customer.id);
  if (!started) return { step: "start", message: found.account.tooManyCodes, error: true };
  await sendSignInCode(found.shop.store.id, found.shop.market.code, found.shop.market.locale, started.email, started.code);
  return { step: "code", message: found.text.stepUpCodeSent, error: false };
}

/** Step 2: the code or the password. The session becomes fresh and the shopper goes on to the page they came for. */
export async function confirmStepUpAction(
  storeSlug: string,
  marketSlug: string,
  next: StepUpNext,
  previous: PrivacyFormState,
  form: FormData,
): Promise<PrivacyFormState> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found) redirect(base(storeSlug, marketSlug));
  const { shop, customer, text } = found;
  const password = form.get("password");
  let proven = false;
  if (typeof password === "string" && password !== "") {
    const outcome = await confirmFreshWithPassword(shop.store.id, customer.id, password);
    if (!outcome.ok && outcome.locked) return { ...previous, message: found.account.locked, error: true };
    proven = outcome.ok;
  } else {
    const code = String(form.get("code") ?? "").replace(/\D/g, "");
    proven = code.length === 6 && (await confirmFreshWithCode(shop.store.id, customer.id, code));
  }
  if (!proven) return { ...previous, message: text.stepUpWrong, error: true };
  redirect(marketPath(shop.store.slug, shop.market.slug, next === "confirm" ? "/account/privacy/confirm" : "/account/privacy"));
}

/**
 * Deletes the account (the same erasure staff run) and ends the session. The result is the delete page's own address with the numbers it
 * needs (how many orders are kept and the day), because the session that could have shown them is gone; no name, email or address goes into
 * the address. A stale session goes back to the step-up; when Stripe did not answer nothing was changed and the button is still there.
 */
export async function deleteAccountAction(storeSlug: string, marketSlug: string, _previous: PrivacyFormState): Promise<PrivacyFormState> {
  const found = await signedIn(storeSlug, marketSlug);
  if (!found) redirect(base(storeSlug, marketSlug));
  const { shop, text } = found;
  const result = await shopperErase(shop.store.id);
  const confirm = marketPath(shop.store.slug, shop.market.slug, "/account/privacy/confirm");
  if (!result.ok) {
    if (result.problem === "signed_out") redirect(base(shop.store.slug, shop.market.slug));
    if (result.problem === "stale") redirect(confirm);
    return { step: "start", message: result.problem === "stripe" ? text.stripeFailed : text.failed, error: true };
  }
  const until = result.summary.keptUntil?.last ?? "";
  const query = new URLSearchParams({ done: "1", kept: String(result.counts.ordersRestricted), until, mail: result.confirmation === "sent" ? "1" : "0" });
  redirect(`${confirm}?${query.toString()}`);
}
