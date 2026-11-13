/**
 * The customers area's words in both languages, for code outside the admin (bloat review step 0.7). Code outside src/app/admin and
 * src/components/admin reads an area here, never through the admin registry, which loads every area. Never import this from a
 * "use client" file: it holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { customersEn, type CustomersMessages } from "../admin-messages/customers.en";
import { customersNb } from "../admin-messages/customers.nb";

export const CUSTOMERS_WORDS: Record<AdminLang, CustomersMessages> = { en: customersEn, nb: customersNb };
