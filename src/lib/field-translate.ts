import {
  fieldShows,
  hasChoices,
  hasTranslations,
  isEmptyValue,
  isStructural,
  isTranslatable,
  readField,
  subFieldsOf,
  TEXT_MAX,
  TEXTAREA_MAX,
  valuesFor,
  writeField,
  type Choice,
  type FieldData,
  type FieldDef,
  type FieldGroup,
  type FieldLink,
  type FieldValue,
  type Values,
} from "./custom-fields";
import type { RichTextDoc } from "./page-content";
import { richRuns, withRichRuns, type TranslateItem, type TranslateMode } from "./page-translate-ai";
import { isLegalPage, type Unit } from "./store-translate";

/**
 * A store's custom fields in the translation worklist (D110, D118): the words
 * of the definitions (a field's label and its choices' labels) and the texts
 * entered in the fields of a product, one of its variants, a page, an article
 * or a category or tag. Pure and shared with the browser;
 * `src/server/field-translate.ts` reads and writes.
 *
 * What is listed, by one rule: only what a shopper can see. A field that is
 * not public (`access`) is left out with everything in it, and so are a
 * field's instructions (staff only), its placeholder and button words (the
 * editor's), a group's name (it is not shown on the site) and pictures'
 * descriptions (kept in the field's value, in the main language, until the
 * media library's translated ones are shown). A group or repeater's fields
 * follow the group's own access. Values that a field's logic hides, and
 * those of groups that do not apply to the thing, are left out too.
 *
 * Unit ids: `fielddef:{groupId}` (one group's labels) and
 * `fieldval:{entity}:{id}` (one thing's texts).
 */

/** A field's or choice's label, at most this long (the definition's own limit). */
export const FIELD_LABEL_MAX = 80;
/** A link's own words, at most this long. */
const LINK_LABEL_MAX = 100;
/** What a unit's title and an item's label are cut to, so one request to the model keeps its labels short. */
const NAME_CUT = 80;

const cut = (text: string) => (text.length > NAME_CUT ? `${text.slice(0, NAME_CUT - 1)}…` : text);

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const asValues = (v: unknown): Values | undefined => (isRecord(v) ? (v as Values) : undefined);
const asRows = (v: unknown): Values[] => (Array.isArray(v) ? (v as Values[]).filter((row) => isRecord(row)) : []);

/** The groups' fields a shopper can see: active groups, and their public fields. */
export const publicFields = (group: FieldGroup): FieldDef[] =>
  group.active ? group.fields.filter((field) => field.access === "public") : [];

// ---------------------------------------------------------------------------
// Definitions: labels
// ---------------------------------------------------------------------------

const hasLabel = (labels: Record<string, string> | undefined, locale: string) =>
  Boolean(labels?.[locale]?.trim() || labels?.[locale.slice(0, 2)]?.trim());

/** Every label of a field and of what it holds: the field's, its choices' and its sub fields', by a key that names them. */
type LabelSlot = { key: string; label: string; source: string; labels: Record<string, string> | undefined };

function labelSlots(def: FieldDef, where = ""): LabelSlot[] {
  const at = where ? `${where}: ` : "";
  const slots: LabelSlot[] = [];
  if (def.label.trim() !== "")
    slots.push({ key: `${def.id}.label`, label: `${at}Field label`, source: def.label, labels: def.labels });
  if (hasChoices(def.type)) {
    for (const choice of def.choices ?? []) {
      if (choice.label.trim() === "") continue;
      slots.push({
        key: `${def.id}.choice.${choice.key}`,
        label: `${at}Choice of ${cut(def.label)}`,
        source: choice.label,
        labels: choice.labels,
      });
    }
  }
  for (const sub of subFieldsOf(def)) slots.push(...labelSlots(sub, cut(def.label)));
  return slots;
}

/** The labels of a group's public fields to translate into `to`: those with no label in it yet, or all of them. */
export function definitionItems(group: FieldGroup, to: string, mode: TranslateMode): TranslateItem[] {
  return publicFields(group)
    .flatMap((def) => labelSlots(def))
    .filter((slot) => mode === "all" || !hasLabel(slot.labels, to))
    .map((slot) => ({ key: slot.key, label: slot.label, max: FIELD_LABEL_MAX, rich: false, runs: [slot.source] }));
}

/** The unit of a group's labels, or null when there is nothing to translate. */
export function definitionUnit(group: FieldGroup, to: string, mode: TranslateMode): Unit | null {
  const items = definitionItems(group, to, mode);
  if (items.length === 0) return null;
  return {
    id: `fielddef:${group.id}`,
    scope: "fields",
    title: cut(group.name),
    kind: "Custom field labels",
    legal: false,
    items,
  };
}

/**
 * The group's fields with translated labels written in language `to`, the
 * rest as it was. Only keys the group has (`definitionItems`) are taken.
 */
