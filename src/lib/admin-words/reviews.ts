/**
 * The reviews area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * REVIEWS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { reviewsEn, type ReviewsMessages } from "../admin-messages/reviews.en";
import { reviewsNb } from "../admin-messages/reviews.nb";

export const REVIEWS_WORDS: Record<AdminLang, ReviewsMessages> = { en: reviewsEn, nb: reviewsNb };
