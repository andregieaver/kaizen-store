/**
 * The settings area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * SETTINGS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { settingsEn, type SettingsMessages } from "../admin-messages/settings.en";
import { settingsNb } from "../admin-messages/settings.nb";

export const SETTINGS_WORDS: Record<AdminLang, SettingsMessages> = { en: settingsEn, nb: settingsNb };
