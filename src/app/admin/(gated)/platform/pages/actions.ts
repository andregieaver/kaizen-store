"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePlatformAdmin } from "@/server/auth";
import { deletePage, getPageForEdit, PAGES_TAG, savePage, unpublishPage, type EditablePage } from "@/server/pages";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { createTerm, deleteTerm, termsTag, updateTerm, type TermsResult } from "@/server/taxonomy";

export type PageSaveState = { status: "saved"; page: EditablePage } | { status: "error"; problems: string[] };

const isId = (id: string) => z.uuid().safeParse(id).success;

/**
 * Saves the editor's page (sent whole, as JSON) as a draft, or publishes
 * it. Everything is checked on the server again; nothing the browser sends
 * is trusted.
 */
export async function savePageAction(id: string | null, payload: string, publish: boolean): Promise<PageSaveState> {
  const admin = await requirePlatformAdmin();
  if (id !== null && !isId(id)) return { status: "error", problems: ["Unknown page."] };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The page could not be read. Reload and try again."] };
  }
  const result = await savePage(admin, id, json, { publish: publish === true });
  if (!result.ok) return { status: "error", problems: result.problems };
  // Drafts are not on the site; publishing changes pages, menus, sitemap and llms.txt.
  if (publish) updateTag(PAGES_TAG);
  const page = await getPageForEdit(result.id);
  if (!page) return { status: "error", problems: ["The page was saved but could not be read back."] };
  return { status: "saved", page };
}

export async function unpublishPageAction(id: string): Promise<PageSaveState> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { status: "error", problems: ["Unknown page."] };
  await unpublishPage(admin, id);
  updateTag(PAGES_TAG);
  const page = await getPageForEdit(id);
  if (!page) return { status: "error", problems: ["This page no longer exists."] };
  return { status: "saved", page };
}

/** Deletes the page and goes back to the list; returns only when it could not. */
export async function deletePageAction(id: string): Promise<{ problems: string[] } | void> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { problems: ["Unknown page."] };
  await deletePage(admin, id);
  updateTag(PAGES_TAG);
  redirect("/admin/platform/pages?deleted=1");
}

// ---------------------------------------------------------------------------
// Saved rows, columns and components (D46)
// ---------------------------------------------------------------------------

export async function createSavedPartAction(input: unknown): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  return createSavedPart(admin, input);
}

export async function updateSavedPartAction(id: string, input: unknown): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return updateSavedPart(admin, id, input);
}

export async function deleteSavedPartAction(id: string): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return deleteSavedPart(admin, id);
}

// ---------------------------------------------------------------------------
// Kaizen's page categories and tags (D50)
// ---------------------------------------------------------------------------

const pageTerms = { storeId: null, contentType: "page" } as const;

/** Listings and grids of pages show categories and tags. */
function termsChanged(result: TermsResult): TermsResult {
  if (result.ok) {
    updateTag(termsTag(pageTerms));
    updateTag(PAGES_TAG);
  }
  return result;
}

export async function createPageTermAction(input: unknown): Promise<TermsResult> {
  const admin = await requirePlatformAdmin();
  return termsChanged(await createTerm(admin, pageTerms, input));
}

export async function updatePageTermAction(id: string, input: unknown): Promise<TermsResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown category or tag."] };
  return termsChanged(await updateTerm(admin, pageTerms, id, input));
}

export async function deletePageTermAction(id: string): Promise<TermsResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown category or tag."] };
  return termsChanged(await deleteTerm(admin, pageTerms, id));
}
