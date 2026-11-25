/**
 * The market check's words in both languages (D900, in step 0.7's shape). Server code reads them as MARKET_CHECK_WORDS[lang]. Never import
 * this from a "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { marketCheckEn, type MarketCheckMessages } from "../admin-messages/market-check.en";
import { marketCheckNb } from "../admin-messages/market-check.nb";

export const MARKET_CHECK_WORDS: Record<AdminLang, MarketCheckMessages> = { en: marketCheckEn, nb: marketCheckNb };
