import {
  SEARCH_TYPES,
  fieldShows,
  isStructural,
  localized,
  subFieldsOf,
  valuesFor,
  type FieldData,
  type FieldDef,
  type FieldGroup,
  type FieldValue,
  type Values,
} from "./custom-fields";
import { richTextPlain, type RichTextDoc } from "./page-content";

/**
 * The words of a product's custom fields that keyword search reads (D118,
 * D72): what a product's public fields flagged `search` say, in each of the
 * store's languages, kept as one text per language in `commerce.field_search`
 * (`src/server/field-search.ts`). Pure: the server gives it the groups that
 * apply to the product and what was entered.
 */

/** The most characters kept for a product in a language: enough for a description, not for a book. */
export const FIELD_SEARCH_MAX = 4000;

const isDoc = (value: unknown): value is RichTextDoc =>
  typeof value === "object" && value !== null && !Array.isArray(value) && (value as { type?: unknown }).type === "doc";

/** Whether a field's value is searched: a public field (a group's or repeater's own fields follow it) of a type that holds words, flagged. */
const searched = (def: FieldDef): boolean => Boolean(def.search) && SEARCH_TYPES.includes(def.type);

/** The words a value holds in a language: texts as they are, rich text as plain text, a choice by its label. */
function wordsOf(def: FieldDef, value: FieldValue, locale: string): string[] {
  const label = (key: string) => {
    const choice = def.choices?.find((c) => c.key === key);
    return choice ? localized(choice.label, choice.labels, locale) : "";
  };
  switch (def.type) {
    case "text":
    case "textarea":
      return typeof value === "string" ? [value] : [];
    case "richText":
      return isDoc(value) ? [richTextPlain(value)] : [];
    case "select":
    case "radio":
    case "buttons":
      return typeof value === "string" ? [label(value)] : [];
    case "checkbox":
      return Array.isArray(value)
        ? (value as unknown[]).filter((key): key is string => typeof key === "string").map(label)
        : [];
    default:
      // Numbers, yes and no, dates, pictures and the rest hold no words to search.
      return [];
  }
}

/** Words of a group's or repeater's own fields that are flagged, from the cells (a group's fields, or a row's) that show. */
function cellWords(subs: FieldDef[], cells: Values, locale: string): string[] {
  const out: string[] = [];
  for (const sub of subs) {
    const value = cells[sub.id];
    if (!searched(sub) || value === undefined || !fieldShows(sub, cells)) continue;
    out.push(...wordsOf(sub, value, locale));
  }
  return out;
}

const isCells = (value: unknown): value is Values =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The search text of a product per language: the words of the public fields
 * flagged `search` in the groups given (those that apply to the product),
 * including those inside groups and repeaters. A language has the texts
 * written in it, else the main language's, and the same everywhere for what
 * is not translated: a choice is its label in the language. Numbers and yes
 * or no hold no words. A field hidden by its logic, or a private one, adds
 * nothing. A language with no words has no entry.
 */
export function searchBodies(
  groups: readonly FieldGroup[],
  data: FieldData,
  locales: readonly string[],
  main: string,
): Record<string, string> {
  const bodies: Record<string, string> = {};
  for (const locale of new Set(locales)) {
    const parts: string[] = [];
    for (const group of groups) {
      const values = valuesFor(group.fields, data, locale, main);
      for (const def of group.fields) {
        if (def.access !== "public") continue;
        const value = values[def.id];
        if (value === undefined || !fieldShows(def, values)) continue;
        if (!isStructural(def.type)) {
          if (searched(def)) parts.push(...wordsOf(def, value, locale));
        } else if (def.type === "group") {
          if (isCells(value)) parts.push(...cellWords(subFieldsOf(def), value, locale));
        } else if (Array.isArray(value)) {
          for (const row of value as Values[])
            if (isCells(row)) parts.push(...cellWords(subFieldsOf(def), row, locale));
        }
      }
    }
    const body = parts.join(" ").replace(/\s+/g, " ").trim().slice(0, FIELD_SEARCH_MAX).trim();
    if (body) bodies[locale] = body;
  }
  return bodies;
}

/** Whether a group has a field flagged for keyword search, its own or inside it: the ones whose change means search text must be made again. */
export const usesSearch = (group: Pick<FieldGroup, "fields">): boolean =>
  group.fields.some((def) => def.search || subFieldsOf(def).some((sub) => sub.search));
