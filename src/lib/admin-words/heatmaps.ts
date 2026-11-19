/**
 * The heatmaps area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * HEATMAPS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { heatmapsEn, type HeatmapsMessages } from "../admin-messages/heatmaps.en";
import { heatmapsNb } from "../admin-messages/heatmaps.nb";

export const HEATMAPS_WORDS: Record<AdminLang, HeatmapsMessages> = { en: heatmapsEn, nb: heatmapsNb };
