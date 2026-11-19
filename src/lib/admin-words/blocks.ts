/**
 * The blocks area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * BLOCKS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { blocksEn, type BlocksMessages } from "../admin-messages/blocks.en";
import { blocksNb } from "../admin-messages/blocks.nb";

export const BLOCKS_WORDS: Record<AdminLang, BlocksMessages> = { en: blocksEn, nb: blocksNb };