export function withDefinitionTexts(
  fields: FieldDef[],
  to: string,
  done: Record<string, string | string[]>,
): FieldDef[] {
  const text = (key: string): string | undefined => {
    const value = done[key];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : undefined;
  };
  const labelled = <T extends { labels?: Record<string, string> }>(item: T, value: string | undefined): T =>
    value === undefined ? item : { ...item, labels: { ...item.labels, [to]: value } };
  const one = (def: FieldDef): FieldDef => {
    const choices: Choice[] | undefined = def.choices?.map((choice) =>
      labelled(choice, text(`${def.id}.choice.${choice.key}`)),
    );
    const subs = def.subFields?.map(one);
    return {
      ...labelled(def, text(`${def.id}.label`)),
      ...(choices && hasChoices(def.type) && { choices }),
      ...(subs && isStructural(def.type) && { subFields: subs }),
    };
  };
  return fields.map((def) => (def.access === "public" ? one(def) : def));
}

// ---------------------------------------------------------------------------
// Values: the texts entered
// ---------------------------------------------------------------------------

/**
 * One text to translate: where it is (a top field, or a cell of a group or
 * of a repeater's row) and the words in the main language and in the
 * language asked for.
 */
export type ValueSlot = {
  key: string;
  label: string;
  top: FieldDef;
  /** The text's own field: the top one, or a sub field. */
  leaf: FieldDef;
  rowId?: string;
  source: FieldValue;
  target: FieldValue | undefined;
};

/** The words of a value that can be translated: a text, a rich text's runs, a link's own words. */
function wordsOf(leaf: FieldDef, value: FieldValue | undefined): string | RichTextDoc | null {
  if (value === undefined || isEmptyValue(value)) return null;
  if (leaf.type === "text" || leaf.type === "textarea") return typeof value === "string" ? value : null;
  if (leaf.type === "richText")
    return isRecord(value) && (value as { type?: unknown }).type === "doc" ? (value as RichTextDoc) : null;
  if (leaf.type === "link") {
    const label = isRecord(value) ? (value as { label?: unknown }).label : undefined;
    return typeof label === "string" && label.trim() !== "" ? label : null;
  }
  return null;
}

/**
 * The texts of `data` to translate from `main` into `to`, for fields of one
 * group (or several: `defs` are the group's own, in order, as their logic
 * looks at the fields beside them). Public fields only, those the thing's
 * own values show.
 */
export function valueSlots(defs: FieldDef[], data: FieldData, main: string, to: string): ValueSlot[] {
  const slots: ValueSlot[] = [];
  const shown = valuesFor(defs, data, main, main);
  for (const top of defs) {
    if (top.access !== "public" || !hasTranslations(top) || !fieldShows(top, shown)) continue;
    const name = cut(top.label);
    if (!isStructural(top.type)) {
      const source = data.translations[main]?.[top.id];
      if (wordsOf(top, source) !== null)
        slots.push({
          key: top.id,
          label: name,
          top,
          leaf: top,
          source: source as FieldValue,
          target: data.translations[to]?.[top.id],
        });
      continue;
    }
    const subs = subFieldsOf(top).filter((sub) => isTranslatable(sub.type));
    const current = readField(top, data, main, main);
    if (top.type === "group") {
      const cells = asValues(current) ?? {};
      const mainWords = asValues(data.translations[main]?.[top.id]);
      const ownWords = asValues(data.translations[to]?.[top.id]);
      for (const sub of subs) {
        const source = mainWords?.[sub.id];
        if (!fieldShows(sub, cells) || wordsOf(sub, source) === null) continue;
        slots.push({
          key: `${top.id}.${sub.id}`,
          label: `${name}: ${cut(sub.label)}`,
          top,
          leaf: sub,
          source: source!,
          target: ownWords?.[sub.id],
        });
      }
      continue;
    }
    const rowWords = (locale: string) =>
      asValues(data.translations[locale]?.[top.id]) as Record<string, Values> | undefined;
    asRows(current).forEach((row, index) => {
      const rowId = String(row.id);
      for (const sub of subs) {
        const source = rowWords(main)?.[rowId]?.[sub.id];
        if (!fieldShows(sub, row) || wordsOf(sub, source) === null) continue;
        slots.push({
          key: `${top.id}.${rowId}.${sub.id}`,
          label: `${name}, row ${index + 1}: ${cut(sub.label)}`,
          top,
          leaf: sub,
          rowId,
          source: source!,
          target: rowWords(to)?.[rowId]?.[sub.id],
        });
      }
    });
  }
  return slots;
}

/** A text's items for the worklist: what the slot holds in the main language, as one run or a rich text's runs. */
export function valueItems(slots: readonly ValueSlot[], mode: TranslateMode): TranslateItem[] {
  return slots
    .filter((slot) => mode === "all" || wordsOf(slot.leaf, slot.target) === null)
    .map((slot): TranslateItem => {
      const words = wordsOf(slot.leaf, slot.source)!;
      if (typeof words !== "string")
        return { key: slot.key, label: slot.label, max: 0, rich: true, runs: richRuns(words) };
      const max =
        slot.leaf.type === "link"
          ? LINK_LABEL_MAX
          : Math.min(
              slot.leaf.maxLength ?? (slot.leaf.type === "text" ? TEXT_MAX : TEXTAREA_MAX),
              slot.leaf.type === "text" ? TEXT_MAX : TEXTAREA_MAX,
            );
      return { key: slot.key, label: slot.label, max, rich: false, runs: [words] };
    });
}

