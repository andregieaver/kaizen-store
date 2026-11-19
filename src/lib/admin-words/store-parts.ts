/**
 * The storeParts area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * STORE_PARTS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { storePartsEn, type StorePartsMessages } from "../admin-messages/store-parts.en";
import { storePartsNb } from "../admin-messages/store-parts.nb";

export const STORE_PARTS_WORDS: Record<AdminLang, StorePartsMessages> = { en: storePartsEn, nb: storePartsNb };
