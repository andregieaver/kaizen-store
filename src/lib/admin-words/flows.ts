/**
 * The flows area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * FLOWS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { flowsEn, type FlowsMessages } from "../admin-messages/flows.en";
import { flowsNb } from "../admin-messages/flows.nb";

export const FLOWS_WORDS: Record<AdminLang, FlowsMessages> = { en: flowsEn, nb: flowsNb };
