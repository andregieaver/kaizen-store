/**
 * The websitePick cut (bloat review step 2.27): the groups picker, pictureMaker of WEBSITE_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as WEBSITE_PICK_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { WEBSITE_WORDS } from "./website";

export const WEBSITE_PICK_WORDS = cut(WEBSITE_WORDS, ["picker", "pictureMaker"]);
