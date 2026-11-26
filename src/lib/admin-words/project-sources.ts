/**
 * The card of tasks on an order's, a return's, a review's or a conversation's page in both languages (D904 P8.3a, in bloat review step 0.7's
 * shape). Server code reads them as PROJECT_SOURCES_WORDS[lang]. Never import this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { projectSourcesEn, type ProjectSourcesMessages } from "../admin-messages/project-sources.en";
import { projectSourcesNb } from "../admin-messages/project-sources.nb";

export const PROJECT_SOURCES_WORDS: Record<AdminLang, ProjectSourcesMessages> = { en: projectSourcesEn, nb: projectSourcesNb };
