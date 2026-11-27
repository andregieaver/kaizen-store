/**
 * The words of the store home's card about problems Kaizena Flow saw (D895 IA-18) in both languages. Server code reads them as
 * STORE_INCIDENTS_WORDS[lang]. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { storeIncidentsEn, type StoreIncidentsMessages } from "../admin-messages/store-incidents.en";
import { storeIncidentsNb } from "../admin-messages/store-incidents.nb";

export const STORE_INCIDENTS_WORDS: Record<AdminLang, StoreIncidentsMessages> = { en: storeIncidentsEn, nb: storeIncidentsNb };
