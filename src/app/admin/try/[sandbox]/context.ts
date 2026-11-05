import "server-only";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { breakpointsOf } from "@/lib/breakpoints";
import { themeSwatches } from "@/lib/colour";
import { EMPTY_LOOKUPS, needsLookups } from "@/lib/custom-fields";
import { t } from "@/lib/i18n";
import { themeSetsOf } from "@/lib/page-a11y";
import { reservedPageSlugs } from "@/lib/page-content";
import { pageLanguages } from "@/lib/page-translation";
import { marketPath, storeBase, storeHref, storeOrigin } from "@/lib/paths";
import { SANDBOX_PATH, sandboxBase, sandboxHome, type SandboxKind } from "@/lib/sandbox";
import { siteUrl } from "@/lib/site";
import { reservedChoiceSlugs } from "@/lib/store-address";
import { themeAttributes, themeCss } from "@/lib/theme";
import { listContentTypes } from "@/server/content-types";
import { allActiveFieldGroups, fieldLookups } from "@/server/custom-fields";
import { siteFontStyle } from "@/server/fonts";
import { storeMenuPreviews } from "@/server/menus";
import { listMenuPages } from "@/server/pages";
import type { Sandbox } from "@/server/sandbox";
import { listTextStyles } from "@/server/text-styles";

import {
  sandboxApplyTemplateAction,
  sandboxCreatePartAction,
  sandboxCreateTermAction,
  sandboxCssVersionAction,
  sandboxCssVersionsAction,
  sandboxDeletePartAction,
  sandboxDeleteTextStyleAction,
  sandboxDuplicateAction,
  sandboxGridPreviewAction,
  sandboxGridTermsAction,
  sandboxInstallFontAction,
  sandboxLinkTargetsAction,
  sandboxMotionAction,
  sandboxPickMediaAction,
  sandboxPlaceThemeSectionAction,
  sandboxRemoveAction,
  sandboxSaveAction,
  sandboxSaveCssAction,
  sandboxSaveLibraryAction,
  sandboxSaveTextStyleAction,
  sandboxSaveThemeTabAction,
  sandboxSetPartSharingAction,
  sandboxSetTemplateActiveAction,
  sandboxTemplatesListAction,
  sandboxThemeSectionsAction,
  sandboxUnpublishAction,
  sandboxUpdatePartAction,
  sandboxVersionAction,
  sandboxVersionsAction,
  sandboxVisibilityChoicesAction,
} from "./actions";

/**
 * The page editor's context in a sandbox (D457, `docs/builder-sandbox.md` 4.3): the store's own context's sibling, with every action one
 * of the sandbox's wrappers (`./actions.ts`: the pass first, then the store's server function) bound to the sandbox's id. Only what is wired
 * here exists. Step S1 leaves out uploads, every AI (motion takes the rules' plan), scheduling, share links, A/B tests, translation, a
 * second page beside this one and sharing a saved part with other stores; every link stays inside `/admin/try/{sandbox}`.
 */
