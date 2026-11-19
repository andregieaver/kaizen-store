/**
 * The design area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * DESIGN_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { designEn, type DesignMessages } from "../admin-messages/design.en";
import { designNb } from "../admin-messages/design.nb";

export const DESIGN_WORDS: Record<AdminLang, DesignMessages> = { en: designEn, nb: designNb };
