/**
 * The returns area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * RETURNS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { returnsEn, type ReturnsMessages } from "../admin-messages/returns.en";
import { returnsNb } from "../admin-messages/returns.nb";

export const RETURNS_WORDS: Record<AdminLang, ReturnsMessages> = { en: returnsEn, nb: returnsNb };
