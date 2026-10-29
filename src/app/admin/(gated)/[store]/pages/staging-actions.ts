"use server";

import type { PageSaveState } from "@/components/admin/page-context";
import { PAGE_TYPES, type PageType } from "@/lib/page-content";
import { getPageForEdit } from "@/server/pages";
import { NO_ACCESS, checkPageTypeAccess, memberCan } from "@/server/permissions";
import { saveStagedPage } from "@/server/site-staging";

/**
 * The builder's save in staging mode (D385): what it holds is written to the open staging set's copy of the page, never the page's own draft
 * or what visitors see. It asks what the staging page asks (`website:write`) and what writing the page's kind asks; there is no publishing here.
 */
export async function saveStagedPageAction(storeSlug: string, type: PageType, id: string | null, payload: string): Promise<PageSaveState> {
  const member = await checkPageTypeAccess(storeSlug, type, "write");
  if (!member || !memberCan(member, "website:write")) return { status: "error", problems: [NO_ACCESS] };
  if (!PAGE_TYPES.includes(type) || id === null) return { status: "error", problems: ["This page is not in the staging set."] };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The page could not be read. Try again."] };
  }
  const saved = await saveStagedPage(member, id, json);
  if (!saved.ok) return { status: "error", problems: saved.problems.map((p) => (p === "none" ? "This page is not in an open staging set any more." : p)) };
  const page = await getPageForEdit(member.store.id, id, type);
  if (!page) return { status: "error", problems: ["This page is gone."] };
  return { status: "saved", page: { ...page, draft: saved.content } };
}
