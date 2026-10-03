"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requirePlatformAdmin } from "@/server/auth";
import type { PageSaveState } from "@/components/admin/page-context";
import { deletePage, getPageForEdit, PAGES_TAG, savePage, unpublishPage } from "@/server/pages";
import { chooseSiteLayout, type SiteLayoutType } from "@/server/site-layouts";
import { createPlatformRolePage, setPlatformPageRole } from "@/server/platform-roles";
import { isPlatformRole, PLATFORM_ROLE_COPY } from "@/lib/platform-roles";
import type { FormState } from "@/components/admin/action-form";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { saveSiteCss } from "@/server/site-css";
import { PLATFORM_NAVIGATION_TAG } from "@/server/platform-navigation";
import { createTerm, deleteTerm, listTerms, termsTag, updateTerm, type TermsResult } from "@/server/taxonomy";
import { gridData } from "@/server/content-grid";
import { itemLinkTargets, type ItemLinkTargets } from "@/server/link-targets";
import type { GridData } from "@/lib/content-grid";
import { PAGE_TYPES, pageBlockSchema, type PageType, termContentOf } from "@/lib/page-content";
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
  // Drafts are not on the site; publishing changes pages, menus, sitemap and llms.txt, and so does a global part's change (D98).
  if (publish || result.pages) updateTag(PAGES_TAG);
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

/** Kaizen's own CSS for every one of its pages (D100): live at once. */
export async function savePlatformCssAction(css: unknown): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const admin = await requirePlatformAdmin();
  const result = await saveSiteCss(admin, null, css);
  if (result.ok) updateTag(PLATFORM_NAVIGATION_TAG);
  return result;
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
  const result = await updateSavedPart(admin, null, id, input);
  if (result.ok && result.pages) updateTag(PAGES_TAG);
  return result;
}

export async function deleteSavedPartAction(id: string): Promise<SavedResult> {
  const admin = await requirePlatformAdmin();
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  const result = await deleteSavedPart(admin, null, id);
  if (result.ok && result.pages) updateTag(PAGES_TAG);
  return result;
}

// ---------------------------------------------------------------------------
// Kaizen's page and article categories and tags (D50, D57)
// ---------------------------------------------------------------------------

const termScope = (type: PageType) => ({ storeId: null, contentType: termContentOf(type) }) as const;

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

/** What a custom grid item's link can point at (D155): Kaizen's own pages, articles, categories and tags, by address. */
export async function platformLinkTargetsAction(): Promise<ItemLinkTargets> {
  await requirePlatformAdmin();
  return itemLinkTargets(null);
}

/** Which of Kaizen's headers or footers its pages show (D80), or the standard one. */
export async function choosePlatformSiteLayoutAction(type: SiteLayoutType, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  const choice = String(form.get("layout") ?? "");
  if (choice !== "" && !z.uuid().safeParse(choice).success) return { status: "error", messages: [`Unknown ${type}.`] };
  const result = await chooseSiteLayout(admin, null, type, choice || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(PAGES_TAG);
  return { status: "ok", messages: [choice ? `Saved. Kaizen's pages show this ${type} now.` : `Saved. Kaizen's pages show the standard ${type} now.`] };
}

/** Chooses the page Kaizen's front page, blog or 404 page shows (D143), or the standard one; the site follows at once. */
export async function setPlatformPageRoleAction(role: string, _state: FormState, form: FormData): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!isPlatformRole(role)) return { status: "error", messages: ["Unknown page."] };
  const choice = String(form.get("page") ?? "");
  if (choice !== "" && !isId(choice)) return { status: "error", messages: ["Unknown page."] };
  const result = await setPlatformPageRole(admin, role, choice || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(PAGES_TAG);
  const name = PLATFORM_ROLE_COPY[role].name.toLowerCase();
  return { status: "ok", messages: [choice ? `Saved. Kaizen's ${name} is this page now.` : `Saved. Kaizen's ${name} is the standard one now.`] };
}

/** Makes a starter page for one of Kaizen's places, published and in place, to change in the builder (D143). */
export async function createPlatformRolePageAction(role: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!isPlatformRole(role)) return { status: "error", messages: ["Unknown page."] };
  const result = await createPlatformRolePage(admin, role);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(PAGES_TAG);
  redirect(`/admin/platform/pages/${result.id}`);
}
