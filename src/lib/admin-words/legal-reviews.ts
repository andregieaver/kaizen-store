/**
 * Legal reviews' words in both languages (D892). Server code reads them as LEGAL_REVIEWS_WORDS[lang]. Never import this from a "use client"
 * file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { legalReviewsEn, type LegalReviewsMessages } from "../admin-messages/legal-reviews.en";
import { legalReviewsNb } from "../admin-messages/legal-reviews.nb";

export const LEGAL_REVIEWS_WORDS: Record<AdminLang, LegalReviewsMessages> = { en: legalReviewsEn, nb: legalReviewsNb };
