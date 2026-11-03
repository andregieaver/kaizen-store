"use server";

import { refresh } from "next/cache";

import type { Finding } from "@/lib/data-job";
import { redirectFromReport } from "@/server/not-found";
import { fixOldShop, forgetOldShop, readOldShop, type OldShopProblem } from "@/server/old-shop";
import { NO_ACCESS, checkPermission } from "@/server/permissions";

/**
 * The old shop's address check (D445 step 1, `docs/moving-from-shopify.md` 8.2): read the old shop's sitemap, make the redirects that are sure
 * in one press, make one redirect to a suggestion or a typed address (the 404 report's door, origin `report`), or forget the old shop. Each takes
 * the store's slug as its bound first argument and asks `website:write` itself.
 */

export type OldShopStep = { ok: true; written?: number; refused?: number } | { ok: false; problem: OldShopProblem };
export type OldRedirectStep = { ok: true; target?: string } | { ok: false; problems: string[]; findings?: Finding[] };

const text = (value: unknown, max: number): string => (typeof value === "string" ? value.slice(0, max) : "");

export async function readOldShopAction(storeSlug: string, address: string): Promise<OldShopStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await readOldShop(member, text(address, 300));
  if (!result.ok) return result;
  refresh();
  return { ok: true };
}

export async function fixOldShopAction(storeSlug: string): Promise<OldShopStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await fixOldShop(member);
  if (!result.ok) return result;
  refresh();
  return { ok: true, written: result.written, refused: result.refused };
}

export async function forgetOldShopAction(storeSlug: string): Promise<OldShopStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problem: "forbidden" };
  const result = await forgetOldShop(member);
  if (!result.ok) return { ok: false, problem: "forbidden" };
  refresh();
  return { ok: true };
}

export async function redirectOldAddressAction(storeSlug: string, path: string, to: string): Promise<OldRedirectStep> {
  const member = await checkPermission(storeSlug, "website:write");
  if (!member) return { ok: false, problems: [NO_ACCESS] };
  const result = await redirectFromReport(member, { path: text(path, 300), to: text(to, 2_100) });
  if (!result.ok) return { ok: false, problems: result.problems, findings: result.findings };
  refresh();
  return { ok: true, target: result.target };
}
