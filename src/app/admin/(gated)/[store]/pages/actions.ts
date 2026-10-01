"use server";

import { updateTag } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import type { PageSaveState } from "@/components/admin/page-context";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import type { GridData } from "@/lib/content-grid";
import { PAGE_TYPES, pageBlockSchema, type PageType, termContentOf } from "@/lib/page-content";
import type { Term } from "@/lib/taxonomy";
import { translateRequest, type TranslateResult } from "@/lib/page-translate-ai";
import { AiError, aiFor } from "@/server/ai";
import { db } from "@/db/client";
import { requireMember, type Membership } from "@/server/auth";
import { fieldsTag, pageFacts, saveFieldData } from "@/server/custom-fields";
import { recommendedGridData } from "@/server/recommend-grid";
import { translatePageTexts } from "@/server/page-translate";
import { deletePage, getPageForEdit, pagesTag, savePage, setFrontPage, setPageRole, setProductsPage, unpublishPage } from "@/server/pages";
import { createRolePage } from "@/server/page-roles";
import { runningTestOf, testOfVersionPage } from "@/server/experiment-admin";
import { isPageRole, ROLE_COPY } from "@/lib/page-roles";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { PART_SHARING, TEMPLATE_SOURCES, type PartSharing, type TemplateItem, type TemplateResult, type TemplateSource } from "@/lib/templates";
import type { SavedPart } from "@/lib/saved-parts";
import { applyTemplate, listTemplates, setPartSharing, setTemplateActive } from "@/server/templates";
import { saveSiteCss } from "@/server/site-css";
import { chooseSiteLayout, type SiteLayoutType } from "@/server/site-layouts";
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
  // A page in a running A/B test (D148), the original or a version, keeps what visitors are compared on until the test stops.
  if (publish === true && id !== null && type !== "article") {
    const test = await runningTestOf(member.store.id, id);
    if (test) return { status: "error", problems: [`This page is in the running A/B test "${test.name}". Publishing a change now would spoil its results: save it as a draft, or stop the test first.`] };
  }
  // A version made for an A/B test (D148) holds what the page it is a version of may hold.
  const variantOf = type === "variant" && id !== null ? ((await testOfVersionPage(member.store.id, id))?.targetType ?? null) : null;
  const result = await savePage(member.account, member.store.id, id, json, { publish: publish === true, type, variantOf });
  if (!result.ok) return { status: "error", problems: result.problems };
  // Custom fields (D118) come along with the page's JSON; the page is saved, and its fields are checked against the store's groups.
  const fields = typeof json === "object" && json !== null ? (json as { fields?: unknown }).fields : undefined;
  if ((type === "page" || type === "article") && fields !== undefined) {
    const locales = member.store.localization.locales;
    const problems = await db().transaction(async (tx) => {
      const facts = await pageFacts(tx, member.store.id, result.id, "draft");
      if (!facts) return [];
      return saveFieldData(tx, member.store.id, type, result.id, fields, { facts, locales, main: locales[0] ?? "", requireAll: false });
    });
    updateTag(fieldsTag(member.store.id));
    if (problems.length > 0) {
      return { status: "error", problems: [`The ${type} was saved, but not its custom fields:`, ...problems] };
    }
  }
  // A global part's change (D98) reaches live pages even when this page is only a draft.
  if (publish || result.pages) pagesChanged(member);
  const page = await getPageForEdit(member.store.id, result.id, type);
  if (!page) return { status: "error", problems: ["The page was saved but could not be read back."] };
  return { status: "saved", page };
}

