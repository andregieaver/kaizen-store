import "server-only";

import { themeSwatches } from "@/lib/colour";
import { breakpointsOf } from "@/lib/breakpoints";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { designPreviewPath } from "@/lib/design-presets";
import { themeSetsOf } from "@/lib/page-a11y";
import { reservedPageSlugs, type PageType } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { marketPath, storeBase, storeHref, storeOrigin } from "@/lib/paths";
import { siteUrl } from "@/lib/site";
import { themeAttributes, themeCss } from "@/lib/theme";
import type { DesignWorkspace } from "@/server/design-presets";
import { siteFontStyle } from "@/server/fonts";
import { uploadsEnabled } from "@/server/media";
import { storeMenuPreviews } from "@/server/menus";
import type { Store } from "@/server/stores";

import { planMotionAction } from "../../pages/motion-action";
import {
  createWorkspacePartAction,
  createWorkspaceTermAction,
  deleteWorkspacePartAction,
  duplicateWorkspacePageAction,
  installWorkspaceFontAction,
  removeWorkspacePageAction,
  saveWorkspaceCssAction,
  saveWorkspacePageAction,
  startWorkspaceVideoAction,
  unpublishWorkspacePageAction,
  updateWorkspacePartAction,
  uploadWorkspaceImageAction,
  workspaceGridPreviewAction,
  workspaceGridTermsAction,
  workspaceLinkTargetsAction,
} from "./workspace-actions";

/**
 * The page editor's context for a design profile's header, footer or product layout (D177): the same editor and builder as a store's, on the
 * profile's workspace store, with actions bound to the profile (each checks the platform admin and the workspace again, never a store's own
 * actions), saving drafts only (`draftOnly`). No custom fields, templates or translations: a profile carries none of them (D176).
 */
export async function workspacePageContext(store: Store, workspace: DesignWorkspace, type: PageType, adminBase: string): Promise<PageOwnerContext> {
  const market = store.markets[0];
  const menus = await storeMenuPreviews(store, market?.locale ?? "nb-NO", market?.lang ?? "nb");
  const bind = <A extends unknown[], R>(action: (presetId: string, ...args: A) => R) => action.bind(null, workspace.presetId);
  return {
    owner: store.id,
    type,
    defaultAuthor: "",
    adminBase,
    siteBase: storeHref(store.slug, market ? marketPath(store.slug, market.slug) : storeBase(store.slug)),
    origin: storeOrigin(store.slug) ? "" : siteUrl(),
    // A profile keeps no words in other languages (D176): the workspace is written in its main language only.
    languages: pageLanguages(store.localization.locales.slice(0, 1)),
    reserved: reservedPageSlugs(store.id, type),
    defaultDescription: store.name,
    upload: uploadsEnabled() ? bind(uploadWorkspaceImageAction) : null,
    startVideo: uploadsEnabled() ? bind(startWorkspaceVideoAction) : null,
    gridStores: [],
    fonts: { site: store.fonts, style: siteFontStyle(store.fonts) },
    menus,
    standardMenus: { header: store.headerMenuId, footer: store.footerMenuId },
    menusHref: adminBase,
    plans: null,
    theme: { css: themeCss(store.theme.settings, "[data-theme-canvas]"), attributes: themeAttributes(store.theme.settings), breakpoints: breakpointsOf(store.theme.settings) },
    templates: null,
    check: { theme: themeSetsOf(store.theme.settings), checkoutPageId: null },
    colours: themeSwatches(store.theme.settings),
    variantOf: null,
    experimentsHref: null,
    fields: null,
    siteCss: store.customCss,
    draftOnly: {
      preview: designPreviewPath(workspace.presetId, null, true, true),
      note: "Saved here, it is the profile's draft: stores get it when the profile is published.",
    },
    actions: {
      save: saveWorkspacePageAction.bind(null, workspace.presetId, type),
      unpublish: unpublishWorkspacePageAction,
      remove: removeWorkspacePageAction,
      duplicate: duplicateWorkspacePageAction,
      motion: planMotionAction.bind(null, type),
      createTerm: createWorkspaceTermAction,
      createPart: bind(createWorkspacePartAction),
      updatePart: bind(updateWorkspacePartAction),
      deletePart: bind(deleteWorkspacePartAction),
      gridPreview: bind(workspaceGridPreviewAction),
      gridTerms: bind(workspaceGridTermsAction),
      linkTargets: workspaceLinkTargetsAction.bind(null, workspace.presetId, store.localization.locales[0] ?? "en-GB"),
      installFont: bind(installWorkspaceFontAction),
      saveSiteCss: bind(saveWorkspaceCssAction),
      translate: null,
    },
  };
}
