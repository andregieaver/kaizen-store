/**
 * The home area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { homeEn, type HomeMessages } from "../admin-messages/home.en";
import { homeNb } from "../admin-messages/home.nb";

export const HOME_WORDS: Record<AdminLang, HomeMessages> = { en: homeEn, nb: homeNb };
