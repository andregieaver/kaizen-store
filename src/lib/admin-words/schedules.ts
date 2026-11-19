/**
 * The schedules area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * SCHEDULES_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { schedulesEn, type SchedulesMessages } from "../admin-messages/schedules.en";
import { schedulesNb } from "../admin-messages/schedules.nb";

export const SCHEDULES_WORDS: Record<AdminLang, SchedulesMessages> = { en: schedulesEn, nb: schedulesNb };
