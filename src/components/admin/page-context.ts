import type { PageVersionItem } from "@/lib/page-versions";
import type { PickerList } from "@/lib/media-picker";
import type { Breakpoints } from "@/lib/breakpoints";
import type { ColourSwatch } from "@/lib/colour";
import type { CSSProperties } from "react";

import type { GridData } from "@/lib/content-grid";
import type { PageIssue, ThemeSet } from "@/lib/page-a11y";
import type { FieldGroup, FieldLookups } from "@/lib/custom-fields";
import type { SiteFonts } from "@/lib/fonts-schema";
import type { PageType } from "@/lib/page-content";
import type { GridContentType } from "@/lib/content-types";
import type { MotionPlanResult } from "@/lib/motion-plan";
import type { TranslateResult } from "@/lib/page-translate-ai";
import type { DuplicateResult } from "@/lib/page-duplicate";
import type { PageLanguage } from "@/lib/page-translation";
import type { TemplateActions } from "@/lib/templates";
import type { SectionResult, ThemeSectionsOffer } from "@/lib/theme-sections";
import type { ThemeStorePart } from "@/lib/theme-store-parts";
import type { VisibilityChoices } from "@/lib/visibility";
import type { Term, TermKind } from "@/lib/taxonomy";
import type { StandardMenus } from "@/lib/site-layout";
import type { StoreTheme, ThemeSettings } from "@/lib/theme";
import type { GridStore } from "@/server/content-grid";
import type { ItemLinkTargets } from "@/server/link-targets";
import type { PlanChoice } from "@/lib/plan-offer";
import type { MenuPreview } from "@/server/menus";
import type { EditablePage } from "@/server/pages";
import type { SavedResult } from "@/server/saved-parts";
import type { TermsResult } from "@/server/taxonomy";

import type { StartFieldFile } from "./field-file-upload";
import type { Upload } from "./image-upload";
import type { PictureMaker } from "./picture-maker";
import type { StartVideo } from "./video-upload";

export type PageSaveState =
  | { status: "saved"; page: EditablePage }
  /** `code: "needs_confirmation"` (wave 1, 1e): publishing was held for blocking problems the owner has not acknowledged; `issues` lists them. */
  | { status: "error"; problems: string[]; code?: "needs_confirmation" | "pay_page_block"; issues?: PageIssue[] };

/** A page's schedule as the editor shows it (D341): the waiting one with its time in words, and the last one that did not publish. */
export type ScheduleView = { waiting: { at: string; label: string } | null; failure: string | null };
/** Saves the editor's draft as Save draft does: true when it could (*Schedule* saves a changed draft first, D341). */
export type SaveDraft = () => Promise<boolean>;
export type ScheduleAnswer = { ok: true; view: ScheduleView; message: string } | { ok: false; problem: string };

/**
 * What the page editor and builder need from the pages' owner (D53):
 * Kaizen's own or a store's. The same editor serves both; only this
 * differs, filled in by each owner's routes with its server actions
 * (bound to the store, which each checks the editor belongs to).
 */
