/**
 * The recordings area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * RECORDINGS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { recordingsEn, type RecordingsMessages } from "../admin-messages/recordings.en";
import { recordingsNb } from "../admin-messages/recordings.nb";

export const RECORDINGS_WORDS: Record<AdminLang, RecordingsMessages> = { en: recordingsEn, nb: recordingsNb };
