/** The WordPress plugin's download (D169): the file built by `scripts/build-wordpress-plugin.mjs` into `public/downloads/`, and its version. */
export const WORDPRESS_PLUGIN_VERSION = "1.3.4";
export const WORDPRESS_PLUGIN_FILE = "/downloads/kaizen-store-wordpress.zip";

/** A version as it was released: its number and the day it was first offered. */
export type WordpressPluginRelease = { version: string; released: string };

/**
 * Every version released, newest first (the first is `WORDPRESS_PLUGIN_VERSION`): each kept as it was last built under its number in
 * `public/downloads/wordpress/` (`wordpressReleaseFile()`) and offered in the download table of the docs' WordPress page
 * (`content/docs/developers/wordpress/_section.en.md`). `wordpress-plugin.test.ts` holds the list, the files and the table together.
 */
export const WORDPRESS_PLUGIN_RELEASES: readonly WordpressPluginRelease[] = [
  { version: "1.3.4", released: "2026-11-04" },
  { version: "1.3.3", released: "2026-11-04" },
  { version: "1.3.2", released: "2026-11-04" },
  { version: "1.3.1", released: "2026-11-04" },
  { version: "1.3.0", released: "2026-11-04" },
  { version: "1.2.1", released: "2026-11-04" },
  { version: "1.2.0", released: "2026-10-26" },
  { version: "1.1.0", released: "2026-10-05" },
  { version: "1.0.0", released: "2026-10-05" },
];

/** A released version's own file, under Kaizena Flow's site. */
export const wordpressReleaseFile = (version: string): string => `/downloads/wordpress/kaizen-store-wordpress-${version}.zip`;
