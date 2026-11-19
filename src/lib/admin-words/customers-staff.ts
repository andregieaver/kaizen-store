/**
 * The customersStaff cut (bloat review step 2.27): the groups staff of CUSTOMERS_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as CUSTOMERS_STAFF_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { CUSTOMERS_WORDS } from "./customers";

export const CUSTOMERS_STAFF_WORDS = cut(CUSTOMERS_WORDS, ["staff"]);
