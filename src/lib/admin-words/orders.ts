/**
 * The orders area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * ORDERS_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { ordersEn, type OrdersMessages } from "../admin-messages/orders.en";
import { ordersNb } from "../admin-messages/orders.nb";

export const ORDERS_WORDS: Record<AdminLang, OrdersMessages> = { en: ordersEn, nb: ordersNb };
