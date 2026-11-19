/**
 * The products area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * PRODUCTS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { productsEn, type ProductsMessages } from "../admin-messages/products.en";
import { productsNb } from "../admin-messages/products.nb";

export const PRODUCTS_WORDS: Record<AdminLang, ProductsMessages> = { en: productsEn, nb: productsNb };
