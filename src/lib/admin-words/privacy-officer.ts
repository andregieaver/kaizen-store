/**
 * The privacyOfficer area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PRIVACY_OFFICER_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { privacyOfficerEn, type PrivacyOfficerMessages } from "../admin-messages/privacy-officer.en";
import { privacyOfficerNb } from "../admin-messages/privacy-officer.nb";

export const PRIVACY_OFFICER_WORDS: Record<AdminLang, PrivacyOfficerMessages> = { en: privacyOfficerEn, nb: privacyOfficerNb };
