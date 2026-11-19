/**
 * The inventory area's words in both languages (bloat review step 2.25, in step 0.7's shape). Server code reads them as
 * INVENTORY_WORDS[lang], and several areas with areaTexts() (src/lib/admin-area.ts). Never import this from a "use client" file: it
 * holds both languages.
 */
import type { AdminLang } from "../admin-lang";
import { inventoryEn, type InventoryMessages } from "../admin-messages/inventory.en";
import { inventoryNb } from "../admin-messages/inventory.nb";

export const INVENTORY_WORDS: Record<AdminLang, InventoryMessages> = { en: inventoryEn, nb: inventoryNb };
