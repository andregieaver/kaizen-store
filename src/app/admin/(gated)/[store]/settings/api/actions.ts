"use server";

import { refresh } from "next/cache";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { actionAdminLang } from "@/server/admin-request-lang";
import { makeApiToken, revokeApiToken, TOKENS_MAX } from "@/server/api-tokens";
import { checkOwnerRole } from "@/server/permissions";
import { STOREFRONT_TOKENS_MAX } from "@/lib/storefront-api";
import { makeStorefrontToken, revokeStorefrontToken } from "@/server/storefront-api";

/** Tokens act as their maker and reach the store's data, so only an owner makes or revokes one (D355). */
export type TokenAnswer = { ok: true; token?: string } | { ok: false; message: string };

export async function makeApiTokenAction(storeSlug: string, form: FormData): Promise<TokenAnswer> {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return { ok: false, message: adminText(await actionAdminLang(), "notifications").apiTokens.ownerOnly };
  const w = adminText(adminLangOf(owner.account.adminLocale), "notifications").apiTokens;
  const made = await makeApiToken(owner, { name: String(form.get("name") ?? ""), scopes: form.getAll("scopes").map(String) });
  if (!made.ok) return { ok: false, message: fillWords(w.problems[made.problem], { max: TOKENS_MAX }) };
  refresh();
  return { ok: true, token: made.token };
}

export async function revokeApiTokenAction(storeSlug: string, id: string): Promise<TokenAnswer> {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return { ok: false, message: adminText(await actionAdminLang(), "notifications").apiTokens.ownerOnly };
  if (!(await revokeApiToken(owner, id))) return { ok: false, message: adminText(adminLangOf(owner.account.adminLocale), "notifications").apiTokens.problems.gone };
  refresh();
  return { ok: true };
}

/** A storefront token (D362) reaches only what visitors see, but making one is still the owner's, beside the Admin API's. */
export async function makeStorefrontTokenAction(storeSlug: string, form: FormData): Promise<{ ok: true } | { ok: false; message: string }> {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return { ok: false, message: adminText(await actionAdminLang(), "notifications").apiTokens.ownerOnly };
  const w = adminText(adminLangOf(owner.account.adminLocale), "notifications").storefrontTokens;
  const made = await makeStorefrontToken(owner, { name: String(form.get("name") ?? ""), market: String(form.get("market") ?? "") });
  if (!made.ok) return { ok: false, message: fillWords(w.problems[made.problem], { max: STOREFRONT_TOKENS_MAX }) };
  refresh();
  return { ok: true };
}

export async function revokeStorefrontTokenAction(storeSlug: string, id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const owner = await checkOwnerRole(storeSlug);
  if (!owner) return { ok: false, message: adminText(await actionAdminLang(), "notifications").apiTokens.ownerOnly };
  if (!(await revokeStorefrontToken(owner, id))) return { ok: false, message: adminText(adminLangOf(owner.account.adminLocale), "notifications").storefrontTokens.problems.gone };
  refresh();
  return { ok: true };
}
