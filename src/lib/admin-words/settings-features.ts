/**
 * The settingsFeatures cut (bloat review step 2.27): the groups features of SETTINGS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as SETTINGS_FEATURES_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { SETTINGS_WORDS } from "./settings";

export const SETTINGS_FEATURES_WORDS = cut(SETTINGS_WORDS, ["features"]);
