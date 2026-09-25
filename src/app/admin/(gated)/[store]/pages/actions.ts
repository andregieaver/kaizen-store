"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import type { PageSaveState } from "@/components/admin/page-context";
import type { GridData } from "@/lib/content-grid";
import { PAGE_TYPES, pageBlockSchema, type PageType } from "@/lib/page-content";
import type { Term } from "@/lib/taxonomy";
import { requireMember, type Membership } from "@/server/auth";
import { gridData } from "@/server/content-grid";
import { deletePage, getPageForEdit, pagesTag, savePage, setFrontPage, unpublishPage } from "@/server/pages";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { storeTag } from "@/server/stores";
import { createTerm, deleteTerm, listTerms, termsTag, updateTerm, type TermsResult } from "@/server/taxonomy";

/**
 * A store's pages (D53): the same editor as Kaizen's, through these
 * actions, each bound to the store's slug and checking the editor belongs
 * to it. Everything the browser sends is checked on the server again.
 */

const isId = (id: string) => z.uuid().safeParse(id).success;
/** Pages or articles (D57): bound after the store's slug in the actions below. */
const isType = (type: unknown): type is PageType => PAGE_TYPES.includes(type as PageType);

/** A store's page changes show on its storefront, its menus and grids. */
function pagesChanged(member: Membership) {
  updateTag(pagesTag(member.store.id));
}

export async function saveStorePageAction(
  storeSlug: string,
  type: PageType,
  id: string | null,
  payload: string,
  publish: boolean,
): Promise<PageSaveState> {
  const member = await requireMember(storeSlug);
  if (!isType(type) || (id !== null && !isId(id))) return { status: "error", problems: ["Unknown page."] };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The page could not be read. Reload and try again."] };
  }
  const result = await savePage(member.account, member.store.id, id, json, { publish: publish === true, type });
  if (!result.ok) return { status: "error", problems: result.problems };
  if (publish) pagesChanged(member);
  const page = await getPageForEdit(member.store.id, result.id, type);
  if (!page) return { status: "error", problems: ["The page was saved but could not be read back."] };
  return { status: "saved", page };
}

export async function unpublishStorePageAction(storeSlug: string, type: PageType, id: string): Promise<PageSaveState> {
  const member = await requireMember(storeSlug);
  if (!isType(type) || !isId(id)) return { status: "error", problems: ["Unknown page."] };
  await unpublishPage(member.account, member.store.id, id, type);
  pagesChanged(member);
  const page = await getPageForEdit(member.store.id, id, type);
  if (!page) return { status: "error", problems: ["This page no longer exists."] };
  return { status: "saved", page };
}

/** Deletes the page and goes back to the list; returns only when it could not. */
export async function deleteStorePageAction(storeSlug: string, type: PageType, id: string): Promise<{ problems: string[] } | void> {
  const member = await requireMember(storeSlug);
  if (!isType(type) || !isId(id)) return { problems: ["Unknown page."] };
  await deletePage(member.account, member.store.id, id, type);
  pagesChanged(member);
  // A deleted front page (D54) gives the store its product list back.
  if (member.store.frontPageId === id) updateTag(storeTag(member.store.slug));
  redirect(`/admin/${member.store.slug}/${type === "article" ? "articles" : "pages"}?deleted=1`);
}

/** Chooses the page shown as the store's front page (D54), or the product list. */
export async function setFrontPageAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const choice = String(form.get("frontPage") ?? "");
  if (choice !== "" && !isId(choice)) return { status: "error", messages: ["Unknown page."] };
  const result = await setFrontPage(member.account, member.store.id, choice || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(member.store.slug));
  return {
    status: "ok",
    messages: [choice ? "Saved. Your store opens with this page now." : "Saved. Your store opens with its products now."],
  };
}

// Saved rows, columns and components: the store's own (D46, D53).

export async function createStorePartAction(storeSlug: string, input: unknown): Promise<SavedResult> {
  const member = await requireMember(storeSlug);
  return createSavedPart(member.account, member.store.id, input);
}

export async function updateStorePartAction(storeSlug: string, id: string, input: unknown): Promise<SavedResult> {
  const member = await requireMember(storeSlug);
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return updateSavedPart(member.account, member.store.id, id, input);
}

export async function deleteStorePartAction(storeSlug: string, id: string): Promise<SavedResult> {
  const member = await requireMember(storeSlug);
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return deleteSavedPart(member.account, member.store.id, id);
}

// The store's page and article categories and tags (D50, D57).

const termScope = (member: Membership, type: PageType) => ({ storeId: member.store.id, contentType: type }) as const;

function termsChanged(member: Membership, type: PageType, result: TermsResult): TermsResult {
  if (result.ok) {
    updateTag(termsTag(termScope(member, type)));
    pagesChanged(member);
  }
  return result;
}

const unknownTerm: TermsResult = { ok: false, problems: ["Unknown category or tag."] };

export async function createStorePageTermAction(storeSlug: string, type: PageType, input: unknown): Promise<TermsResult> {
  const member = await requireMember(storeSlug);
  if (!isType(type)) return unknownTerm;
  return termsChanged(member, type, await createTerm(member.account, termScope(member, type), input));
}

export async function updateStorePageTermAction(storeSlug: string, type: PageType, id: string, input: unknown): Promise<TermsResult> {
  const member = await requireMember(storeSlug);
  if (!isType(type) || !isId(id)) return unknownTerm;
  return termsChanged(member, type, await updateTerm(member.account, termScope(member, type), id, input));
}

export async function deleteStorePageTermAction(storeSlug: string, type: PageType, id: string): Promise<TermsResult> {
  const member = await requireMember(storeSlug);
  if (!isType(type) || !isId(id)) return unknownTerm;
  return termsChanged(member, type, await deleteTerm(member.account, termScope(member, type), id));
}

// Content grids (D51): the store's own pages and products, in its first market in the editor.

export async function storeGridPreviewAction(
  storeSlug: string,
  block: unknown,
  pageId: string | null,
): Promise<GridData | { problem: string }> {
  const member = await requireMember(storeSlug);
  const parsed = pageBlockSchema.safeParse(block);
  if (!parsed.success || parsed.data.type !== "contentGrid") {
    return { problem: parsed.success ? "Not a content grid." : parsed.error.issues[0].message };
  }
  return gridData(parsed.data, {
    pageId: pageId !== null && isId(pageId) ? pageId : null,
    owner: member.store.id,
    market: member.store.markets[0]?.code,
  });
}

/** The store's own product categories and tags, whatever store the grid names. */
export async function storeGridTermsAction(storeSlug: string, _storeId: string): Promise<Term[]> {
  void _storeId;
  const member = await requireMember(storeSlug);
  return listTerms({ storeId: member.store.id, contentType: "product" });
}
