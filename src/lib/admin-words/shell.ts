/**
 * The shell area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * SHELL_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { shellEn, type ShellMessages } from "../admin-messages/shell.en";
import { shellNb } from "../admin-messages/shell.nb";

export const SHELL_WORDS: Record<AdminLang, ShellMessages> = { en: shellEn, nb: shellNb };
