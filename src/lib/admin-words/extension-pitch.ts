/**
 * The extensions' lines on their markers in both languages (D748 E5, in bloat review step 0.7's shape). Server code reads them as
 * EXTENSION_PITCH_WORDS[lang]. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { extensionPitchEn, type ExtensionPitchMessages } from "../admin-messages/extension-pitch.en";
import { extensionPitchNb } from "../admin-messages/extension-pitch.nb";

export const EXTENSION_PITCH_WORDS: Record<AdminLang, ExtensionPitchMessages> = { en: extensionPitchEn, nb: extensionPitchNb };
