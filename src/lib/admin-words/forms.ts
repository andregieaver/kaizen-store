/**
 * The forms area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * FORMS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { formsEn, type FormsMessages } from "../admin-messages/forms.en";
import { formsNb } from "../admin-messages/forms.nb";

export const FORMS_WORDS: Record<AdminLang, FormsMessages> = { en: formsEn, nb: formsNb };
