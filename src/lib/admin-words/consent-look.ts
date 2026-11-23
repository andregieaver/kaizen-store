/**
 * The *Cookie popup* card's words in both languages (D883, in step 0.7's shape). Pages that draw the theme editor hand them down with
 * areaTexts(). Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { consentLookEn, type ConsentLookMessages } from "../admin-messages/consent-look.en";
import { consentLookNb } from "../admin-messages/consent-look.nb";

export const CONSENT_LOOK_WORDS: Record<AdminLang, ConsentLookMessages> = { en: consentLookEn, nb: consentLookNb };
