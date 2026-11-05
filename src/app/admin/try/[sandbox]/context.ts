import "server-only";

import type { PageOwnerContext } from "@/components/admin/page-context";
import { PAGE_TYPE_COPY } from "@/components/admin/page-type-copy";
import { blogPath, blogTitle } from "@/lib/blogs";
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
import { requirementMet } from "@/lib/store-features";
import { themeAttributes, themeCss } from "@/lib/theme";
import { authorsNow, blogsNow } from "@/server/blogs";
import { listContentTypes } from "@/server/content-types";
import { allActiveFieldGroups, fieldLookups } from "@/server/custom-fields";
import { siteFontStyle } from "@/server/fonts";
import { uploadsEnabled } from "@/server/media";
import { storeMenuPreviews } from "@/server/menus";
import { canChangePages } from "@/server/page-change-ai";
import { listMenuPages } from "@/server/pages";
import { canEditPictures } from "@/server/picture-editor";
import { canMakePictures } from "@/server/picture-maker";
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
  sandboxDualChoicesAction,
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
  sandboxTranslateAction,
  sandboxUnpublishAction,
  sandboxUploadAction,
  sandboxUpdatePartAction,
  sandboxVersionAction,
  sandboxVersionsAction,
  sandboxVisibilityChoicesAction,
} from "./actions";

/**
 * The page editor's context in a sandbox (D457, `docs/builder-sandbox.md` 4.3): the store's own context's sibling, with every action one
 * of the sandbox's wrappers (`./actions.ts`: the pass first, then the store's server function) bound to the sandbox's id. Only what is wired
 * here exists. Uploads (within the sandbox's storage) and the AI (*Make with AI*, *Remove background*, *Change with AI*, translation and
 * motion, through the sandbox's own routes and actions, within its allowance) are on since step S3, each while it can work, as in a store.
 * A second document beside this one (dual page) is on since S4, from the sandbox's own documents. Left out: videos and files, scheduling,
 * share links, A/B tests and sharing a saved part with other stores; every link stays inside `/admin/try/{sandbox}`.
 */
export async function sandboxPageContext(sandbox: Sandbox, type: SandboxKind): Promise<PageOwnerContext> {
  const { store, id } = sandbox;
  const market = store.markets[0];
  const [menus, fieldGroups, parents, contentTypes, textStyles, pictures, pictureEdit, aiChange, blog] = await Promise.all([
    storeMenuPreviews(store, market?.locale ?? "nb-NO", market?.lang ?? "nb"),
    allActiveFieldGroups(store.id),
    listMenuPages(store.id, "page"),
    listContentTypes(store.id),
    listTextStyles(store.id),
    // The AI's features while the sandbox's allowance has room (`aiFor()` gives no connection once it is spent).
    canMakePictures(store.id),
    canEditPictures(store.id),
    (type === "page" || type === "article") && canChangePages(store.id),
    type === "article" ? articleChoices(sandbox) : null,
  ]);
  const lookups = needsLookups(fieldGroups) ? await fieldLookups(store.id) : EMPTY_LOOKUPS;
  const bind = <A extends unknown[], R>(action: (sandboxId: string, ...args: A) => R) => action.bind(null, id);
  const typed = <A extends unknown[], R>(action: (sandboxId: string, kind: SandboxKind, ...args: A) => R) => action.bind(null, id, type);
  return {
    owner: store.id,
    features: store.features,
    type,
    defaultAuthor: "",
    blog,
    schedule: null,
    share: null,
    adminBase: sandboxBase(id, type),
    // *View* opens the sandbox's own preview of the published version: the store's address is private, its landing page all it shows.
    viewAt: `${sandboxBase(id, type)}/{id}/preview?published=1`,
    // A second document beside this one (D412; S4): the sandbox's own kinds, product layouts while its shop is on, opened through it.
    dualPages: {
      root: sandboxHome(id),
      kinds: (["page", "article", "product_layout", "header", "footer"] as const).filter((kind) => kind !== "product_layout" || requirementMet(store, "shop")),
      create: (["page", "article", "product_layout", "header", "footer"] as const).filter((kind) => kind !== "product_layout" || requirementMet(store, "shop")),
      choices: bind(sandboxDualChoicesAction),
    },
    siteBase: storeHref(store.slug, market ? marketPath(store.slug, market.slug) : storeBase(store.slug)) + PAGE_TYPE_COPY[type].sitePrefix,
    origin: storeOrigin(store.slug) ? "" : siteUrl(),
    languages: pageLanguages(store.localization.locales),
    ...((type === "page" || type === "article") && store.keptMarkets.length > 1 && { countries: store.keptMarkets.map((m) => m.code) }),
    viewCountry: store.markets[0]?.code,
    reserved: [...reservedPageSlugs(store.id, type), ...(type === "page" ? reservedChoiceSlugs(store.address) : [])],
    parents: parents.map(({ slug, title }) => ({ slug, title })),
    contentTypes: contentTypes.map(({ key, name, fields }) => ({ key, name, fields })),
    defaultDescription: (market && store.seo.description[market.locale]) || (market ? t(market.lang).storeSummary(store.name, market.name) : store.name),
    media: bind(sandboxPickMediaAction),
    upload: uploadsEnabled() ? bind(sandboxUploadAction) : null,
    pictures: pictures ? { endpoint: `${sandboxHome(id)}/ai/make` } : null,
    pictureEdit: pictureEdit ? { endpoint: `${sandboxHome(id)}/ai/edit` } : null,
    aiChange: aiChange ? { endpoint: `${sandboxHome(id)}/ai/change` } : null,
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
      translate: store.localization.locales.length > 1 ? bind(sandboxTranslateAction) : null,
    },
  };
}

/** An article's blogs and authors (D341), as the store's editor offers them; their own screens are not in the sandbox, so its link opens its home. */
async function articleChoices(sandbox: Sandbox): Promise<NonNullable<PageOwnerContext["blog"]>> {
  const { store } = sandbox;
  const [blogs, authors] = await Promise.all([blogsNow(store.id), authorsNow(store.id)]);
  const main = store.localization.locales[0];
  const lang = store.markets[0]?.lang ?? "en";
  return {
    blogs: blogs.map((b) => ({ id: b.id, title: blogTitle(b, main ?? "en", main, t(lang).blog), address: blogPath(b), main: b.main })),
    authors: authors.map((a) => ({ id: a.id, name: a.name })),
    manageHref: sandboxHome(sandbox.id),
  };
}
