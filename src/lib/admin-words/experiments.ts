/**
 * The experiments area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { experimentsEn, type ExperimentsMessages } from "../admin-messages/experiments.en";
import { experimentsNb } from "../admin-messages/experiments.nb";

export const EXPERIMENTS_WORDS: Record<AdminLang, ExperimentsMessages> = { en: experimentsEn, nb: experimentsNb };
