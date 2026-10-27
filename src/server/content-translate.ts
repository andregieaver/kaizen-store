import "server-only";

import { entryTitle, type EntrySeo } from "@/lib/content-types";
import { entryUnit, valueChanges, valueSlots } from "@/lib/field-translate";
import { moneyCurrencies } from "@/lib/field-money";
import type { TranslateMode } from "@/lib/page-translate-ai";
import type { Unit } from "@/lib/store-translate";

import type { Membership } from "./auth";
import { getEntry, listEntries, saveEntry } from "./content-entries";
import { getContentType, listContentTypes } from "./content-types";

/**
 * Content entries in the store's translation worklist (D326, scope `content`): one unit per entry, its type's public fields' words and its
 * search texts, from its draft (an entry, like a page, is published by a person). Accepted texts are written into the draft through
 * `saveEntry()`, which checks them as the editor's change.
 */

/** The units of the owner's entries to translate from `from` into `to`. */
export async function contentWork(owner: string | null, from: string, to: string, mode: TranslateMode): Promise<Unit[]> {
  const units: Unit[] = [];
  for (const type of await listContentTypes(owner)) {
    for (const entry of await listEntries(owner, type.id)) {
      const { data, seo, seoTranslations } = entry.draft;
      const slots = valueSlots(type.fields, data, from, to);
      const title = entryTitle(type, data, from, from) || entry.slug;
      const unit = entryUnit(entry.id, type.name, title, slots, { source: seo, target: seoTranslations[to] ?? null }, mode);
      if (unit) units.push(unit);
    }
  }
  return units;
}

/** Writes an entry's accepted texts in `to` into its draft: its fields' words and its search texts. True, or what went wrong. */
export async function writeEntryUnit(member: Membership, unitId: string, to: string, done: Record<string, string | string[]>): Promise<true | string> {
  const { store } = member;
  const from = store.localization.locales[0];
  const entry = await getEntry(store.id, unitId.slice("entry:".length));
  const type = entry ? await getContentType(store.id, entry.typeId) : null;
  if (!entry || !type) return "That entry no longer exists.";
  const { data, seo, seoTranslations } = entry.draft;
  const slots = valueSlots(type.fields, data, from, to);
  const { changes } = valueChanges(slots, data, from, to, done);
  const own: EntrySeo = { ...(seoTranslations[to] ?? { title: "", description: "" }) };
  if (typeof done["seo.title"] === "string") own.title = done["seo.title"].trim();
  if (typeof done["seo.description"] === "string") own.description = done["seo.description"].trim();
  const result = await saveEntry(
    { accountId: member.account.id, owner: store.id, locales: store.localization.locales, main: from, currencies: moneyCurrencies(store) },
    { id: entry.id, typeId: type.id, slug: entry.slug, fields: changes, seo, seoTranslations: { ...seoTranslations, [to]: own } },
  );
  return result.ok ? true : (result.problems[0] ?? "The entry could not be saved.");
}
