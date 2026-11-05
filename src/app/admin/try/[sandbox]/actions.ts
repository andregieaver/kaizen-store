"use server";

import { updateTag } from "next/cache";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";

import type { PageSaveState } from "@/components/admin/page-context";
import { db } from "@/db/client";
import { adminText } from "@/lib/admin-text";
import type { CssVersionItem } from "@/lib/css-versions";
import type { GridData } from "@/lib/content-grid";
import type { MotionPlanResult } from "@/lib/motion-plan";
import type { DuplicateResult } from "@/lib/page-duplicate";
import { pageBlockSchema, termContentOf } from "@/lib/page-content";
import type { PageVersionItem } from "@/lib/page-versions";
import { SANDBOX_KINDS, sandboxHome, type SandboxKind } from "@/lib/sandbox";
import type { SavedPart } from "@/lib/saved-parts";
import type { Term } from "@/lib/taxonomy";
import type { TemplateItem, TemplateResult, TemplateSource } from "@/lib/templates";
import type { SectionResult, ThemeSectionsOffer } from "@/lib/theme-sections";
import type { StoreTheme } from "@/lib/theme";
import { KAIZEN_CHOICES, type VisibilityChoices } from "@/lib/visibility";
import { actionAdminLang } from "@/server/admin-request-lang";
import { listCssVersions, readCssVersion } from "@/server/css-versions";
import { fieldsTag, pageFacts, saveFieldData } from "@/server/custom-fields";
import { installFont } from "@/server/fonts";
import { itemLinkTargets, type ItemLinkTargets } from "@/server/link-targets";
import { pickerPictures } from "@/server/media-library";
import { planPageMotion, readMotionRows } from "@/server/motion-ai";
import { duplicatePage } from "@/server/page-duplicate";
import { listVersions, readVersion } from "@/server/page-versions";
import { deletePage, getPageForEdit, pagesTag, savePage, unpublishPage } from "@/server/pages";
import { recommendedGridData } from "@/server/recommend-grid";
import { budgetVisitor, takeBudget } from "@/server/request-budget";
import { endSandbox, noteSandboxChange, passCookie, sandboxFor, startSandbox, type Sandbox } from "@/server/sandbox";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { saveSiteCss } from "@/server/site-css";
import { storeTag } from "@/server/stores";
import { createTerm, listTerms, termsTag, type TermsResult } from "@/server/taxonomy";
import { applyTemplate, listTemplates, setTemplateActive } from "@/server/templates";
import { deleteTextStyle, saveTextStyle, textStylesTag, type DeleteStyleResult, type TextStyleResult } from "@/server/text-styles";
import { placeThemeSection, themeSectionsFor } from "@/server/theme-sections";
import { saveThemeLibrary, saveThemeTab } from "@/server/themes";
import { ruleChoices } from "@/server/visibility";

/**
 * The sandbox's actions (D456, `docs/builder-sandbox.md` 4.3): each opens the sandbox with its pass first (`sandboxFor()`, refusing
 * anything else in the same words), then does what the store's own action does after its access check, with the sandbox's store and the
 * sandbox account. Only these exist: an allow-list. Templates come from the marketplace only, never from "my stores" (one account owns
 * every sandbox, so that source would be every other visitor's). Nothing here sends an email, calls an AI, uploads or reaches outside.
 */

const isId = (id: unknown): id is string => z.uuid().safeParse(id).success;
const isKind = (kind: unknown): kind is SandboxKind => (Object.values(SANDBOX_KINDS) as unknown[]).includes(kind);
const words = async () => adminText(await actionAdminLang(), "sandbox").refused;
const said = async () => adminText(await actionAdminLang(), "website").pageActions;
const gone = async () => (await words()).gone;
const notHere = async () => (await words()).notHere;

/** The sandbox the pass opens, or null; every action asks first. */
const open = (sandboxId: string): Promise<Sandbox | null> => sandboxFor(sandboxId);

const read = (payload: unknown): unknown => {
  try {
    return JSON.parse(String(payload));
  } catch {
    return null;
  }
};

/** A page change shows on the sandbox's own storefront, its menus and grids. */
const pagesChanged = (sandbox: Sandbox) => updateTag(pagesTag(sandbox.store.id));

// The page, header or footer the editor holds.

