/**
 * The assistant area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { assistantEn, type AssistantMessages } from "../admin-messages/assistant.en";
import { assistantNb } from "../admin-messages/assistant.nb";

export const ASSISTANT_WORDS: Record<AdminLang, AssistantMessages> = { en: assistantEn, nb: assistantNb };
