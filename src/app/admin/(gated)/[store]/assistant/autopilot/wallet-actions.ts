"use server";

import { refresh } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import type { FormState } from "@/components/admin/action-form";
import type { AdminLang } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { WALLET_STATE_COOKIE, WALLET_STATE_MINUTES, WALLET_STATE_PATH } from "@/lib/card-wallet";
import { cancelPurchase, closeOpenCards } from "@/server/agent-purchases";
import { chooseCardholder, forgetWallet, setWalletLimit, setWalletPaused, startWalletConnect } from "@/server/card-wallet";
import { storeAction } from "@/server/store-action";

/**
 * The AI wallet's actions on the Autopilot settings (D599): connecting Airwallex, whose app the cards appear in, the monthly limit, the
 * pause (which closes every open card), calling a purchase off and disconnecting. The owner's only, as the wallet spends their money.
 */

const failed = (message: string): FormState => ({ status: "error", messages: [message] });
const ok: FormState = { status: "ok", messages: [] };
const words = (lang: AdminLang) => adminText(lang, "assistant").autopilot.wallet;

/** Connect Airwallex: the state cookie set here, then Airwallex's own consent page. */
export async function connectWalletAction(storeSlug: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "ai.wallet_connect", answer: failed }, async (member, lang) => {
    const start = await startWalletConnect(member);
    if (!start.ok) return failed(words(lang).problems[start.problem]);
    (await cookies()).set(WALLET_STATE_COOKIE, start.cookie, { httpOnly: true, secure: true, sameSite: "lax", path: WALLET_STATE_PATH, maxAge: WALLET_STATE_MINUTES * 60 });
    redirect(start.url);
  });
}

export async function chooseCardholderAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "ai.wallet_cardholder", answer: failed }, async (member, lang) => {
    const chosen = await chooseCardholder(member.store.id, member.account.id, String(form.get("cardholder") ?? ""));
    if (!chosen.ok) return failed(words(lang).problems[chosen.problem]);
    refresh();
    return ok;
  });
}

export async function setWalletLimitAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "ai.wallet_limit", answer: failed }, async (member, lang) => {
    const saved = await setWalletLimit(member.store.id, member.account.id, String(form.get("limit") ?? ""));
    if (!saved.ok) return failed(words(lang).problems[saved.problem]);
    refresh();
    return ok;
  });
}

/** The kill switch: paused, every open card is closed at once; switched on again, new cards may be made. */
export async function setWalletPausedAction(storeSlug: string, paused: boolean): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "ai.wallet_pause", answer: failed }, async (member, lang) => {
    if (!(await setWalletPaused(member.store.id, member.account.id, paused))) return failed(words(lang).problems.not_connected);
    if (paused) await closeOpenCards(member.store.id, member.account.id);
    refresh();
    return ok;
  });
}

export async function cancelPurchaseAction(storeSlug: string, purchaseId: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "ai.purchase_cancel", answer: failed }, async (member, lang) => {
    const done = await cancelPurchase(member.store.id, member.account.id, purchaseId);
    if (!done.ok) return failed(words(lang).problems[done.problem]);
    refresh();
    return ok;
  });
}

/** Disconnect: every open card closed, then the grant forgotten. */
export async function disconnectWalletAction(storeSlug: string): Promise<FormState> {
  return storeAction({ store: storeSlug, key: "owner", action: "ai.wallet_disconnect", answer: failed }, async (member) => {
    await closeOpenCards(member.store.id, member.account.id);
    await forgetWallet(member.store.id, member.account.id);
    refresh();
    return ok;
  });
}
