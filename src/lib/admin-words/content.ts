/**
 * The content area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * CONTENT_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { contentEn, type ContentMessages } from "../admin-messages/content.en";
import { contentNb } from "../admin-messages/content.nb";

export const CONTENT_WORDS: Record<AdminLang, ContentMessages> = { en: contentEn, nb: contentNb };
