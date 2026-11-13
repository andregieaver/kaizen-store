/**
 * The platform area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { platformEn, type PlatformMessages } from "../admin-messages/platform.en";
import { platformNb } from "../admin-messages/platform.nb";

export const PLATFORM_WORDS: Record<AdminLang, PlatformMessages> = { en: platformEn, nb: platformNb };