export async function sandboxPageContext(sandbox: Sandbox, type: SandboxKind): Promise<PageOwnerContext> {
  const { store, id } = sandbox;
  const market = store.markets[0];
  const [menus, fieldGroups, parents, contentTypes, textStyles] = await Promise.all([
    storeMenuPreviews(store, market?.locale ?? "nb-NO", market?.lang ?? "nb"),
    allActiveFieldGroups(store.id),
    listMenuPages(store.id, "page"),
    listContentTypes(store.id),
    listTextStyles(store.id),
  ]);
  const lookups = needsLookups(fieldGroups) ? await fieldLookups(store.id) : EMPTY_LOOKUPS;
  const bind = <A extends unknown[], R>(action: (sandboxId: string, ...args: A) => R) => action.bind(null, id);
  const typed = <A extends unknown[], R>(action: (sandboxId: string, kind: SandboxKind, ...args: A) => R) => action.bind(null, id, type);
  return {
    owner: store.id,
    features: store.features,
    type,
    defaultAuthor: "",
    blog: null,
    schedule: null,
    share: null,
    adminBase: sandboxBase(id, type),
    dualPages: null,
    siteBase: storeHref(store.slug, market ? marketPath(store.slug, market.slug) : storeBase(store.slug)),
    origin: storeOrigin(store.slug) ? "" : siteUrl(),
    languages: pageLanguages(store.localization.locales),
    ...(type === "page" && store.keptMarkets.length > 1 && { countries: store.keptMarkets.map((m) => m.code) }),
    viewCountry: store.markets[0]?.code,
    reserved: [...reservedPageSlugs(store.id, type), ...(type === "page" ? reservedChoiceSlugs(store.address) : [])],
    parents: parents.map(({ slug, title }) => ({ slug, title })),
    contentTypes: contentTypes.map(({ key, name, fields }) => ({ key, name, fields })),
    defaultDescription: (market && store.seo.description[market.locale]) || (market ? t(market.lang).storeSummary(store.name, market.name) : store.name),
    media: bind(sandboxPickMediaAction),
    upload: null,
    pictures: null,
    pictureEdit: null,
    aiChange: null,
    signupCodes: [],
    startVideo: null,
    gridStores: [],
    fonts: { site: store.fonts, style: siteFontStyle(store.fonts) },
    menus,
    standardMenus: { header: store.headerMenuId, footer: store.footerMenuId },
    menusHref: sandboxHome(id),
    plans: null,
    theme: {
      css: themeCss(store.theme.settings, "[data-theme-canvas]"),
      attributes: themeAttributes(store.theme.settings),
      breakpoints: breakpointsOf(store.theme.settings),
      settings: store.theme.settings,
    },
    check: { theme: themeSetsOf(store.theme.settings), checkoutPageId: store.pageRoles.checkout ?? null },
    colours: themeSwatches(store.theme.settings),
    variantOf: null,
    experimentsHref: null,
    // The sandbox's own templates only, as in Kaizena Flow's own builder: nothing to preview for another store, nothing to share.
    templates: {
      list: bind(sandboxTemplatesListAction),
      setActive: bind(sandboxSetTemplateActiveAction),
      use: bind(sandboxApplyTemplateAction),
      setSharing: bind(sandboxSetPartSharingAction),
      previewStore: null,
      previewBase: `${SANDBOX_PATH}/templates/${id}`,
    },
    themeSections: type === "page" ? { list: bind(sandboxThemeSectionsAction), place: bind(sandboxPlaceThemeSectionAction) } : null,
    fields: { groups: fieldGroups, lookups, startFile: null },
    siteCss: store.customCss,
    textStyles: { styles: textStyles, save: bind(sandboxSaveTextStyleAction), remove: bind(sandboxDeleteTextStyleAction) },
    actions: {
      save: typed(sandboxSaveAction),
      unpublish: typed(sandboxUnpublishAction),
      remove: typed(sandboxRemoveAction),
      duplicate: typed(sandboxDuplicateAction),
      versions: { list: typed(sandboxVersionsAction), read: typed(sandboxVersionAction) },
      motion: typed(sandboxMotionAction),
      createTerm: typed(sandboxCreateTermAction),
      createPart: bind(sandboxCreatePartAction),
      updatePart: bind(sandboxUpdatePartAction),
      deletePart: bind(sandboxDeletePartAction),
      gridPreview: bind(sandboxGridPreviewAction),
      gridTerms: bind(sandboxGridTermsAction),
      linkTargets: bind(sandboxLinkTargetsAction),
      visibilityChoices: bind(sandboxVisibilityChoicesAction),
      installFont: bind(sandboxInstallFontAction),
      saveThemeTab: bind(sandboxSaveThemeTabAction),
      saveLibrary: bind(sandboxSaveLibraryAction),
      saveSiteCss: bind(sandboxSaveCssAction),
      cssVersions: { list: bind(sandboxCssVersionsAction), read: bind(sandboxCssVersionAction) },
      translate: null,
    },
  };
}
