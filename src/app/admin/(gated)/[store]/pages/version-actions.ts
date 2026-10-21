"use server";

import { z } from "zod";

import { PAGE_TYPES, type PageType } from "@/lib/page-content";
import type { PageVersionItem } from "@/lib/page-versions";
import { listVersions, readVersion } from "@/server/page-versions";
import { NO_ACCESS, checkPageTypeAccess } from "@/server/permissions";

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
