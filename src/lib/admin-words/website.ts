/**
 * The website area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { websiteEn, type WebsiteMessages } from "../admin-messages/website.en";
import { websiteNb } from "../admin-messages/website.nb";

export const WEBSITE_WORDS: Record<AdminLang, WebsiteMessages> = { en: websiteEn, nb: websiteNb };
