/**
 * A person's Canva's words in both languages (D898, in bloat review step 0.7's shape). Server code reads them as CANVA_WORDS[lang], and
 * hands them to client parts with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { canvaEn, type CanvaMessages } from "../admin-messages/canva.en";
import { canvaNb } from "../admin-messages/canva.nb";

export const CANVA_WORDS: Record<AdminLang, CanvaMessages> = { en: canvaEn, nb: canvaNb };
