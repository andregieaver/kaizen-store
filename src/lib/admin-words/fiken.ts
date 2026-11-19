/**
 * The fiken area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * FIKEN_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { fikenEn, type FikenMessages } from "../admin-messages/fiken.en";
import { fikenNb } from "../admin-messages/fiken.nb";

export const FIKEN_WORDS: Record<AdminLang, FikenMessages> = { en: fikenEn, nb: fikenNb };
