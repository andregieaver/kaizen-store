"use server";

import { platformActionWords } from "@/server/platform-site-words";

import { z } from "zod";

import { PAGE_TYPES, type PageType } from "@/lib/page-content";
import type { PageVersionItem } from "@/lib/page-versions";
import { requirePlatformAdmin } from "@/server/auth";
import { listVersions, readVersion } from "@/server/page-versions";

/** Kaizena Flow's own page's versions (D305); see the store's action. */
export async function platformPageVersionsAction(type: PageType, id: string): Promise<PageVersionItem[]> {
  await requirePlatformAdmin();
  if (!PAGE_TYPES.includes(type) || !z.uuid().safeParse(id).success) return [];
  return listVersions(null, id, type);
}

export async function platformPageVersionAction(type: PageType, id: string, version: string): Promise<{ ok: true; content: string } | { ok: false; problem: string }> {
  await requirePlatformAdmin();
  if (!PAGE_TYPES.includes(type) || !z.uuid().safeParse(id).success || !z.uuid().safeParse(version).success) return { ok: false, problem: (await platformActionWords()).unknownVersion };
  const content = await readVersion(null, id, type, version);
  return content ? { ok: true, content: JSON.stringify(content) } : { ok: false, problem: (await platformActionWords()).versionGone };
}
