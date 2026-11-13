/**
 * The common area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { commonEn, type CommonMessages } from "../admin-messages/common.en";
import { commonNb } from "../admin-messages/common.nb";

export const COMMON_WORDS: Record<AdminLang, CommonMessages> = { en: commonEn, nb: commonNb };
