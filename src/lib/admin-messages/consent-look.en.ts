import { CONSENT_LOOK_WORDS } from "../consent-look-words";

/**
 * The *Cookie popup* card's words (D883): their English is in `src/lib/consent-look-words.ts`, so this area is server-only
 * (`SERVER_AREAS` in `admin-text.ts`) and a page that draws the theme editor in another language hands it down
 * (`useHandedText("consentLook")`); in English the editor reads that module itself.
 */
export const consentLookEn = CONSENT_LOOK_WORDS;

export type ConsentLookMessages = typeof consentLookEn;
