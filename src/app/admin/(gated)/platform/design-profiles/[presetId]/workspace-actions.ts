"use server";

import { refresh, updateTag } from "next/cache";
import { sql } from "drizzle-orm";
import { z } from "zod";

import type { FormState } from "@/components/admin/action-form";
import type { PageSaveState } from "@/components/admin/page-context";
import { db } from "@/db/client";
import type { GridData } from "@/lib/content-grid";
import { DESIGN_LAYOUT_KINDS, LAYOUT_PAGE_TYPE, type DesignLayoutKind } from "@/lib/design-presets";
import { pageBlockSchema, type PageType } from "@/lib/page-content";
import type { Term } from "@/lib/taxonomy";
import { requirePlatformAdmin, type Account } from "@/server/auth";
import { chooseWorkspaceLayout, designTags, workspaceOf, type DesignWorkspace } from "@/server/design-presets";
import { installFont } from "@/server/fonts";
import { itemLinkTargets, type ItemLinkTargets } from "@/server/link-targets";
import { startVideoUpload, type UploadResult, type VideoUpload } from "@/server/media";
import { registerVideo, uploadToLibrary } from "@/server/media-library";
import { getPageForEdit, savePage } from "@/server/pages";
import { recommendedGridData } from "@/server/recommend-grid";
import { createSavedPart, deleteSavedPart, updateSavedPart, type SavedResult } from "@/server/saved-parts";
import { saveSiteCss } from "@/server/site-css";
import { listTerms, type TermsResult } from "@/server/taxonomy";
import { deleteSavedTheme, saveSavedTheme, saveStoreTheme } from "@/server/themes";

/**
 * A design profile's editor (D177): the theme, header, footer, product layout and CSS of the profile's workspace, edited from the profile's
 * own pages with the store builders' components. Every action is bound to the profile's id and checks, every time, that the person runs the
 * platform and that what it changes is that profile's workspace (`workspaceOf()`; never a store's own actions, never another store). The
 * builder only saves drafts here: what stores apply changes when the profile is published.
 */

const NOT_YOURS = "Only Kaizen's admins edit design profiles.";
const isId = (id: unknown): id is string => typeof id === "string" && z.uuid().safeParse(id).success;

/** The admin and the profile's workspace, or null: the check every action starts with. */
async function workspace(presetId: string): Promise<{ admin: Account; workspace: DesignWorkspace } | null> {
  const admin = await requirePlatformAdmin();
  const found = await workspaceOf(admin, presetId);
  return found ? { admin, workspace: found } : null;
}

/** The workspace's look changed: its own storefront and the admin's pages draw it again. */
function changed(found: DesignWorkspace) {
  for (const tag of designTags(found.store)) updateTag(tag);
}

const LAYOUT_KIND: Partial<Record<PageType, DesignLayoutKind>> = { header: "header", footer: "footer", product_layout: "productLayout" };

/** Whether a page is the workspace's chosen header, footer or product layout of that type: the only pages its builder saves. */
async function isWorkspaceLayout(found: DesignWorkspace, type: PageType, id: string): Promise<boolean> {
  const kind = LAYOUT_KIND[type];
  if (!kind) return false;
  const column = sql.raw(kind === "header" ? "header_id" : kind === "footer" ? "footer_id" : "product_layout_id");
  const [row] = await db().execute<Record<string, unknown>>(sql`
    select 1 as ok from commerce.stores s join commerce.pages p on p.store_id = s.id and p.id = s.${column}
    where s.id = ${found.store.id}::uuid and p.id = ${id}::uuid and p.type = ${LAYOUT_PAGE_TYPE[kind]}
  `);
  return row !== undefined;
}

// --- The builder (PageOwnerContext.actions) --------------------------------------------------

