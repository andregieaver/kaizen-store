import {
  MAX_FILE_BYTES,
  isTranslatable,
  type FieldData,
  type FieldDef,
  type FieldFile,
  type FieldLookups,
  type FieldValue,
  type Values,
} from "@/lib/custom-fields";

/**
 * The pure parts of the entry form for custom fields (D118): what the
 * relational pickers offer, how a list is searched, and what a language
 * shows of a value. The form itself is `fields-form.tsx`.
 */

/** Uploads a file chosen on the owner's computer, from the browser to storage; the host says where it goes. */
export type FieldFileUploader = (file: File) => Promise<FieldFile | { problem: string }>;

/** What a file input offers: the types the server accepts (`FIELD_FILE_ACCEPT` in the server-only media module). */
export const FIELD_FILE_ACCEPT_TYPES = ".pdf,.zip,.txt,.csv,.doc,.xls,.ppt,.docx,.xlsx,.pptx";

/** A file's size checked before it is sent: the bucket refuses more, but a person is told sooner. */
export function fileProblem(file: { name: string; size: number }): string | null {
  if (file.size <= 0) return `${file.name} is empty.`;
  if (file.size > MAX_FILE_BYTES) return `${file.name} is too large. Use one under 50 MB.`;
  return null;
}

/** One thing a picker offers: its id, and the words that name it. */
export type PickOption = { id: string; label: string };

/** What a link can point at, by kind, from the store's lookups. */
export function linkOptions(kind: "page" | "product" | "category" | "tag", lookups: FieldLookups): PickOption[] {
  if (kind === "product") return lookups.products.map((p) => ({ id: p.id, label: p.title }));
  if (kind === "page") {
    return lookups.pages.map((p) => ({ id: p.id, label: p.type === "article" ? `${p.title} (article)` : p.title }));
  }
  return lookups.terms.filter((t) => t.kind === kind).map((t) => ({ id: t.id, label: t.name }));
}

/** What a product, page or category-or-tag field offers to choose from (a category or tag field, only the kinds it allows). */
export function relationOptions(def: Pick<FieldDef, "type" | "termKinds">, lookups: FieldLookups): PickOption[] {
  if (def.type === "product") return linkOptions("product", lookups);
  if (def.type === "page") return linkOptions("page", lookups);
  const kinds = def.termKinds && def.termKinds.length > 0 ? def.termKinds : (["category", "tag"] as const);
  const many = kinds.length > 1;
  return lookups.terms
    .filter((term) => kinds.includes(term.kind))
    .map((term) => ({ id: term.id, label: many ? `${term.name} (${term.kind})` : term.name }));
}

/** The options whose words hold every word of the search (case and accents aside); all of them for an empty search. */
export function filterOptions(options: readonly PickOption[], query: string): PickOption[] {
  const plain = (text: string) => text.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const words = plain(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...options];
  return options.filter((option) => {
    const label = plain(option.label);
    return words.every((word) => label.includes(word));
  });
}

/** The ids a relational value holds, as a list (one or several). */
export function idsOf(value: FieldValue | undefined): string[] {
  if (typeof value === "string") return value === "" ? [] : [value];
  if (Array.isArray(value)) return (value as unknown[]).filter((item): item is string => typeof item === "string");
  return [];
}

/** A relational field's value from the chosen ids: one id, or a list with `multiple`; nothing when none. */
export function relationValue(ids: readonly string[], multiple: boolean | undefined): FieldValue | undefined {
  if (ids.length === 0) return undefined;
  return multiple ? [...ids] : ids[0];
}

/**
 * What is entered, as the language being written holds it alone: the main
 * language's texts left out, so a text not yet written in this language reads
 * as empty (`readField` would otherwise give the main language's words, which
 * are a hint, not a value to edit). Read with this; write to the whole data.
 */
export function ownView(data: FieldData, locale: string, main: string): FieldData {
  if (locale === main || !data.translations[main]) return data;
  const translations = { ...data.translations };
  delete translations[main];
  return { values: data.values, translations };
}

/** A cell of a group or row changed: an empty value takes it away. */
export function withCell(cells: Values, id: string, value: FieldValue | undefined, empty: boolean): Values {
  const next: Values = { ...cells };
  if (value === undefined || empty) delete next[id];
  else next[id] = value;
  return next;
}

/**
 * The sub fields a language can change: all of them in the main language,
 * only the texts in the others (a group's or row's other cells are the same
 * in every language and are changed in the main one).
 */
export const editableSubs = (subs: readonly FieldDef[], locale: string, main: string): FieldDef[] =>
  locale === main ? [...subs] : subs.filter((sub) => isTranslatable(sub.type));

/** How many rows a repeater may still take, and how many it may lose. */
export function rowLimits(
  def: Pick<FieldDef, "minRows" | "maxRows">,
  count: number,
): { canAdd: boolean; canRemove: boolean; missing: number } {
  const most = Math.min(def.maxRows ?? 100, 100);
  const least = def.minRows ?? 0;
  return { canAdd: count < most, canRemove: count > least, missing: Math.max(0, least - count) };
}

/** "Add at least 2 rows." for a repeater short of its fewest, else null. */
export function rowsNeeded(def: Pick<FieldDef, "minRows" | "maxRows">, count: number): string | null {
  const { missing } = rowLimits(def, count);
  if (missing === 0) return null;
  const least = def.minRows ?? 0;
  return `At least ${least} ${least === 1 ? "row is" : "rows are"} needed.`;
}
