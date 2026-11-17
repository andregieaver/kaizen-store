/**
 * The capacity area's words in both languages, for code outside the admin (bloat review step 0.7, used by the platform's morning briefing).
 * Code outside src/app/admin and src/components/admin reads an area here, never through the admin registry, which loads every area.
 * Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { capacityEn, type CapacityMessages } from "../admin-messages/capacity.en";
import { capacityNb } from "../admin-messages/capacity.nb";

export const CAPACITY_WORDS: Record<AdminLang, CapacityMessages> = { en: capacityEn, nb: capacityNb };
