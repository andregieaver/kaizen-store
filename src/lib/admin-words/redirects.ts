/**
 * The redirects area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * REDIRECTS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { redirectsEn, type RedirectsMessages } from "../admin-messages/redirects.en";
import { redirectsNb } from "../admin-messages/redirects.nb";

export const REDIRECTS_WORDS: Record<AdminLang, RedirectsMessages> = { en: redirectsEn, nb: redirectsNb };
