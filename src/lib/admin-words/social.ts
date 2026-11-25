/**
 * The social post creator's words in both languages (D870), in step 0.7's shape. Server code reads them as SOCIAL_WORDS[lang] and hands
 * them to the screen's client part. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { socialEn, type SocialMessages } from "../admin-messages/social.en";
import { socialNb } from "../admin-messages/social.nb";

export const SOCIAL_WORDS: Record<AdminLang, SocialMessages> = { en: socialEn, nb: socialNb };
