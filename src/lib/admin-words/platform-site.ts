/**
 * The platformSite area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { platformSiteEn, type PlatformSiteMessages } from "../admin-messages/platform-site.en";
import { platformSiteNb } from "../admin-messages/platform-site.nb";

export const PLATFORM_SITE_WORDS: Record<AdminLang, PlatformSiteMessages> = { en: platformSiteEn, nb: platformSiteNb };
