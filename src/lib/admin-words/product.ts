/**
 * The product area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PRODUCT_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { productEn, type ProductMessages } from "../admin-messages/product.en";
import { productNb } from "../admin-messages/product.nb";

export const PRODUCT_WORDS: Record<AdminLang, ProductMessages> = { en: productEn, nb: productNb };