export async function sandboxSaveAction(
  sandboxId: string,
  kind: SandboxKind,
  id: string | null,
  payload: string,
  publish: boolean,
  acknowledged?: string[],
): Promise<PageSaveState> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { status: "error", problems: [await gone()] };
  if (!isKind(kind) || (id !== null && !isId(id))) return { status: "error", problems: [(await said()).unknownPage] };
  const json = read(payload);
  if (json === null) return { status: "error", problems: [(await said()).unreadable] };
  const { store, account } = sandbox;
  const acknowledgedIssues = Array.isArray(acknowledged) ? acknowledged.filter((a): a is string => typeof a === "string" && a.length <= 120).slice(0, 200) : undefined;
  const result = await savePage(account, store.id, id, json, { publish: publish === true, type: kind, variantOf: null, acknowledgedIssues });
  if (!result.ok) return { status: "error", problems: result.problems, code: result.code, issues: result.issues };
  // Custom fields (D118) come along with a page's JSON, as in the store's own action.
  const fields = typeof json === "object" && json !== null ? (json as { fields?: unknown }).fields : undefined;
  if (kind === "page" && fields !== undefined) {
    const locales = store.localization.locales;
    const problems = await db().transaction(async (tx) => {
      const facts = await pageFacts(tx, store.id, result.id, "draft");
      if (!facts) return [];
      return saveFieldData(tx, store.id, kind, result.id, fields, { facts, locales, main: locales[0] ?? "", requireAll: false });
    });
    updateTag(fieldsTag(store.id));
    if (problems.length > 0) return { status: "error", problems };
  }
  if (publish || result.pages) pagesChanged(sandbox);
  await noteSandboxChange(sandbox.id, publish === true);
  const page = await getPageForEdit(store.id, result.id, kind);
  if (!page) return { status: "error", problems: [(await said()).notReadBack] };
  return { status: "saved", page };
}

export async function sandboxUnpublishAction(sandboxId: string, kind: SandboxKind, id: string): Promise<PageSaveState> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { status: "error", problems: [await gone()] };
  if (!isKind(kind) || !isId(id)) return { status: "error", problems: [(await said()).unknownPage] };
  await unpublishPage(sandbox.account, sandbox.store.id, id, kind);
  pagesChanged(sandbox);
  const page = await getPageForEdit(sandbox.store.id, id, kind);
  if (!page) return { status: "error", problems: [(await said()).gone] };
  return { status: "saved", page };
}

/** Deletes the page and goes back to the sandbox's home; returns only when it could not. */
export async function sandboxRemoveAction(sandboxId: string, kind: SandboxKind, id: string): Promise<{ problems: string[] } | void> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { problems: [await gone()] };
  if (!isKind(kind) || !isId(id)) return { problems: [(await said()).unknownPage] };
  const { store } = sandbox;
  await deletePage(sandbox.account, store.id, id, kind);
  pagesChanged(sandbox);
  // A deleted front page gives the store its product list back.
  if (store.frontPageId === id || store.productsPageId === id || Object.values(store.pageRoles).includes(id)) updateTag(storeTag(store.slug));
  redirect(sandboxHome(sandbox.id));
}

export async function sandboxDuplicateAction(sandboxId: string, kind: SandboxKind, id: string, edited?: string): Promise<DuplicateResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  if (!isKind(kind) || !isId(id)) return { ok: false, problems: [(await said()).unknownPage] };
  let held: unknown;
  if (edited !== undefined) {
    held = read(edited);
    if (held === null) return { ok: false, problems: [(await said()).unreadable] };
  }
  const result = await duplicatePage(sandbox.account, sandbox.store.id, id, kind, held);
  if (!result.ok) return { ok: false, problems: result.problems };
  updateTag(fieldsTag(sandbox.store.id));
  return { ok: true, id: result.id };
}

export async function sandboxVersionsAction(sandboxId: string, kind: SandboxKind, id: string): Promise<PageVersionItem[]> {
  const sandbox = await open(sandboxId);
  if (!sandbox || !isKind(kind) || !isId(id)) return [];
  return listVersions(sandbox.store.id, id, kind);
}

export async function sandboxVersionAction(
  sandboxId: string,
  kind: SandboxKind,
  id: string,
  version: string,
): Promise<{ ok: true; content: string } | { ok: false; problem: string }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problem: await gone() };
  if (!isKind(kind) || !isId(id) || !isId(version)) return { ok: false, problem: await notHere() };
  const content = await readVersion(sandbox.store.id, id, kind, version);
  return content ? { ok: true, content: JSON.stringify(content) } : { ok: false, problem: await notHere() };
}

/** "Make my page cool" (D128): in the sandbox always the rules' plan, never a model's. Nothing is written. */
export async function sandboxMotionAction(sandboxId: string, kind: SandboxKind, rowsJson: string): Promise<MotionPlanResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problem: await gone() };
  if (!isKind(kind)) return { ok: false, problem: await notHere() };
  const rows = readMotionRows(kind, rowsJson);
  if (!rows.ok) return rows;
  return planPageMotion(null, rows.rows);
}

