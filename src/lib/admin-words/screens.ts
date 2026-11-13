/**
 * The screens area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { screensEn, type ScreensMessages } from "../admin-messages/screens.en";
import { screensNb } from "../admin-messages/screens.nb";

export const SCREENS_WORDS: Record<AdminLang, ScreensMessages> = { en: screensEn, nb: screensNb };