/** Saves the header, footer or product layout as the profile's draft; `publish` is not honoured here (the profile is published as a whole). */
export async function saveWorkspacePageAction(presetId: string, type: PageType, id: string | null, payload: string): Promise<PageSaveState> {
  const found = await workspace(presetId);
  if (!found) return { status: "error", problems: [NOT_YOURS] };
  if (!isId(id) || !(await isWorkspaceLayout(found.workspace, type, id))) return { status: "error", problems: ["Unknown page."] };
  let json: unknown;
  try {
    json = JSON.parse(payload);
  } catch {
    return { status: "error", problems: ["The page could not be read. Reload and try again."] };
  }
  const result = await savePage(found.admin, found.workspace.store.id, id, json, { publish: false, type });
  if (!result.ok) return { status: "error", problems: result.problems, code: result.code, issues: result.issues };
  changed(found.workspace);
  const page = await getPageForEdit(found.workspace.store.id, result.id, type);
  if (!page) return { status: "error", problems: ["The page was saved but could not be read back."] };
  return { status: "saved", page };
}

const WHOLE = "A design profile's header, footer and product layout are published with the profile, from its own page.";

export async function unpublishWorkspacePageAction(): Promise<PageSaveState> {
  return { status: "error", problems: [WHOLE] };
}

export async function removeWorkspacePageAction(): Promise<{ problems: string[] }> {
  return { problems: [`${WHOLE} Choose the standard one there instead of deleting it.`] };
}

export async function duplicateWorkspacePageAction(): Promise<{ ok: false; problems: string[] }> {
  return { ok: false, problems: [WHOLE] };
}

export async function createWorkspaceTermAction(): Promise<TermsResult> {
  return { ok: false, problems: ["Headers, footers and product layouts have no categories or tags."] };
}

export async function createWorkspacePartAction(presetId: string, input: unknown): Promise<SavedResult> {
  const found = await workspace(presetId);
  if (!found) return { ok: false, problems: [NOT_YOURS] };
  return createSavedPart(found.admin, found.workspace.store.id, input);
}

export async function updateWorkspacePartAction(presetId: string, id: string, input: unknown): Promise<SavedResult> {
  const found = await workspace(presetId);
  if (!found) return { ok: false, problems: [NOT_YOURS] };
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return updateSavedPart(found.admin, found.workspace.store.id, id, input);
}

export async function deleteWorkspacePartAction(presetId: string, id: string): Promise<SavedResult> {
  const found = await workspace(presetId);
  if (!found) return { ok: false, problems: [NOT_YOURS] };
  if (!isId(id)) return { ok: false, problems: ["Unknown saved part."] };
  return deleteSavedPart(found.admin, found.workspace.store.id, id);
}

/** A content grid of the workspace's own (demo) products, as the builder previews it. */
export async function workspaceGridPreviewAction(presetId: string, block: unknown, pageId: string | null): Promise<GridData | { problem: string }> {
  const found = await workspace(presetId);
  if (!found) return { problem: NOT_YOURS };
  const parsed = pageBlockSchema.safeParse(block);
  if (!parsed.success || parsed.data.type !== "contentGrid") return { problem: parsed.success ? "Not a content grid." : parsed.error.issues[0].message };
  const [market] = await db().execute<Record<string, unknown>>(sql`
    select code from commerce.markets where store_id = ${found.workspace.store.id}::uuid and active order by created_at, code limit 1
  `);
  return recommendedGridData(parsed.data, {
    pageId: isId(pageId) ? pageId : null,
    owner: found.workspace.store.id,
    market: market ? String(market.code) : undefined,
  });
}

export async function workspaceGridTermsAction(presetId: string): Promise<Term[]> {
  const found = await workspace(presetId);
  if (!found) return [];
  return listTerms({ storeId: found.workspace.store.id, contentType: "product" });
}

export async function workspaceLinkTargetsAction(presetId: string, locale: string): Promise<ItemLinkTargets> {
  const found = await workspace(presetId);
  if (!found) return { kinds: [], targets: {} };
  return itemLinkTargets(found.workspace.store.id, locale);
}

