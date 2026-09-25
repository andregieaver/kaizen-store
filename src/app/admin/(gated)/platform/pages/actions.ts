"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePlatformAdmin } from "@/server/auth";
import type { PageSaveState } from "@/components/admin/page-context";
import { deletePage, getPageForEdit, PAGES_TAG, savePage, unpublishPage } from "@/server/pages";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { createTerm, deleteTerm, listTerms, termsTag, updateTerm, type TermsResult } from "@/server/taxonomy";
import { gridData } from "@/server/content-grid";
import type { GridData } from "@/lib/content-grid";
import { PAGE_TYPES, pageBlockSchema, type PageType } from "@/lib/page-content";
import type { Term } from "@/lib/taxonomy";


const isId = (id: string) => z.uuid().safeParse(id).success;
/** Pages or articles (D57): the first, bound argument of the actions below. */
const isType = (type: unknown): type is PageType => PAGE_TYPES.includes(type as PageType);
const listOf = (type: PageType) => (type === "article" ? "/admin/platform/articles" : "/admin/platform/pages");

/**
 * Saves the editor's page (sent whole, as JSON) as a draft, or publishes
 * it. Everything is checked on the server again; nothing the browser sends
 * is trusted.
 */
export async function savePageAction(
  type: PageType,
  id: string | null,
  payload: string,
  publish: boolean,
): Promise<PageSaveState> {
  const admin = await requirePlatformAdmin();
  if (!isType(type) || (id !== null && !isId(id))) return { status: "error", problems: ["Unknown page."] };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The page could not be read. Reload and try again."] };
  }
  const result = await savePage(admin, null, id, json, { publish: publish === true, type });
  if (!result.ok) return { status: "error", problems: result.problems };
  // Drafts are not on the site; publishing changes pages, menus, sitemap and llms.txt.
  if (publish) updateTag(PAGES_TAG);
  const page = await getPageForEdit(null, result.id, type);
  if (!page) return { status: "error", problems: ["The page was saved but could not be read back."] };
  return { status: "saved", page };
}

export async function unpublishPageAction(type: PageType, id: string): Promise<PageSaveState> {
  const admin = await requirePlatformAdmin();
  if (!isType(type) || !isId(id)) return { status: "error", problems: ["Unknown page."] };
  await unpublishPage(admin, null, id, type);
  updateTag(PAGES_TAG);
  const page = await getPageForEdit(null, id, type);
  if (!page) return { status: "error", problems: ["This page no longer exists."] };
  return { status: "saved", page };
}

/** Deletes the page and goes back to the list; returns only when it could not. */
export async function deletePageAction(type: PageType, id: string): Promise<{ problems: string[] } | void> {
  const admin = await requirePlatformAdmin();
  if (!isType(type) || !isId(id)) return { problems: ["Unknown page."] };
  await deletePage(admin, null, id, type);
  updateTag(PAGES_TAG);
  redirect(`${listOf(type)}?deleted=1`);
}

// ---------------------------------------------------------------------------
// Saved rows, columns and components (D46)
// ---------------------------------------------------------------------------

export async function createSavedPartAction(input: unknown): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  return createSavedPart(admin, null, input);
}

export async function updateSavedPartAction(id: string, input: unknown): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return updateSavedPart(admin, null, id, input);
}

export async function deleteSavedPartAction(id: string): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return deleteSavedPart(admin, null, id);
}

// ---------------------------------------------------------------------------
// Kaizen's page and article categories and tags (D50, D57)
// ---------------------------------------------------------------------------

const termScope = (type: PageType) => ({ storeId: null, contentType: type }) as const;

/** Listings and grids of pages show categories and tags. */
function termsChanged(type: PageType, result: TermsResult): TermsResult {
  if (result.ok) {
    updateTag(termsTag(termScope(type)));
    updateTag(PAGES_TAG);
  }
  return result;
}

const unknownTerm: TermsResult = { ok: false, problems: ["Unknown category or tag."] };

export async function createPageTermAction(type: PageType, input: unknown): Promise<TermsResult> {
  const admin = await requirePlatformAdmin();
  if (!isType(type)) return unknownTerm;
  return termsChanged(type, await createTerm(admin, termScope(type), input));
}

export async function updatePageTermAction(type: PageType, id: string, input: unknown): Promise<TermsResult> {
  const admin = await requirePlatformAdmin();
  if (!isType(type) || !isId(id)) return unknownTerm;
  return termsChanged(type, await updateTerm(admin, termScope(type), id, input));
}

export async function deletePageTermAction(type: PageType, id: string): Promise<TermsResult> {
  const admin = await requirePlatformAdmin();
  if (!isType(type) || !isId(id)) return unknownTerm;
  return termsChanged(type, await deleteTerm(admin, termScope(type), id));
}

// ---------------------------------------------------------------------------
// Content grids (D51): what the builder's preview shows
// ---------------------------------------------------------------------------

/** A grid's items as the site will show them, for the canvas. */
export async function gridPreviewAction(block: unknown, pageId: string | null): Promise<GridData | { problem: string }> {
  await requirePlatformAdmin();
  const parsed = pageBlockSchema.safeParse(block);
  if (!parsed.success || parsed.data.type !== "contentGrid") {
    return { problem: parsed.success ? "Not a content grid." : parsed.error.issues[0].message };
  }
  return gridData(parsed.data, { pageId: pageId !== null && isId(pageId) ? pageId : null, owner: null });
}

/** A store's product categories and tags, for a grid of its products. */
export async function gridTermsAction(storeId: string): Promise<Term[]> {
  await requirePlatformAdmin();
  if (!isId(storeId)) return [];
  return listTerms({ storeId, contentType: "product" });
}
