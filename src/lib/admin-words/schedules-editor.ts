/**
 * The schedulesEditor cut (bloat review step 2.27): the groups dialog, nouns, share of SCHEDULES_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as SCHEDULES_EDITOR_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { SCHEDULES_WORDS } from "./schedules";

export const SCHEDULES_EDITOR_WORDS = cut(SCHEDULES_WORDS, ["dialog", "nouns", "share"]);
