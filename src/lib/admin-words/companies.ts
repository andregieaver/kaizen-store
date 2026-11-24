/**
 * Which companies visited's words in both languages (D890, in step 0.7's shape). Server code reads them as COMPANIES_WORDS[lang]. Never
 * import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { companiesEn, type CompaniesMessages } from "../admin-messages/companies.en";
import { companiesNb } from "../admin-messages/companies.nb";

export const COMPANIES_WORDS: Record<AdminLang, CompaniesMessages> = { en: companiesEn, nb: companiesNb };
