/**
 * The work area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { workEn, type WorkMessages } from "../admin-messages/work.en";
import { workNb } from "../admin-messages/work.nb";

export const WORK_WORDS: Record<AdminLang, WorkMessages> = { en: workEn, nb: workNb };