/** A translated value for a slot, in the shape the field keeps: null when it does not fit the source (a rich text split differently). */
function translatedValue(slot: ValueSlot, done: string | string[]): FieldValue | null {
  if (slot.leaf.type === "richText")
    return Array.isArray(done) ? (withRichRuns(slot.source as RichTextDoc, done) as FieldValue | null) : null;
  if (typeof done !== "string") return null;
  if (slot.leaf.type === "link") return { ...(slot.source as FieldLink), label: done.trim() };
  return done;
}

/**
 * What to send `saveFieldData` to write the accepted texts in language `to`:
 * for each field touched, its whole value in that language with the new
 * texts over what was there (a group's or row's own words, kept). The main
 * language and every shared value are never in it; `count` is how many texts
 * were put in place (a text that does not fit its source, such as a rich
 * text split differently, is left out).
 */
export function valueChanges(
  slots: readonly ValueSlot[],
  data: FieldData,
  main: string,
  to: string,
  done: Record<string, string | string[]>,
): {
  changes: {
    values: Record<string, FieldValue | null>;
    translations: Record<string, Record<string, FieldValue | null>>;
  };
  count: number;
} {
  const out: Record<string, FieldValue | null> = {};
  let current = data;
  let count = 0;
  const byTop = new Map<string, ValueSlot[]>();
  for (const slot of slots) {
    if (!(slot.key in done)) continue;
    const value = translatedValue(slot, done[slot.key]);
    if (value === null) continue;
    byTop.set(slot.top.id, [...(byTop.get(slot.top.id) ?? []), { ...slot, target: value }]);
    count += 1;
  }
  for (const [, list] of byTop) {
    const top = list[0].top;
    let value: FieldValue | undefined;
    if (!isStructural(top.type)) {
      value = list[0].target;
    } else if (top.type === "group") {
      value = { ...asValues(current.translations[to]?.[top.id]) };
      for (const slot of list) (value as Values)[slot.leaf.id] = slot.target as FieldValue;
    } else {
      // Every row keeps the words it has in the language; the rows named get theirs over them.
      const own = (asValues(current.translations[to]?.[top.id]) ?? {}) as Record<string, Values>;
      const rows: Values[] = asRows(data.values[top.id]).map((row) => ({ id: String(row.id), ...own[String(row.id)] }));
      for (const slot of list) {
        const row = rows.find((r) => r.id === slot.rowId);
        if (row) row[slot.leaf.id] = slot.target as FieldValue;
      }
      value = rows;
    }
    // The counterpart of reading: what the field keeps in `to`, and nothing of the main language.
    current = writeField(top, current, to, main, value);
    out[top.id] = current.translations[to]?.[top.id] ?? null;
  }
  return { changes: { values: {}, translations: { [to]: out } }, count };
}

/** The kinds of thing whose field values are in the worklist. */
export type ValueEntity = "product" | "variant" | "page" | "article" | "term";

/**
 * What a variant is called in the worklist: its product's title, then its SKU
 * and its options' values (`Ullgenser · SKU-1 (M, blå)`).
 */
export function variantTitle(productTitle: string, sku: string, options: unknown): string {
  const values = isRecord(options)
    ? Object.values(options).filter((v): v is string => typeof v === "string" && v.trim() !== "")
    : [];
  const rest = ` · ${sku}${values.length > 0 ? ` (${values.join(", ")})` : ""}`;
  // The title gives way, so what tells the variants apart stays in view when the unit's title is cut.
  const room = Math.max(20, NAME_CUT - rest.length);
  return `${productTitle.length > room ? `${productTitle.slice(0, room - 1)}…` : productTitle}${rest}`;
}

const UNIT_KINDS: Record<ValueEntity, string> = {
  product: "Product fields",
  variant: "Variant fields",
  page: "Page fields",
  article: "Article fields",
  term: "Category or tag fields",
};

/**
 * The unit of a thing's texts, or null when there is nothing to translate.
 * `termKind` names a category or a tag's unit.
 */
export function valueUnit(
  entity: ValueEntity,
  id: string,
  title: string,
  slug: string,
  slots: readonly ValueSlot[],
  mode: TranslateMode,
  termKind?: "category" | "tag",
): Unit | null {
  const items = valueItems(slots, mode);
  if (items.length === 0) return null;
  return {
    id: `fieldval:${entity}:${id}`,
    scope: "fields",
    title: cut(title),
    kind: entity === "term" && termKind ? (termKind === "tag" ? "Tag fields" : "Category fields") : UNIT_KINDS[entity],
    // Values in a page that looks like terms or privacy are legal texts; nothing else is (a product's, a variant's, a category's).
    legal: (entity === "page" || entity === "article") && isLegalPage(slug, title),
    items,
  };
}
