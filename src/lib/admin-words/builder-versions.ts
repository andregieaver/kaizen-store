/**
 * The builderVersions cut (bloat review step 2.27): the groups differences, blockNames of BUILDER_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as BUILDER_VERSIONS_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { BUILDER_WORDS } from "./builder";

export const BUILDER_VERSIONS_WORDS = cut(BUILDER_WORDS, ["differences", "blockNames"]);
