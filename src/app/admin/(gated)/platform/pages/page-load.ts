import { z } from "zod";

import type { PageType } from "@/lib/page-content";
import { getPageForEdit } from "@/server/pages";
import { themeStoreRoleOf } from "@/server/platform-roles";
import { themeStoreCards } from "@/server/theme-store";
import { themeStorePageHref } from "@/lib/theme-admin-paths";

export type Params = Promise<{ pageId: string }>;

export const load = async (type: PageType, params: Params) => {
  const { pageId } = await params;
  return z.uuid().safeParse(pageId).success ? getPageForEdit(null, pageId, type) : null;
};

/**
 * The page a page of Kaizen's is edited at: the theme store's own pages (D285) under Themes, every other page under Pages. Null when it is
 * this one; the other address when the page belongs there.
 */
export async function editedElsewhere(type: PageType, pageId: string, themeStore: boolean): Promise<string | null> {
  if (type !== "page") return null;
  const role = await themeStoreRoleOf(pageId);
  if (themeStore && !role) return `/admin/platform/pages/${pageId}`;
  if (!themeStore && role) return themeStorePageHref(pageId);
  return null;
}

/** Where a theme store page's View and preview go: the list, or the first theme's page for a theme's page (D285). */
export async function themeStoreView(role: "themes" | "theme") {
  if (role === "themes") return { slug: null, view: "/themes" };
  const first = (await themeStoreCards())[0]?.slug ?? null;
  return { slug: first, view: first ? `/themes/${first}` : null };
}
