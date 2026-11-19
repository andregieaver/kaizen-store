/**
 * The privacy area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PRIVACY_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { privacyEn, type PrivacyMessages } from "../admin-messages/privacy.en";
import { privacyNb } from "../admin-messages/privacy.nb";

export const PRIVACY_WORDS: Record<AdminLang, PrivacyMessages> = { en: privacyEn, nb: privacyNb };
