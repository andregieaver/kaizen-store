"use server";

import { z } from "zod";

import { PAGE_TYPES, type PageType } from "@/lib/page-content";
import type { CssVersionItem } from "@/lib/css-versions";
import type { PageVersionItem } from "@/lib/page-versions";
import { listCssVersions, readCssVersion } from "@/server/css-versions";
import { listVersions, readVersion } from "@/server/page-versions";
import { NO_ACCESS, checkPageTypeAccess, checkPermission } from "@/server/permissions";

/** A store's page's versions (D305), for those who may read that kind of page; bound to the store and the kind like its other page actions. */
export async function storePageVersionsAction(storeSlug: string, type: PageType, id: string): Promise<PageVersionItem[]> {
  const member = await checkPageTypeAccess(storeSlug, type, "read");
  if (!member || !PAGE_TYPES.includes(type) || !z.uuid().safeParse(id).success) return [];
  return listVersions(member.store.id, id, type);
}

/** One version's content, to hold in the editor (nothing is saved here). */
export async function storePageVersionAction(
  storeSlug: string,
  type: PageType,
  id: string,
  version: string,
): Promise<{ ok: true; content: string } | { ok: false; problem: string }> {
  const member = await checkPageTypeAccess(storeSlug, type, "read");
  if (!member) return { ok: false, problem: NO_ACCESS };
  if (!PAGE_TYPES.includes(type) || !z.uuid().safeParse(id).success || !z.uuid().safeParse(version).success) return { ok: false, problem: "Unknown version." };
  const content = await readVersion(member.store.id, id, type, version);
  return content ? { ok: true, content: JSON.stringify(content) } : { ok: false, problem: "This version is no longer kept." };
}

/** The store's own CSS's versions (D385), for those who may read the website. */
export async function storeCssVersionsAction(storeSlug: string): Promise<CssVersionItem[]> {
  const member = await checkPermission(storeSlug, "website:read");
  return member ? listCssVersions(member.store.id) : [];
}

/** One version of the store's CSS, to hold in the CSS panel (nothing is saved here). */
export async function storeCssVersionAction(storeSlug: string, version: string): Promise<{ ok: true; css: string } | { ok: false; problem: string }> {
  const member = await checkPermission(storeSlug, "website:read");
  if (!member) return { ok: false, problem: NO_ACCESS };
  const css = await readCssVersion(member.store.id, version);
  return css === null ? { ok: false, problem: "This version is no longer kept." } : { ok: true, css };
}
