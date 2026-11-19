/**
 * The formTemplates area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * FORM_TEMPLATES_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { formTemplatesEn, type FormTemplatesMessages } from "../admin-messages/form-templates.en";
import { formTemplatesNb } from "../admin-messages/form-templates.nb";

export const FORM_TEMPLATES_WORDS: Record<AdminLang, FormTemplatesMessages> = { en: formTemplatesEn, nb: formTemplatesNb };
