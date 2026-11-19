/**
 * The platformLegal area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PLATFORM_LEGAL_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { platformLegalEn, type PlatformLegalMessages } from "../admin-messages/platform-legal.en";
import { platformLegalNb } from "../admin-messages/platform-legal.nb";

export const PLATFORM_LEGAL_WORDS: Record<AdminLang, PlatformLegalMessages> = { en: platformLegalEn, nb: platformLegalNb };