// Categories and tags, saved parts, grids, links and conditions.

export async function sandboxCreateTermAction(sandboxId: string, kind: SandboxKind, input: unknown): Promise<TermsResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  if (!isKind(kind)) return { ok: false, problems: [await notHere()] };
  const scope = { storeId: sandbox.store.id, contentType: termContentOf(kind) } as const;
  const result = await createTerm(sandbox.account, scope, input);
  if (result.ok) {
    updateTag(termsTag(scope));
    pagesChanged(sandbox);
  }
  return result;
}

export async function sandboxCreatePartAction(sandboxId: string, input: unknown): Promise<SavedResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  // A part saved here is the sandbox's own: never shared with other stores, whatever the browser sent.
  const own = typeof input === "object" && input !== null ? { ...input, sharing: "private" } : input;
  return createSavedPart(sandbox.account, sandbox.store.id, own);
}

export async function sandboxUpdatePartAction(sandboxId: string, id: string, input: unknown): Promise<SavedResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  if (!isId(id)) return { ok: false, problems: [(await said()).unknownPart] };
  const own = typeof input === "object" && input !== null ? { ...input, sharing: "private" } : input;
  const result = await updateSavedPart(sandbox.account, sandbox.store.id, id, own);
  if (result.ok && result.pages) pagesChanged(sandbox);
  return result;
}

export async function sandboxDeletePartAction(sandboxId: string, id: string): Promise<SavedResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  if (!isId(id)) return { ok: false, problems: [(await said()).unknownPart] };
  const result = await deleteSavedPart(sandbox.account, sandbox.store.id, id);
  if (result.ok && result.pages) pagesChanged(sandbox);
  return result;
}

export async function sandboxGridPreviewAction(sandboxId: string, block: unknown, pageId: string | null): Promise<GridData | { problem: string }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { problem: await gone() };
  const parsed = pageBlockSchema.safeParse(block);
  if (!parsed.success || parsed.data.type !== "contentGrid") return { problem: parsed.success ? (await said()).notGrid : parsed.error.issues[0].message };
  return recommendedGridData(parsed.data, { pageId: pageId !== null && isId(pageId) ? pageId : null, owner: sandbox.store.id, market: sandbox.store.markets[0]?.code });
}

/** The sandbox's own product categories and tags, whatever store the grid names. */
export async function sandboxGridTermsAction(sandboxId: string, _storeId: string): Promise<Term[]> {
  const sandbox = await open(sandboxId);
  void _storeId;
  return sandbox ? listTerms({ storeId: sandbox.store.id, contentType: "product" }) : [];
}

export async function sandboxLinkTargetsAction(sandboxId: string): Promise<ItemLinkTargets> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { kinds: [], targets: {} };
  return itemLinkTargets(sandbox.store.id, sandbox.store.localization.locales[0] ?? "en-GB");
}

/** What a part's conditions choose from; never the store's companies, which are customers. */
export async function sandboxVisibilityChoicesAction(sandboxId: string): Promise<VisibilityChoices> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ...KAIZEN_CHOICES, owner: "store", languages: [] };
  return ruleChoices(sandbox.store, false);
}

export async function sandboxPickMediaAction(sandboxId: string, query: { q: string; limit: number }) {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { items: [], total: 0 };
  return pickerPictures({ storeId: sandbox.store.id, storeSlug: sandbox.store.slug }, { q: String(query?.q ?? ""), limit: Number(query?.limit) });
}

// The look: the Theme tab, the theme's library, text styles, CSS and fonts.

export async function sandboxSaveThemeTabAction(sandboxId: string, payload: string): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  const result = await saveThemeTab(sandbox.account, sandbox.store, read(payload));
  if (result.ok) {
    updateTag(storeTag(sandbox.store.slug));
    await noteSandboxChange(sandbox.id, false);
  }
  return result;
}

export async function sandboxSaveLibraryAction(sandboxId: string, payload: string): Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  const result = await saveThemeLibrary(sandbox.account, sandbox.store, read(payload));
  if (result.ok) updateTag(storeTag(sandbox.store.slug));
  return result;
}

export async function sandboxSaveTextStyleAction(sandboxId: string, payload: string): Promise<TextStyleResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  const input = read(payload);
  if (input === null) return { ok: false, problems: [(await said()).unreadable] };
  const result = await saveTextStyle(sandbox.account, sandbox.store.id, input);
  if (result.ok) updateTag(textStylesTag(sandbox.store.id));
  return result;
}

