"use server";

import { refresh } from "next/cache";
import { headers } from "next/headers";

import { declineAsSigner, requestCode, signerByToken, signWithCode, type Request } from "@/server/contract-signing";
import { resolveAfterSaleShop } from "@/server/shop";

/**
 * A contract's signer on their page (D695 step 3): asking for a code, signing with it, and declining. The link is the whole access (the
 * server checks it belongs to this store and that it is the signer's turn), and the request's address and browser are kept as evidence.
 * Each answers with a problem's key, which the page words in the contract's language, and draws the page again when it changed something.
 */

export type SignState = { status: "idle" | "code_sent" | "error"; problem?: string };

const requestOf = async (): Promise<Request> => {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip")?.trim() || null, userAgent: h.get("user-agent") };
};

/** Whether the link is one of this store's signers (another store's address never signs here). */
async function belongs(storeSlug: string, marketSlug: string, token: string): Promise<boolean> {
  const shop = await resolveAfterSaleShop(storeSlug, marketSlug);
  if (!shop) return false;
  const view = await signerByToken(token);
  return view?.storeId === shop.store.id;
}

export async function requestCodeAction(storeSlug: string, marketSlug: string, token: string): Promise<SignState> {
  if (!(await belongs(storeSlug, marketSlug, token))) return { status: "error", problem: "not_found" };
  const asked = await requestCode(token, await requestOf());
  return asked.ok ? { status: "code_sent" } : { status: "error", problem: asked.problem };
}

export async function signAction(storeSlug: string, marketSlug: string, token: string, _state: SignState, form: FormData): Promise<SignState> {
  if (!(await belongs(storeSlug, marketSlug, token))) return { status: "error", problem: "not_found" };
  const signed = await signWithCode(
    token,
    { code: String(form.get("code") ?? ""), name: String(form.get("name") ?? ""), agree: form.get("agree") === "on" },
    await requestOf(),
  );
  if (!signed.ok) return { status: "code_sent", problem: signed.problem };
  refresh();
  return { status: "idle" };
}

export async function declineAction(storeSlug: string, marketSlug: string, token: string, _state: SignState, form: FormData): Promise<SignState> {
  if (!(await belongs(storeSlug, marketSlug, token))) return { status: "error", problem: "not_found" };
  const declined = await declineAsSigner(token, String(form.get("reason") ?? ""), await requestOf());
  if (!declined.ok) return { status: "error", problem: declined.problem };
  refresh();
  return { status: "idle" };
}
