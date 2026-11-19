/**
 * The animation area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * ANIMATION_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { animationEn, type AnimationMessages } from "../admin-messages/animation.en";
import { animationNb } from "../admin-messages/animation.nb";

export const ANIMATION_WORDS: Record<AdminLang, AnimationMessages> = { en: animationEn, nb: animationNb };
