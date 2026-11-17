/**
 * The deals area's words in both languages, for code outside the admin (bloat review step 0.7): the AI manager's CRM tools name a lead's
 * deal as the leads inbox does (ecosystem plan E2.5, D713). Code outside src/app/admin and src/components/admin reads an area here, never
 * through the admin registry, which loads every area. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { dealsEn, type DealsMessages } from "../admin-messages/deals.en";
import { dealsNb } from "../admin-messages/deals.nb";

export const DEALS_WORDS: Record<AdminLang, DealsMessages> = { en: dealsEn, nb: dealsNb };
