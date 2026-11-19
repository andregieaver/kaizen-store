/**
 * The platformTools area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PLATFORM_TOOLS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { platformToolsEn, type PlatformToolsMessages } from "../admin-messages/platform-tools.en";
import { platformToolsNb } from "../admin-messages/platform-tools.nb";

export const PLATFORM_TOOLS_WORDS: Record<AdminLang, PlatformToolsMessages> = { en: platformToolsEn, nb: platformToolsNb };
