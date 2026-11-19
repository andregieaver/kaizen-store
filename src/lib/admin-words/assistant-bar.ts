/**
 * The assistantBar cut (bloat review step 2.27): the groups name, launcher, notices of ASSISTANT_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as ASSISTANT_BAR_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { ASSISTANT_WORDS } from "./assistant";

export const ASSISTANT_BAR_WORDS = cut(ASSISTANT_WORDS, ["name", "launcher", "notices"]);
