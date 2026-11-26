/**
 * The guide area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * GUIDE_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { guideEn, type GuideMessages } from "../admin-messages/guide.en";
import { guideNb } from "../admin-messages/guide.nb";

export const GUIDE_WORDS: Record<AdminLang, GuideMessages> = { en: guideEn, nb: guideNb };
