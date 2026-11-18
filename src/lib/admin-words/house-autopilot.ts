/**
 * Kaizena Flow's own site in the Autopilot (E5.3, D757): the area's words in both languages, for code outside the admin (bloat review step
 * 0.7), such as the action that sets the sign-up goal. Code outside src/app/admin and src/components/admin reads an area here, never through
 * the admin registry, which loads every area. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { houseAutopilotEn, type HouseAutopilotMessages } from "../admin-messages/house-autopilot.en";
import { houseAutopilotNb } from "../admin-messages/house-autopilot.nb";

export const HOUSE_AUTOPILOT_WORDS: Record<AdminLang, HouseAutopilotMessages> = { en: houseAutopilotEn, nb: houseAutopilotNb };
