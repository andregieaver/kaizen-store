/**
 * The canvaField cut (D898 C2, bloat review step 2.27): the groups edit, opening, connect, field, outcome, problems of CANVA_WORDS, what a
 * picture field's *Edit in Canva* reads, the same objects in both languages. Server code reads it as CANVA_FIELD_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { CANVA_WORDS } from "./canva";

export const CANVA_FIELD_WORDS = cut(CANVA_WORDS, ["edit", "opening", "connect", "field", "outcome", "problems"]);
