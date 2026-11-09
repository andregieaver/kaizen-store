"use server";

import { refresh } from "next/cache";

import { fillWords } from "@/lib/admin-fill";
import { adminLangOf } from "@/lib/admin-lang";
import { adminText } from "@/lib/admin-text";
import { requirePlatform } from "@/server/auth";
import { makePlatformToken, PLATFORM_TOKENS_MAX, revokePlatformToken } from "@/server/platform-api-tokens";

/** Kaizena Flow's own API's tokens (D518) read the platform's stores, plans and requests, so they are a platform owner's (the settings area, D510). */
export type PlatformTokenAnswer = { ok: true; token?: string } | { ok: false; message: string };

export async function makePlatformTokenAction(form: FormData): Promise<PlatformTokenAnswer> {
  const admin = await requirePlatform("settings");
  const w = adminText(adminLangOf(admin.adminLocale), "notifications").apiTokens;
  const made = await makePlatformToken(admin, { name: String(form.get("name") ?? ""), scopes: form.getAll("scopes").map(String) });
  if (!made.ok) return { ok: false, message: fillWords(w.problems[made.problem], { max: PLATFORM_TOKENS_MAX }) };
  refresh();
  return { ok: true, token: made.token };
}

export async function revokePlatformTokenAction(id: string): Promise<PlatformTokenAnswer> {
  const admin = await requirePlatform("settings");
  if (!(await revokePlatformToken(admin, id))) return { ok: false, message: adminText(adminLangOf(admin.adminLocale), "notifications").apiTokens.problems.gone };
  refresh();
  return { ok: true };
}
