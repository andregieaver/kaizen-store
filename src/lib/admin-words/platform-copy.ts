/**
 * The platformCopy cut (bloat review step 2.27): the groups copyWizard, copyProgress of PLATFORM_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as PLATFORM_COPY_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { PLATFORM_WORDS } from "./platform";

export const PLATFORM_COPY_WORDS = cut(PLATFORM_WORDS, ["copyWizard", "copyProgress"]);
