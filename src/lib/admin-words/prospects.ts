/**
 * Find companies' words in both languages (D893). Server code reads them as PROSPECTS_WORDS[lang]. Never import this from a "use client"
 * file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { prospectsEn, type ProspectsMessages } from "../admin-messages/prospects.en";
import { prospectsNb } from "../admin-messages/prospects.nb";

export const PROSPECTS_WORDS: Record<AdminLang, ProspectsMessages> = { en: prospectsEn, nb: prospectsNb };
