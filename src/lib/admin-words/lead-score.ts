/**
 * The lead score area's words in both languages (D865, in bloat review step 0.7's shape). Server code reads them as LEAD_SCORE_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { leadScoreEn, type LeadScoreMessages } from "../admin-messages/lead-score.en";
import { leadScoreNb } from "../admin-messages/lead-score.nb";

export const LEAD_SCORE_WORDS: Record<AdminLang, LeadScoreMessages> = { en: leadScoreEn, nb: leadScoreNb };
