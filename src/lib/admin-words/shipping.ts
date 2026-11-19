/**
 * The shipping area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * SHIPPING_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { shippingEn, type ShippingMessages } from "../admin-messages/shipping.en";
import { shippingNb } from "../admin-messages/shipping.nb";

export const SHIPPING_WORDS: Record<AdminLang, ShippingMessages> = { en: shippingEn, nb: shippingNb };