export type PageOwnerContext = {
  /** Null for Kaizen, else the store's id. */
  owner: string | null;
  /** A page, or an article in the blog (D57). */
  type: PageType;
  /** A new article's author: the signed-in person's name (D57). */
  defaultAuthor: string;
  /**
   * A store's article's blog and author record (D341): the store's blogs (its first first) and authors to choose from, and where they are
   * managed. Absent for pages and Kaizena Flow's articles.
   */
  blog?: { blogs: { id: string; title: string; address: string; main: boolean }[]; authors: { id: string; name: string }[]; manageHref: string } | null;
  /**
   * Publishing the draft at a set time (D341; the start of D340's model): the store's time zone, and the actions bound to the store and
   * the kind of page. Absent where pages are not scheduled (layouts, test versions, Kaizena Flow's own pages).
   */
  schedule?: {
    zone: string;
    read: (id: string) => Promise<ScheduleView | null>;
    set: (id: string, day: string, time: string) => Promise<ScheduleAnswer>;
    cancel: (id: string) => Promise<ScheduleAnswer>;
  } | null;
  /** Where the owner's pages are edited: `/admin/platform/pages` or `/admin/{store}/pages`. */
  adminBase: string;
  /**
   * What comes before a page's address on the site: "" for Kaizen's, `/s/{store}/{market}` for a store's,
   * or the full `https://{store}.{domain}/{market}` once it has its own host (P7); `/blog` after it for articles.
   */
  siteBase: string;
  /** The site's origin, for showing a page's full address; empty when `siteBase` is one. */
  origin: string;
  /** The languages the owner's pages are written in, the main one first (D55); Kaizen's are English only. */
  languages: PageLanguage[];
  /** Addresses the owner's pages cannot take. */
  reserved: readonly string[];
  /** The owner's pages, for choosing a parent to nest a page under (`/projects/project-a`); only pages nest. */
  parents?: readonly { slug: string; title: string }[];
  /** The owner's content types (D326), for a grid of their entries. */
  contentTypes?: readonly GridContentType[];
  /** The owner's own description: the last fallback for a page without text. */
  defaultDescription: string;
  /** Lists the owner's media library for choosing a picture there instead of uploading one (D88); absent where an editor has none. */
  media?: PickerList;
  /** Uploads a picture; null where uploads are not set up. */
  upload: Upload | null;
  /**
   * Makes a picture by prompt in the site's look for any picture field (D283), where the site's AI has a picture model; absent or null
   * elsewhere (a theme's workspace, whose pictures are the theme's).
   */
  pictures?: PictureMaker | null;
  /** The store's discounts with single-use codes, for a newsletter form's welcome code (D304 J3); absent on Kaizena Flow's own pages. */
  signupCodes?: { id: string; code: string }[];
  /** Starts a row's background video upload from the browser; null where uploads are not set up. */
  startVideo: StartVideo | null;
  /** Stores whose products a content grid can show; empty on a store's pages, which show their own. */
  gridStores: GridStore[];
  /** The owner's own fonts, and the style that sets them, for the canvas (D59). */
  fonts: { site: SiteFonts; style: CSSProperties | undefined };
  /** The owner's menus (D85), for menu components, and those its standard header and footer show (new headers and footers start with them). */
  menus: MenuPreview[];
  standardMenus: StandardMenus;
  /** Where the owner's menus are edited. */
  menusHref: string;
  /**
   * The store's features as kept (D178): the builder offers only the parts of features that are on, and marks a part of one that is off
   * on the canvas. Absent for Kaizen's pages and a design profile's workspace (whose look serves any store), which offer every part.
   */
  features?: readonly string[];
  /** Kaizen's plans for the Plans component (D142), on Kaizen's own pages; null for a store, which does not sell Kaizen's plans. */
  plans: PlanChoice[] | null;
  /**
   * The theme store's components the page may hold (D285): the list of themes on Kaizena Flow's own pages, and a theme's parts too on the
   * page chosen for a theme's page; absent or null on a store's pages and Kaizena Flow's articles, headers and footers.
   */
  themeStore?: { parts: readonly ThemeStorePart[] } | null;
  /** The owner's own CSS for every page of its site (D100), edited in the builder's CSS panel. */
  siteCss: string;
  /** The store's custom field groups (D118), for the builder's field components and the page's own fields; null for Kaizen, which has none yet. */
  fields: {
    groups: FieldGroup[];
    /** What the fields that point at products, pages, categories or tags choose from; empty when no field does. */
    lookups: FieldLookups;
    /** Starts a file's upload for a file field from the browser; null where uploads are not set up. */
    startFile: StartFieldFile | null;
  } | null;
  /** A store's theme for the canvas (D60): CSS for `[data-theme-canvas]` and its attributes; null for Kaizen. */
  theme: {
    css: string;
    attributes: Record<string, string>;
    /** Where its screen sizes start (D179), for the canvas's part rules. */
    breakpoints?: Breakpoints;
    /** The theme's settings, for the builder's Theme tab (D182), which edits the elements, content width and body background of a store's own theme. */
    settings?: ThemeSettings;
  } | null;
  /** Templates shared between stores and the marketplace (D125); null on Kaizen's own pages. */
  templates: TemplateActions | null;
  /**
   * The live theme's own sections (D272), offered on the Rows tab while a signature theme is live: listed when the builder opens and placed
   * as a template is (its pictures copied into the owner's library). Null where no page of this kind takes them (headers, footers, product
   * layouts, test versions).
   */
  themeSections?: { list: () => Promise<ThemeSectionsOffer>; place: (key: string) => Promise<SectionResult> } | null;
  /**
   * What the page checker needs to know (wave 1, 1e): the theme's colours, so text with no colour of its own is checked against its background,
   * and the page chosen for the checkout, which may not hold what the payment policy would break. Kaizen's own pages have no theme.
   */
  check: { theme: ThemeSet[]; checkoutPageId: string | null } | null;
  /** The colours colour fields offer as swatches (D180): the store theme's (`themeSwatches()`), Kaizen's own on its pages (`platformSwatches()`). */
  colours: ColourSwatch[];
  /** For a version made for an A/B test (D148): the kind of page it is a version of, so the builder offers what that kind holds; null otherwise. */
  variantOf: PageType | null;
  /** Where a store's A/B tests are made (D148), for the builder's "A/B test this"; null for Kaizen's pages and for anything but a store's page. */
  experimentsHref: string | null;
  /**
   * A design profile's workspace (D177): the builder saves drafts only, which are published with the profile from its own page, so it offers
   * no Publish, Unpublish, Duplicate, Delete or Save as template; `preview` is the profile's draft preview and `note` says where it is
   * published. Absent everywhere else.
   */
  draftOnly?: { preview: string; note: string };
  /**
   * A page drawn at a place of its own rather than at its address (the theme store's pages, D285, edited from Themes): no Duplicate and no
   * Save as template, which would make a page of another kind, no address or categories of its own (it is shown at `address`), and *View*
   * opens the place (`view`; null: nowhere to open yet). Absent everywhere else.
   */
  place?: { view: string | null; address: string };
  actions: {
    /** `acknowledged`: the checker's blocking problems the owner has seen and chose to publish with (issue ids), recorded in the audit log. */
    save: (id: string | null, payload: string, publish: boolean, acknowledged?: string[]) => Promise<PageSaveState>;
    unpublish: (id: string) => Promise<PageSaveState>;
    remove: (id: string) => Promise<{ problems: string[] } | void>;
    /** Makes a draft copy (D126): from what the editor holds (its JSON), or from the saved draft when none is given. */
    duplicate: (id: string, edited?: string) => Promise<DuplicateResult>;
    /**
     * A page's versions (D305): the list, newest first, and one version's content (its JSON) for the editor to hold as unsaved changes.
     * Absent where a page keeps none (a theme's workspace).
     */
    versions?: {
      list: (id: string) => Promise<PageVersionItem[]>;
      read: (id: string, version: string) => Promise<{ ok: true; content: string } | { ok: false; problem: string }>;
    };
    /** "Make my page cool" (D128): a motion plan for the rows the editor holds (their JSON); the editor applies it. */
    motion: (rowsJson: string) => Promise<MotionPlanResult>;
    createTerm: (input: { kind: TermKind; name: string; slug?: string; parentId?: string | null }) => Promise<TermsResult>;
    createPart: (input: unknown) => Promise<SavedResult>;
    updatePart: (id: string, input: unknown) => Promise<SavedResult>;
    deletePart: (id: string) => Promise<SavedResult>;
    gridPreview: (block: unknown, pageId: string | null) => Promise<GridData | { problem: string }>;
    /** A store's product categories and tags, for a grid of its products. */
    gridTerms: (storeId: string) => Promise<Term[]>;
    /** What a custom grid item's link can point at (D155): the owner's pages, products, articles, categories and tags, by address. */
    linkTargets: () => Promise<ItemLinkTargets>;
    /**
     * What a part's conditions choose from (D179 phase 4): a store's groups, companies, products, categories, countries,
     * languages and currencies. Absent for Kaizen's pages (sign-in, language, time and address only) and a design profile's
     * workspace (whose ids would not reach a store).
     */
    visibilityChoices?: () => Promise<VisibilityChoices>;
    /** Saves what the builder's Theme tab holds (D182: the JSON of `ThemeTabValue`) on the store's theme; absent where the pages are not a store's own. */
    saveLibrary?: (payload: string) => Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }>;
    saveThemeTab?: (payload: string) => Promise<{ ok: true; theme: StoreTheme } | { ok: false; problems: string[] }>;
    /** Saves the owner's CSS for every page (D100); it is live at once. */
    saveSiteCss: (css: string) => Promise<{ ok: true } | { ok: false; problems: string[] }>;
    /** Copies a Google Fonts family to Kaizen before a block uses it (D59). */
    installFont: (family: string) => Promise<{ ok: true } | { ok: false; problem: string }>;
    /** Translates texts with the owner's AI (D109); null where the owner has one language only (Kaizen's pages). */
    translate: ((request: unknown) => Promise<TranslateResult>) | null;
  };
};