export async function unpublishStorePageAction(storeSlug: string, type: PageType, id: string): Promise<PageSaveState> {
  const member = await requireMember(storeSlug);
  if (!isType(type) || !isId(id)) return { status: "error", problems: ["Unknown page."] };
  const test = await runningTestOf(member.store.id, id);
  if (test) return { status: "error", problems: [`This page is in the running A/B test "${test.name}". Stop the test before unpublishing it.`] };
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
  // A page that is in an A/B test, running or not, is held by the test (D148): delete the test first.
  const [tested] = await db().execute<Record<string, unknown>>(sql`
    select 1 as one from commerce.experiments e where e.store_id = ${member.store.id}::uuid and e.target_page_id = ${id}::uuid
    union all select 1 from commerce.experiment_variants v where v.store_id = ${member.store.id}::uuid and v.page_id = ${id}::uuid limit 1
  `);
  if (tested) return { problems: ["This page is part of an A/B test. Delete the test (a draft) or keep the page: a test that has run keeps its pages."] };
  await deletePage(member.account, member.store.id, id, type);
  pagesChanged(member);
  // A deleted front page (D54) gives the store its product list back.
  if (member.store.frontPageId === id || member.store.productsPageId === id || Object.values(member.store.pageRoles).includes(id)) updateTag(storeTag(member.store.slug));
  redirect(`/admin/${member.store.slug}/${PAGE_TYPE_COPY[type].segment}?deleted=1`);
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

/** Chooses the page shown as the store's All products page at /products (D83), or the standard list. */
export async function setProductsPageAction(storeSlug: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const choice = String(form.get("productsPage") ?? "");
  if (choice !== "" && !isId(choice)) return { status: "error", messages: ["Unknown page."] };
  const result = await setProductsPage(member.account, member.store.id, choice || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(member.store.slug));
  return {
    status: "ok",
    messages: [choice ? "Saved. All products shows this page now." : "Saved. All products shows the standard list now."],
  };
}

/** Chooses the page for one of the store's special places (D112): its blog, search page or 404 page, or the standard one. */
export async function setPageRoleAction(storeSlug: string, role: string, _state: FormState, form: FormData): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!isPageRole(role)) return { status: "error", messages: ["Unknown page."] };
  const choice = String(form.get("page") ?? "");
  if (choice !== "" && !isId(choice)) return { status: "error", messages: ["Unknown page."] };
  const result = await setPageRole(member.account, member.store.id, role, choice || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(member.store.slug));
  pagesChanged(member);
  const name = ROLE_COPY[role].name.toLowerCase();
  return { status: "ok", messages: [choice ? `Saved. Your ${name} is this page now.` : `Saved. Your ${name} is the standard one now.`] };
}

/** Makes a starter page for one of the store's special places, published and in place, to change in the builder (D112). */
export async function createRolePageAction(storeSlug: string, role: string): Promise<FormState> {
  const member = await requireMember(storeSlug);
  if (!isPageRole(role)) return { status: "error", messages: ["Unknown page."] };
  const result = await createRolePage(member, role);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(storeTag(member.store.slug));
  pagesChanged(member);
  redirect(`/admin/${member.store.slug}/pages/${result.id}`);
}

/** Which of the store's headers or footers it shows (D80), or the standard one; every page follows at once. */
export async function chooseStoreSiteLayoutAction(
  storeSlug: string,
  type: SiteLayoutType,
  _state: FormState,
  form: FormData,
): Promise<FormState> {
  const member = await requireMember(storeSlug);
  const choice = String(form.get("layout") ?? "");
  if (choice !== "" && !isId(choice)) return { status: "error", messages: [`Unknown ${type}.`] };
  const result = await chooseSiteLayout(member.account, member.store.id, type, choice || null);
  if (!result.ok) return { status: "error", messages: result.problems };
  updateTag(pagesTag(member.store.id));
  return { status: "ok", messages: [choice ? `Saved. Your store shows this ${type} now.` : `Saved. Your store shows the standard ${type} now.`] };
}

/** The store's own CSS for every page of its storefront (D100): live at once. */
export async function saveStoreCssAction(storeSlug: string, css: unknown): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const member = await requireMember(storeSlug);
  const result = await saveSiteCss(member.account, member.store.id, css);
  if (result.ok) updateTag(storeTag(member.store.slug));
  return result;
}

