/**
 * Signing a design tool's app in, in both languages (D898 F1, in bloat review step 0.7's shape). Server code reads it as PLUGINS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { pluginsEn, type PluginsMessages } from "../admin-messages/plugins.en";
import { pluginsNb } from "../admin-messages/plugins.nb";

export const PLUGINS_WORDS: Record<AdminLang, PluginsMessages> = { en: pluginsEn, nb: pluginsNb };
