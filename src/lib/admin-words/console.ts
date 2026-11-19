/**
 * The console area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * CONSOLE_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { consoleEn, type ConsoleMessages } from "../admin-messages/console.en";
import { consoleNb } from "../admin-messages/console.nb";

export const CONSOLE_WORDS: Record<AdminLang, ConsoleMessages> = { en: consoleEn, nb: consoleNb };
