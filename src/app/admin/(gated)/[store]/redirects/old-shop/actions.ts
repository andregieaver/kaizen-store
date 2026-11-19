"use server";

import { refresh } from "next/cache";

import type { Finding } from "@/lib/data-job";
import { redirectFromReport } from "@/server/not-found";
import { fixOldShop, forgetOldShop, readOldShop, type OldShopProblem } from "@/server/old-shop";
import { NO_ACCESS, checkPermission } from "@/server/permissions";
import { inAccountWords } from "../answer-words";

/**
 * The old shop's address check (D445 step 1, `docs/moving-from-shopify.md` 8.2): read the old shop's sitemap, make the redirects that are sure
 * in one press, make one redirect to a suggestion or a typed address (the 404 report's door, origin `report`), or forget the old shop. Each takes
 * the store's slug as its bound first argument and asks `website:write` itself.
 */

export type OldShopStep = { ok: true; written?: number; refused?: number } | { ok: false; problem: OldShopProblem };
export type OldRedirectStep = { ok: true; target?: string } | { ok: false; problems: string[]; findings?: Finding[] };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

async function readOldShopActionInEnglish(storeSlug: string, address: string): Promise<OldShopStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await readOldShop(member, text(address, 300));
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

async function fixOldShopActionInEnglish(storeSlug: string): Promise<OldShopStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await fixOldShop(member);
  if (!result.ok) return result;
  refresh();
  return { ok: true, written: result.written, refused: result.refused };
}

async function forgetOldShopActionInEnglish(storeSlug: string): Promise<OldShopStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await forgetOldShop(member);
  if (!result.ok) return { ok: false, problem: "forbidden" };
  refresh();
  return { ok: true };
}

async function redirectOldAddressActionInEnglish(storeSlug: string, path: string, to: string): Promise<OldRedirectStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await redirectFromReport(member, { path: text(path, 300), to: text(to, 2_100) });
  if (!result.ok) return { ok: false, problems: result.problems, findings: result.findings };
  refresh();
  return { ok: true, target: result.target };
}

// Each action's answer in the account's words (bloat review step 2.26): the browser draws what it is given, with no English to match.
export async function readOldShopAction(...args: Parameters<typeof readOldShopActionInEnglish>): Promise<Awaited<ReturnType<typeof readOldShopActionInEnglish>>> {
  return inAccountWords(await readOldShopActionInEnglish(...args));
}
export async function fixOldShopAction(...args: Parameters<typeof fixOldShopActionInEnglish>): Promise<Awaited<ReturnType<typeof fixOldShopActionInEnglish>>> {
  return inAccountWords(await fixOldShopActionInEnglish(...args));
}
export async function forgetOldShopAction(...args: Parameters<typeof forgetOldShopActionInEnglish>): Promise<Awaited<ReturnType<typeof forgetOldShopActionInEnglish>>> {
  return inAccountWords(await forgetOldShopActionInEnglish(...args));
}
export async function redirectOldAddressAction(...args: Parameters<typeof redirectOldAddressActionInEnglish>): Promise<Awaited<ReturnType<typeof redirectOldAddressActionInEnglish>>> {
  return inAccountWords(await redirectOldAddressActionInEnglish(...args));
}