// Saved rows, columns and components: the store's own (D46, D53).

export async function createStorePartAction(storeSlug: string, input: unknown): Promise<SavedResult> {
  const member = await requireMember(storeSlug);
  return createSavedPart(member.account, member.store.id, input);
}

export async function updateStorePartAction(storeSlug: string, id: string, input: unknown): Promise<SavedResult> {
  const member = await requireMember(storeSlug);
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  const result = await updateSavedPart(member.account, member.store.id, id, input);
  if (result.ok && result.pages) pagesChanged(member);
  return result;
}

export async function deleteStorePartAction(storeSlug: string, id: string): Promise<SavedResult> {
  const member = await requireMember(storeSlug);
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  const result = await deleteSavedPart(member.account, member.store.id, id);
  if (result.ok && result.pages) pagesChanged(member);
  return result;
}

// Templates (D125): saved parts shared with the owner's other stores or the marketplace. The server decides what
// the store may see; these only check what the browser sent.

const unknownTemplate = { ok: false, problems: ["Unknown template."] } satisfies TemplateResult;

/** The templates the store may see from a source, active or not. */
export async function templatesListAction(storeSlug: string, source: TemplateSource): Promise<TemplateItem[]> {
  const member = await requireMember(storeSlug);
  if (!TEMPLATE_SOURCES.includes(source)) return [];
  return listTemplates(member.store.id, member.account, source);
}

/** Switches a template on or off for the store's builder. */
export async function setTemplateActiveAction(storeSlug: string, id: string, active: boolean): Promise<TemplateResult> {
  const member = await requireMember(storeSlug);
  if (!isId(id) || typeof active !== "boolean") return unknownTemplate;
  return setTemplateActive(member.store.id, member.account, id, active);
}

/** A copy of a template for the page, with the other store's own things left out and its pictures copied here. */
export async function applyTemplateAction(storeSlug: string, id: string): Promise<TemplateResult<{ part: SavedPart }>> {
  const member = await requireMember(storeSlug);
  if (!isId(id)) return unknownTemplate;
  return applyTemplate(member.store.id, member.account, id);
}

/** Who can use one of the store's saved parts as a template; owners only. */
export async function setPartSharingAction(storeSlug: string, id: string, sharing: PartSharing): Promise<TemplateResult> {
  const member = await requireMember(storeSlug);
  if (!isId(id) || !PART_SHARING.includes(sharing)) return unknownTemplate;
  return setPartSharing(member.store.id, member.account, id, sharing);
}

// The store's page and article categories and tags (D50, D57).

const termScope = (member: Membership, type: PageType) => ({ storeId: member.store.id, contentType: termContentOf(type) }) as const;

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
  // A grid that recommends (D139) previews what the page shows everyone before a shopper's own session.
  return recommendedGridData(parsed.data, {
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

/**
 * A page's texts translated with the store's AI (D109): from the page as it
 * is in the editor, even unsaved. Only suggestions come back; the editor
 * puts them in the language's translation and staff save.
 */
export async function translateStorePageAction(storeSlug: string, request: unknown): Promise<TranslateResult> {
  const member = await requireMember(storeSlug);
  const parsed = translateRequest.safeParse(request);
  if (!parsed.success) return { ok: false, problem: "The texts could not be read. Reload the page and try again." };
  const languages = member.store.localization.locales;
  const connection = await aiFor(member.store.id, { feature: "page_translation", accountId: member.account.id });
  if (!connection?.textModel) return { ok: false, problem: "The store has no AI text model. Choose one under Settings → AI." };
  if (languages.length < 2) return { ok: false, problem: "The store has only one language." };
  try {
    const { done, skipped } = await translatePageTexts(connection, { accountId: member.account.id, storeId: member.store.id }, parsed.data);
    return { ok: true, done, skipped };
  } catch (error) {
    return { ok: false, problem: error instanceof AiError ? `The AI could not translate: ${error.message}` : "The AI could not translate. Try again." };
  }
}
