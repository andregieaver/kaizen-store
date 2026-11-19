/**
 * The supportSettings cut (bloat review step 2.27): the groups settings of SUPPORT_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as SUPPORT_SETTINGS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { SUPPORT_WORDS } from "./support";

export const SUPPORT_SETTINGS_WORDS = cut(SUPPORT_WORDS, ["settings"]);
