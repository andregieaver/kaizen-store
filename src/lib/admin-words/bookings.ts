/**
 * The bookings area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BOOKINGS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { bookingsEn, type BookingsMessages } from "../admin-messages/bookings.en";
import { bookingsNb } from "../admin-messages/bookings.nb";

export const BOOKINGS_WORDS: Record<AdminLang, BookingsMessages> = { en: bookingsEn, nb: bookingsNb };
