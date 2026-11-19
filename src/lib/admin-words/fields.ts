/**
 * The fields area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * FIELDS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { fieldsEn, type FieldsMessages } from "../admin-messages/fields.en";
import { fieldsNb } from "../admin-messages/fields.nb";

export const FIELDS_WORDS: Record<AdminLang, FieldsMessages> = { en: fieldsEn, nb: fieldsNb };
