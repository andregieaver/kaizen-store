/**
 * A company's facts from Brønnøysundregistrene, in both languages (D891, in step 0.7's shape). Server code reads them as
 * REGISTER_FACTS_WORDS[lang]. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { registerFactsEn, type RegisterFactsMessages } from "../admin-messages/register-facts.en";
import { registerFactsNb } from "../admin-messages/register-facts.nb";

export const REGISTER_FACTS_WORDS: Record<AdminLang, RegisterFactsMessages> = { en: registerFactsEn, nb: registerFactsNb };
