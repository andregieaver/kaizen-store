/**
 * The inventoryImport cut (bloat review step 2.27): the groups import of INVENTORY_WORDS,
 * the same objects in both languages (bloat review step 2.25). Server code reads it as INVENTORY_IMPORT_WORDS[lang].
 * Never import this from a "use client" file: it holds both languages.
 */
import { cut } from "../admin-area";
import { INVENTORY_WORDS } from "./inventory";

export const INVENTORY_IMPORT_WORDS = cut(INVENTORY_WORDS, ["import"]);
