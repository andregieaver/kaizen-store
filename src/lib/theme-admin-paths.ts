/**
 * Where themes live in the platform's admin (D273): one Themes page under Stores (each theme, its presets and the demo store each look
 * starts new stores with), the demo stores under it, and Kaizena Flow's own site's installed themes under Website as its Design. Build
 * these links with the functions here, never by hand.
 */
export const THEMES_ADMIN = "/admin/platform/themes";

/** Kaizena Flow's own site's installed themes (D251), one live. */
export const SITE_DESIGN = "/admin/platform/site-design";

/** One demo store (a content pack's store template, D257), the content a theme's look starts new stores with. */
export const demoStoreHref = (starterId: string): string => `${THEMES_ADMIN}/demo-stores/${starterId}`;

/** The demo stores, a card on the Themes page. */
export const DEMO_STORES_HREF = `${THEMES_ADMIN}#demo-stores`;

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
