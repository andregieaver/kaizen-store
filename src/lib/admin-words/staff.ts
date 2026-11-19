/**
 * The staff area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * STAFF_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { staffEn, type StaffMessages } from "../admin-messages/staff.en";
import { staffNb } from "../admin-messages/staff.nb";

export const STAFF_WORDS: Record<AdminLang, StaffMessages> = { en: staffEn, nb: staffNb };