export async function sandboxDeleteTextStyleAction(sandboxId: string, slug: string, confirmed: boolean): Promise<DeleteStyleResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  const result = await deleteTextStyle(sandbox.account, sandbox.store.id, String(slug), confirmed === true);
  if (result.ok) updateTag(textStylesTag(sandbox.store.id));
  return result;
}

export async function sandboxSaveCssAction(sandboxId: string, css: unknown): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  const result = await saveSiteCss(sandbox.account, sandbox.store.id, css);
  if (result.ok) updateTag(storeTag(sandbox.store.slug));
  return result;
}

export async function sandboxCssVersionsAction(sandboxId: string): Promise<CssVersionItem[]> {
  const sandbox = await open(sandboxId);
  return sandbox ? listCssVersions(sandbox.store.id) : [];
}

export async function sandboxCssVersionAction(sandboxId: string, version: string): Promise<{ ok: true; css: string } | { ok: false; problem: string }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problem: await gone() };
  const css = await readCssVersion(sandbox.store.id, version);
  return css === null ? { ok: false, problem: await notHere() } : { ok: true, css };
}

/** Copies a Google Fonts family into Kaizena Flow's fonts before a block uses it; a few a sandbox an hour, as each copy is shared. */
export async function sandboxInstallFontAction(sandboxId: string, fontFamily: string): Promise<{ ok: true } | { ok: false; problem: string }> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problem: await gone() };
  if (!(await takeBudget(null, "sandbox_font", sandbox.id))) return { ok: false, problem: await notHere() };
  return installFont(String(fontFamily));
}

// Templates (D125): the marketplace's only (Kaizena Flow's and those shared with everyone), and a signature theme's sections; each
// placed copies its pictures into the sandbox's library, so a few an hour (`sandbox_copy`).

/** The marketplace's templates the sandbox may see; "my stores" is never offered here. */
async function marketplace(sandbox: Sandbox): Promise<TemplateItem[]> {
  return listTemplates(sandbox.store.id, sandbox.account, "marketplace");
}

export async function sandboxTemplatesListAction(sandboxId: string, source: TemplateSource): Promise<TemplateItem[]> {
  const sandbox = await open(sandboxId);
  if (!sandbox || source !== "marketplace") return [];
  return marketplace(sandbox);
}

export async function sandboxSetTemplateActiveAction(sandboxId: string, id: string, active: boolean): Promise<TemplateResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  if (!isId(id) || typeof active !== "boolean" || !(await marketplace(sandbox)).some((t) => t.id === id)) return { ok: false, problems: [await notHere()] };
  return setTemplateActive(sandbox.store.id, sandbox.account, id, active);
}

export async function sandboxApplyTemplateAction(sandboxId: string, id: string): Promise<TemplateResult<{ part: SavedPart }>> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problems: [await gone()] };
  if (!isId(id) || !(await marketplace(sandbox)).some((t) => t.id === id)) return { ok: false, problems: [await notHere()] };
  if (!(await takeBudget(null, "sandbox_copy", sandbox.id))) return { ok: false, problems: [await notHere()] };
  return applyTemplate(sandbox.store.id, sandbox.account, id);
}

/** Sharing a saved part with other stores or the marketplace is never done from a sandbox. */
export async function sandboxSetPartSharingAction(sandboxId: string): Promise<TemplateResult> {
  void sandboxId;
  return { ok: false, problems: [await notHere()] };
}

export async function sandboxThemeSectionsAction(sandboxId: string): Promise<ThemeSectionsOffer> {
  const sandbox = await open(sandboxId);
  return sandbox ? themeSectionsFor(sandbox.store.id) : null;
}

export async function sandboxPlaceThemeSectionAction(sandboxId: string, key: string): Promise<SectionResult> {
  const sandbox = await open(sandboxId);
  if (!sandbox) return { ok: false, problem: await gone() };
  if (!(await takeBudget(null, "sandbox_copy", sandbox.id))) return { ok: false, problem: await notHere() };
  return placeThemeSection(sandbox.store.id, sandbox.account, String(key).slice(0, 60));
}

// Start over: this sandbox ended, a new one made, within the same budget as the first.

export async function startOverAction(sandboxId: string): Promise<void> {
  const sandbox = await open(sandboxId);
  if (sandbox) await endSandbox(sandbox.id);
  const started = await startSandbox(budgetVisitor(await headers()));
  if (!started.ok) redirect(`/admin/try?problem=${started.problem}`);
  (await cookies()).set(passCookie(started.pass));
  redirect(sandboxHome(started.id));
}
