/**
 * The giftCards area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * GIFT_CARDS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { giftCardsEn, type GiftCardsMessages } from "../admin-messages/gift-cards.en";
import { giftCardsNb } from "../admin-messages/gift-cards.nb";

export const GIFT_CARDS_WORDS: Record<AdminLang, GiftCardsMessages> = { en: giftCardsEn, nb: giftCardsNb };