/** The workspace's CSS for every page (D100): the profile's CSS, saved as its draft. */
export async function saveWorkspaceCssAction(presetId: string, css: unknown): Promise<{ ok: true } | { ok: false; problems: string[] }> {
  const found = await workspace(presetId);
  if (!found) return { ok: false, problems: [NOT_YOURS] };
  const result = await saveSiteCss(found.admin, found.workspace.store.id, css);
  if (result.ok) changed(found.workspace);
  return result;
}

/** The CSS tab's form (D177): the same save, from a plain form. */
export async function saveWorkspaceCssFormAction(presetId: string, _state: FormState, formData: FormData): Promise<FormState> {
  const result = await saveWorkspaceCssAction(presetId, String(formData.get("css") ?? ""));
  if (!result.ok) return { status: "error", messages: result.problems };
  refresh();
  return { status: "ok", messages: ["Saved in the draft. Stores get it when the profile is published."] };
}

export async function installWorkspaceFontAction(presetId: string, fontFamily: string) {
  const found = await workspace(presetId);
  if (!found) return { ok: false as const, problem: NOT_YOURS };
  return installFont(String(fontFamily));
}

export async function uploadWorkspaceImageAction(presetId: string, formData: FormData): Promise<UploadResult> {
  const found = await workspace(presetId);
  if (!found) return { ok: false, problem: NOT_YOURS };
  // Kept in the workspace's media library (D88): applying the published profile copies them from there into the store.
  return uploadToLibrary({ storeId: found.workspace.store.id, accountId: found.admin.id }, formData);
}

const videoFile = z.object({ name: z.string().max(255).optional(), type: z.string().max(100), size: z.number().int().nonnegative() });

export async function startWorkspaceVideoAction(presetId: string, file: unknown): Promise<VideoUpload> {
  const found = await workspace(presetId);
  if (!found) return { ok: false, problem: NOT_YOURS };
  const parsed = videoFile.safeParse(file);
  if (!parsed.success) return { ok: false, problem: "Choose a video to upload." };
  const started = await startVideoUpload(found.workspace.store.id, parsed.data);
  if (started.ok) await registerVideo({ storeId: found.workspace.store.id, accountId: found.admin.id }, started, parsed.data);
  return started;
}

// --- The theme (ThemeEditor's actions) -------------------------------------------------------

const read = (payload: string): unknown => {
  try {
    return JSON.parse(payload);
  } catch {
    return null;
  }
};

export async function saveWorkspaceThemeAction(presetId: string, payload: string) {
  const found = await workspace(presetId);
  if (!found) return { ok: false as const, problems: [NOT_YOURS] };
  const result = await saveStoreTheme(found.admin, found.workspace.store.id, read(payload));
  if (result.ok) changed(found.workspace);
  return result;
}

export async function saveWorkspaceSavedThemeAction(presetId: string, payload: string) {
  const found = await workspace(presetId);
  if (!found) return { ok: false as const, problems: [NOT_YOURS] };
  return saveSavedTheme(found.admin, found.workspace.store.id, read(payload));
}

export async function removeWorkspaceSavedThemeAction(presetId: string, id: string) {
  const found = await workspace(presetId);
  if (!found) return { ok: false };
  return { ok: await deleteSavedTheme(found.admin, found.workspace.store.id, String(id)) };
}

// --- Which header, footer and product layout -------------------------------------------------

/** The standard header, footer or product layout for the profile, or one of its own to build (made as the standard one to change from). */
export async function chooseWorkspaceLayoutAction(presetId: string, kind: string, choice: string): Promise<FormState> {
  const admin = await requirePlatformAdmin();
  if (!(DESIGN_LAYOUT_KINDS as readonly string[]).includes(kind) || (choice !== "standard" && choice !== "build")) {
    return { status: "error", messages: ["Unknown choice."] };
  }
  const result = await chooseWorkspaceLayout(admin, presetId, kind as DesignLayoutKind, choice);
  if (!result.ok) return { status: "error", messages: result.problems };
  const found = await workspaceOf(admin, presetId);
  if (found) changed(found);
  refresh();
  return { status: "ok", messages: [choice === "standard" ? "The profile uses the standard one now, in its draft." : "Ready to build, in the profile's draft."] };
}
