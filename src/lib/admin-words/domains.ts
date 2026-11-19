/**
 * The domains area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * DOMAINS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { domainsEn, type DomainsMessages } from "../admin-messages/domains.en";
import { domainsNb } from "../admin-messages/domains.nb";

export const DOMAINS_WORDS: Record<AdminLang, DomainsMessages> = { en: domainsEn, nb: domainsNb };
