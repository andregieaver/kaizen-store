/**
 * The order area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { orderEn, type OrderMessages } from "../admin-messages/order.en";
import { orderNb } from "../admin-messages/order.nb";

export const ORDER_WORDS: Record<AdminLang, OrderMessages> = { en: orderEn, nb: orderNb };
