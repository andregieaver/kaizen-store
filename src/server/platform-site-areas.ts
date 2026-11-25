import "server-only";

import { ANIMATION_WORDS } from "@/lib/admin-words/animation";
import { BACKDROPS_WORDS } from "@/lib/admin-words/backdrops";
import { BLOCKS_WORDS } from "@/lib/admin-words/blocks";
import { BUILDER_WORDS } from "@/lib/admin-words/builder";
import { BUILDER_TEXT_WORDS } from "@/lib/admin-words/builder-text";
import { BUILDER_VERSIONS_WORDS } from "@/lib/admin-words/builder-versions";
import { DESIGN_EDITOR_WORDS } from "@/lib/admin-words/design-editor";
import { FIELDS_EDITOR_WORDS } from "@/lib/admin-words/fields-editor";
import { PRODUCTS_EDITOR_WORDS } from "@/lib/admin-words/products-editor";
import { STORE_PARTS_WORDS } from "@/lib/admin-words/store-parts";
import { WEBSITE_PICK_WORDS } from "@/lib/admin-words/website-pick";

/**
 * The areas Kaizena Flow's own page editor hands its client parts: the shared builder's and theme editor's (A7), as their modules (bloat
 * review step 2.25; the list PLATFORM_SITE_AREAS before it). Its own words (`platformSite`) are read by the theme pages, which hand them
 * (bloat review step 2.27). Apart from `platform-site-words.ts`, so the pages and actions that only read the site's words do not load
 * the builder's.
 */
export const PLATFORM_SITE_AREA_WORDS = { designEditor: DESIGN_EDITOR_WORDS, builder: BUILDER_WORDS, blocks: BLOCKS_WORDS, fieldsEditor: FIELDS_EDITOR_WORDS, productsEditor: PRODUCTS_EDITOR_WORDS, storeParts: STORE_PARTS_WORDS, backdrops: BACKDROPS_WORDS, animation: ANIMATION_WORDS, builderText: BUILDER_TEXT_WORDS, websitePick: WEBSITE_PICK_WORDS, builderVersions: BUILDER_VERSIONS_WORDS };
