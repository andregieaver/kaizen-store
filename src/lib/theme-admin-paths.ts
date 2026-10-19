/**
 * Where themes live in the platform's admin (D273): one Themes page under Stores (each theme with its presets and its own content), the
 * starting content and the demo stores (D277) under it, and Kaizena Flow's own site's installed themes under Website as its Design. Build
 * these links with the functions here, never by hand.
 */
export const THEMES_ADMIN = "/admin/platform/themes";

/** Kaizena Flow's own site's installed themes (D251), one live. */
export const SITE_DESIGN = "/admin/platform/site-design";

/** One store template: starting content (a content pack's, D257) or a live demo store (D277), each with its own page. */
export const demoStoreHref = (starterId: string): string => `${THEMES_ADMIN}/demo-stores/${starterId}`;

/** The demo stores (D277), live stores dressed in a theme: a card on the Themes page. */
export const DEMO_STORES_HREF = `${THEMES_ADMIN}#demo-stores`;

/** *New demo store* (D277): its name, address, theme and the content it starts with. */
export const NEW_DEMO_STORE = `${THEMES_ADMIN}/demo-stores/new`;

/** The starting content (D275), the content packs a theme's content or a demo store starts as a copy of: a card on the Themes page. */
export const STARTING_CONTENT_HREF = `${THEMES_ADMIN}#starting-content`;

/** The theme store's own pages (D285): edited here, never among Kaizena Flow's other pages; the card listing them on Themes. */
export const THEME_STORE_PAGES = `${THEMES_ADMIN}/pages`;
export const themeStorePageHref = (pageId: string): string => `${THEME_STORE_PAGES}/${pageId}`;
export const THEME_STORE_PAGES_HREF = `${THEMES_ADMIN}#theme-store-pages`;

/**
 * The addresses themes, design profiles and store templates had before D273 and where they went, as Next's `redirects`
 * (`next.config.ts`). The old site's themes (`/admin/platform/themes/{install}`) took an address that is now a theme's: the theme page
 * sends an install's id on to the site's Design (`designPage()`).
 */
export const LEGACY_THEME_REDIRECTS: readonly { source: string; destination: string; permanent: false }[] = [
  { source: "/admin/platform/design-profiles", destination: THEMES_ADMIN, permanent: false },
  { source: "/admin/platform/design-profiles/:path+", destination: `${THEMES_ADMIN}/:path+`, permanent: false },
  { source: "/admin/platform/store-templates", destination: THEMES_ADMIN, permanent: false },
  { source: "/admin/platform/store-templates/:starter", destination: `${THEMES_ADMIN}/demo-stores/:starter`, permanent: false },
  { source: "/admin/account/design-profiles/:preset/preview", destination: "/admin/account/themes/:preset/preview", permanent: false },
];
